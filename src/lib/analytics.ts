import geographyJson from '$lib/data/bulgaria-analytics.json';
import { dateKeyFromFileName, parseSalesFile, type DirectoryHandleLike, type FileHandleLike } from '$lib/daily-sales';
import type { Product } from '$lib/products';

const BGN_PER_EUR = 1.95583;
const ANALYTICS_DB = 'dr-biomaster-calculator-analytics';
const ANALYTICS_STORE = 'settings';
const ROOT_DIRECTORY_KEY = 'documents-directory';
const ORDERS_DIRECTORY_KEY = 'daily-orders-directory';
const SALES_DIRECTORY_KEY = 'daily-sales-directory';

export type AnalyticsSource = 'order' | 'sale';
export type AnalyticsSourceFilter = 'all' | 'orders' | 'sales';
export type MapMetric = 'transactions' | 'units' | 'revenue';
export type AnalyticsDirectoryKind = 'orders' | 'sales';
export type AnalyticsDirectories = Record<AnalyticsDirectoryKind, DirectoryHandleLike | null>;

export type AnalyticsRegion = { id: string; name: string; path: string; centroid: [number, number] };
type Settlement = { n: string; e: string; r: string; t: number };
export type AnalyticsGeography = {
	sources: { nuts: string; settlements: string };
	viewBox: string;
	regions: AnalyticsRegion[];
	settlements: Settlement[];
};

export type AnalyticsItem = {
	rawName: string;
	name: string;
	quantity: number;
	matched: boolean;
};

export type AnalyticsTransaction = {
	id: string;
	date: string;
	source: AnalyticsSource;
	city: string;
	regionId: string | null;
	client: string;
	revenueEur: number;
	items: AnalyticsItem[];
};

export type AnalyticsLoadResult = {
	transactions: AnalyticsTransaction[];
	filesRead: number;
	orderFiles: number;
	salesFiles: number;
	loadedAt: string;
};

export type AnalyticsFilters = { source: AnalyticsSourceFilter; from: string; to: string };

export type RankedRow = {
	key: string;
	name: string;
	regionName?: string;
	transactions: number;
	units: number;
	revenue: number;
};

export type ProductRow = RankedRow & { matched: boolean };

export type AnalyticsSummary = {
	transactions: number;
	units: number;
	revenue: number;
	uniqueCities: number;
	uniqueClients: number;
	regions: RankedRow[];
	cities: RankedRow[];
	clients: RankedRow[];
	products: ProductRow[];
	unresolvedCities: string[];
	unmatchedProducts: string[];
};

type OrderRecord = {
	orderNumber: string;
	date?: string;
	createdAt?: string;
	city: string;
	name: string;
	products: string;
	sum: string;
};

export const analyticsGeography = geographyJson as AnalyticsGeography;

function openAnalyticsDb() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(ANALYTICS_DB, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(ANALYTICS_STORE)) request.result.createObjectStore(ANALYTICS_STORE);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

async function dbGet<T>(key: string) {
	const db = await openAnalyticsDb();
	return new Promise<T | undefined>((resolve, reject) => {
		const transaction = db.transaction(ANALYTICS_STORE, 'readonly');
		const request = transaction.objectStore(ANALYTICS_STORE).get(key);
		request.onsuccess = () => resolve(request.result as T | undefined);
		request.onerror = () => reject(request.error);
		transaction.oncomplete = () => db.close();
	});
}

async function dbPut(key: string, value: unknown) {
	const db = await openAnalyticsDb();
	return new Promise<void>((resolve, reject) => {
		const transaction = db.transaction(ANALYTICS_STORE, 'readwrite');
		transaction.objectStore(ANALYTICS_STORE).put(value, key);
		transaction.oncomplete = () => {
			db.close();
			resolve();
		};
		transaction.onerror = () => reject(transaction.error);
	});
}

export async function restoreAnalyticsDirectories(): Promise<AnalyticsDirectories> {
	try {
		let orders = (await dbGet<DirectoryHandleLike>(ORDERS_DIRECTORY_KEY)) ?? null;
		let sales = (await dbGet<DirectoryHandleLike>(SALES_DIRECTORY_KEY)) ?? null;

		// Migrate access saved by the earlier version, which selected the Documents root.
		if (!orders || !sales) {
			const root = await dbGet<DirectoryHandleLike>(ROOT_DIRECTORY_KEY);
			if (root) {
				orders ??= await optionalSubdirectory(root, 'daily orders');
				sales ??= await optionalSubdirectory(root, 'daily sales');
				if (orders) await rememberDirectory('orders', orders);
				if (sales) await rememberDirectory('sales', sales);
			}
		}

		return { orders, sales };
	} catch {
		return { orders: null, sales: null };
	}
}

async function rememberDirectory(kind: AnalyticsDirectoryKind, directory: DirectoryHandleLike) {
	try {
		await dbPut(kind === 'orders' ? ORDERS_DIRECTORY_KEY : SALES_DIRECTORY_KEY, directory);
	} catch {
		// File-system handles can be used for this session even if the browser refuses persistence.
	}
}

export async function chooseAnalyticsDirectory(kind: AnalyticsDirectoryKind) {
	if (!window.showDirectoryPicker) throw new Error('Използвай Chrome или Edge, за да прочетеш TXT файловете.');
	const expectedName = kind === 'orders' ? 'daily orders' : 'daily sales';
	const directory = await window.showDirectoryPicker({
		id: `dr-biomaster-analytics-${kind}`,
		mode: 'read',
		startIn: 'documents'
	});
	if (normalizeLookup(directory.name) !== normalizeLookup(expectedName)) {
		throw new Error(`Избери директно папката „${expectedName}“, а не Documents.`);
	}
	await rememberDirectory(kind, directory);
	return directory;
}

export async function analyticsPermission(directory: DirectoryHandleLike, request = false) {
	if (!directory.queryPermission) return 'granted';
	let permission = await directory.queryPermission({ mode: 'read' });
	if (permission !== 'granted' && request && directory.requestPermission) {
		permission = await directory.requestPermission({ mode: 'read' });
	}
	return permission;
}

export function normalizeLookup(value: string) {
	return String(value || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLocaleLowerCase('bg-BG')
		.replace(/&/g, ' и ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function compact(value: unknown) {
	return String(value ?? '').replace(/[|\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(value: string) {
	return value
		.toLocaleLowerCase('bg-BG')
		.replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase('bg-BG'));
}

function settlementKey(value: string) {
	return normalizeLookup(value)
		.replace(/^\d{4}\s+/, '')
		.replace(/^(?:гр|град|с|село)\s+/, '')
		.trim();
}

function settlementResolver(geography: AnalyticsGeography) {
	const lookup = new Map<string, Settlement[]>();
	for (const settlement of geography.settlements) {
		for (const name of [settlement.n, settlement.e]) {
			const key = settlementKey(name);
			if (!key) continue;
			const values = lookup.get(key) ?? [];
			values.push(settlement);
			lookup.set(key, values);
		}
	}
	const regionNames = new Map(geography.regions.map((region) => [region.id, normalizeLookup(region.name)]));

	return (rawCity: string) => {
		const raw = compact(rawCity);
		const key = settlementKey(raw.split(',')[0] || raw);
		const kindHint = /^\s*(?:гр\.?|град)\b/iu.test(raw) ? 1 : /^\s*(?:с\.?|село)\b/iu.test(raw) ? 3 : 0;
		let candidates = lookup.get(key) ?? [];
		if (kindHint) {
			const matchingKind = candidates.filter((candidate) => candidate.t === kindHint);
			if (matchingKind.length) candidates = matchingKind;
		}
		if (candidates.length > 1) {
			const normalizedRaw = normalizeLookup(raw);
			const withRegion = candidates.filter((candidate) => normalizedRaw.includes(regionNames.get(candidate.r) ?? ''));
			if (withRegion.length === 1) candidates = withRegion;
		}
		const match = candidates.length === 1 ? candidates[0] : null;
		return {
			city: match?.n || titleCase(key || raw || 'Неизвестно'),
			regionId: match?.r ?? null
		};
	};
}

function productNormalization(value: string) {
	return normalizeLookup(value)
		.replace(/\bкапс?\b|\bкапсули\b/gu, ' капсули ')
		.replace(/\bбр\b/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function trigrams(value: string) {
	const padded = `  ${value}  `;
	const values = new Set<string>();
	for (let index = 0; index < padded.length - 2; index += 1) values.add(padded.slice(index, index + 3));
	return values;
}

function similarity(left: string, right: string) {
	if (left === right) return 1;
	if (left.length >= 5 && right.includes(left)) return Math.min(0.92, 0.7 + left.length / right.length / 4);
	if (right.length >= 5 && left.includes(right)) return Math.min(0.92, 0.7 + right.length / left.length / 4);
	const leftGrams = trigrams(left);
	const rightGrams = trigrams(right);
	const sharedGrams = [...leftGrams].filter((gram) => rightGrams.has(gram)).length;
	const dice = (2 * sharedGrams) / Math.max(1, leftGrams.size + rightGrams.size);
	const leftTokens = new Set(left.split(' ').filter((token) => token.length > 1));
	const rightTokens = new Set(right.split(' ').filter((token) => token.length > 1));
	const sharedTokens = [...leftTokens].filter((token) => rightTokens.has(token)).length;
	const jaccard = sharedTokens / Math.max(1, new Set([...leftTokens, ...rightTokens]).size);
	return dice * 0.65 + jaccard * 0.35;
}

function productMatcher(products: Product[]) {
	const catalog = products.map((product) => ({ id: product.id, name: product.name, normalized: productNormalization(product.name) }));
	const byId = new Map(catalog.map((product) => [product.id, product]));

	return (rawName: string, productId = ''): AnalyticsItem => {
		const raw = compact(rawName);
		const exactId = byId.get(String(productId));
		if (exactId) return { rawName: raw, name: exactId.name, quantity: 1, matched: true };
		const normalized = productNormalization(raw);
		const ranked = catalog
			.map((product) => ({ product, score: similarity(normalized, product.normalized) }))
			.toSorted((a, b) => b.score - a.score);
		const best = ranked[0];
		const runnerUp = ranked[1];
		const confident = Boolean(best && best.score >= 0.5 && (best.score >= 0.88 || best.score - (runnerUp?.score ?? 0) >= 0.055));
		return { rawName: raw, name: confident ? best.product.name : titleCase(raw || 'Неизвестен продукт'), quantity: 1, matched: confident };
	};
}

function parseOrderProducts(value: string, matchProduct: ReturnType<typeof productMatcher>) {
	const parts = compact(value)
		.split(/\s*;\s*|\s*\n\s*/)
		.map((part) => part.trim())
		.filter((part) => part && part !== '—');
	return parts.map((part) => {
		const quantityMatch = part.match(/(?:×|x|х|\*)\s*(\d+(?:[.,]\d+)?)\b/iu);
		const quantity = Math.max(0, Number(quantityMatch?.[1]?.replace(',', '.') || 1));
		const rawName = part.replace(/(?:×|x|х|\*)\s*\d+(?:[.,]\d+)?\b/iu, '').trim();
		return { ...matchProduct(rawName), quantity };
	});
}

export function parseMoneyEur(value: string) {
	const match = compact(value).match(/(-?\d+(?:[.,]\d+)?)\s*(EUR|€|BGN|лв\.?)?/iu);
	if (!match) return 0;
	const amount = Number(match[1].replace(',', '.'));
	return Number(((match[2] && /BGN|лв/iu.test(match[2]) ? amount / BGN_PER_EUR : amount) || 0).toFixed(2));
}

export function parseOrderFile(contents: string, fallbackDate: string): OrderRecord[] {
	const records: OrderRecord[] = [];
	for (const rawLine of String(contents || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || /^# Dr\. Biomaster Daily Orders/i.test(line) || /^#\s*Date:/i.test(line)) continue;
		const separator = line.indexOf('\t');
		if (separator >= 0) {
			try {
				const parsed = JSON.parse(line.slice(separator + 1)) as Partial<OrderRecord>;
				if (parsed.orderNumber) {
					records.push({
						orderNumber: compact(parsed.orderNumber),
						date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : fallbackDate,
						createdAt: parsed.createdAt,
						city: compact(parsed.city),
						name: compact(parsed.name),
						products: compact(parsed.products),
						sum: compact(parsed.sum)
					});
					continue;
				}
			} catch {
				// Read the human-readable portion below.
			}
		}
		const readable = separator >= 0 ? line.slice(0, separator) : line;
		const parts = readable.split('|').map((part) => part.trim());
		const orderNumber = parts[0]?.match(/^#(.+)$/)?.[1];
		if (!orderNumber || parts.length < 5) continue;
		records.push({
			orderNumber,
			date: fallbackDate,
			city: parts[1],
			name: parts[2],
			products: parts.slice(3, -1).join(' '),
			sum: parts.at(-1) ?? ''
		});
	}
	return records;
}

async function optionalSubdirectory(root: DirectoryHandleLike, name: string) {
	if (normalizeLookup(root.name) === normalizeLookup(name)) return root;
	try {
		return await root.getDirectoryHandle(name);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'NotFoundError') return null;
		throw error;
	}
}

async function datedFiles(directory: DirectoryHandleLike | null) {
	if (!directory) return [];
	const files: { key: string; handle: FileHandleLike }[] = [];
	for await (const entry of directory.values()) {
		const key = dateKeyFromFileName(entry.name);
		if (key && 'getFile' in entry) files.push({ key, handle: entry as FileHandleLike });
	}
	return files.toSorted((a, b) => a.key.localeCompare(b.key));
}

export async function loadAnalytics(directories: AnalyticsDirectories, products: Product[], geography = analyticsGeography): Promise<AnalyticsLoadResult> {
	if (!directories.orders && !directories.sales) throw new Error('Свържи поне една папка с данни.');
	for (const directory of [directories.orders, directories.sales]) {
		if (directory && (await analyticsPermission(directory, false)) !== 'granted') {
			throw new Error(`Нужно е разрешение за четене на папка „${directory.name}“.`);
		}
	}
	const [orderFiles, salesFiles] = await Promise.all([datedFiles(directories.orders), datedFiles(directories.sales)]);
	const resolveSettlement = settlementResolver(geography);
	const matchProduct = productMatcher(products);
	const transactions: AnalyticsTransaction[] = [];

	for (const { key, handle } of orderFiles) {
		const contents = await (await handle.getFile()).text();
		for (const record of parseOrderFile(contents, key)) {
			const settlement = resolveSettlement(record.city);
			transactions.push({
				id: `order:${record.date || key}:${record.orderNumber}`,
				date: record.date || key,
				source: 'order',
				city: settlement.city,
				regionId: settlement.regionId,
				client: titleCase(compact(record.name) || 'Неизвестен клиент'),
				revenueEur: parseMoneyEur(record.sum),
				items: parseOrderProducts(record.products, matchProduct)
			});
		}
	}

	const sofia = resolveSettlement('гр. София');
	for (const { key, handle } of salesFiles) {
		const contents = await (await handle.getFile()).text();
		for (const sale of parseSalesFile(contents)) {
			transactions.push({
				id: `sale:${sale.id}`,
				date: key,
				source: 'sale',
				city: sofia.city,
				regionId: sofia.regionId,
				client: '',
				revenueEur: sale.total,
				items: sale.items.map((item) => ({ ...matchProduct(item.name, item.productId), quantity: item.quantity }))
			});
		}
	}

	return {
		transactions: transactions.toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
		filesRead: orderFiles.length + salesFiles.length,
		orderFiles: orderFiles.length,
		salesFiles: salesFiles.length,
		loadedAt: new Date().toISOString()
	};
}

function addRanked(map: Map<string, RankedRow>, key: string, name: string, transaction: AnalyticsTransaction, regionName?: string) {
	const row = map.get(key) ?? { key, name, regionName, transactions: 0, units: 0, revenue: 0 };
	row.transactions += 1;
	row.units += transaction.items.reduce((sum, item) => sum + item.quantity, 0);
	row.revenue += transaction.revenueEur;
	map.set(key, row);
}

export function summarizeAnalytics(
	transactions: AnalyticsTransaction[],
	filters: AnalyticsFilters,
	geography = analyticsGeography
): AnalyticsSummary {
	const filtered = transactions.filter((transaction) => {
		const sourceMatches = filters.source === 'all' || (filters.source === 'orders' ? transaction.source === 'order' : transaction.source === 'sale');
		return sourceMatches && (!filters.from || transaction.date >= filters.from) && (!filters.to || transaction.date <= filters.to);
	});
	const regionNames = new Map(geography.regions.map((region) => [region.id, region.name]));
	const regionRows = new Map<string, RankedRow>(
		geography.regions.map((region) => [region.id, { key: region.id, name: region.name, transactions: 0, units: 0, revenue: 0 }])
	);
	const cityRows = new Map<string, RankedRow>();
	const clientRows = new Map<string, RankedRow>();
	const productRows = new Map<string, ProductRow>();
	const unresolvedCities = new Set<string>();
	const unmatchedProducts = new Set<string>();

	for (const transaction of filtered) {
		if (transaction.regionId) addRanked(regionRows, transaction.regionId, regionNames.get(transaction.regionId) ?? transaction.regionId, transaction);
		else if (transaction.source === 'order') unresolvedCities.add(transaction.city);
		addRanked(cityRows, normalizeLookup(transaction.city), transaction.city, transaction, transaction.regionId ? regionNames.get(transaction.regionId) : undefined);
		if (transaction.client) addRanked(clientRows, normalizeLookup(transaction.client), transaction.client, transaction);

		const productsSeen = new Set<string>();
		for (const item of transaction.items) {
			const key = normalizeLookup(item.name);
			const row = productRows.get(key) ?? { key, name: item.name, transactions: 0, units: 0, revenue: 0, matched: item.matched };
			row.units += item.quantity;
			row.matched ||= item.matched;
			if (!productsSeen.has(key)) row.transactions += 1;
			productsSeen.add(key);
			productRows.set(key, row);
			if (!item.matched) unmatchedProducts.add(item.rawName);
		}
	}

	const sortRows = (rows: RankedRow[]) => rows.toSorted((a, b) => b.revenue - a.revenue || b.transactions - a.transactions || a.name.localeCompare(b.name, 'bg'));
	return {
		transactions: filtered.length,
		units: filtered.reduce((sum, transaction) => sum + transaction.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0),
		revenue: Number(filtered.reduce((sum, transaction) => sum + transaction.revenueEur, 0).toFixed(2)),
		uniqueCities: cityRows.size,
		uniqueClients: clientRows.size,
		regions: sortRows([...regionRows.values()]),
		cities: sortRows([...cityRows.values()]),
		clients: sortRows([...clientRows.values()]),
		products: [...productRows.values()].toSorted((a, b) => b.units - a.units || b.transactions - a.transactions || a.name.localeCompare(b.name, 'bg')),
		unresolvedCities: [...unresolvedCities].toSorted((a, b) => a.localeCompare(b, 'bg')),
		unmatchedProducts: [...unmatchedProducts].toSorted((a, b) => a.localeCompare(b, 'bg'))
	};
}
