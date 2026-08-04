export type PaymentMethod = 'cash' | 'card';

export type DailySaleItem = {
	productId: string;
	name: string;
	quantity: number;
	unitPrice: number;
	discountPercent: number;
};

export type DailySale = {
	id: string;
	createdAt: string;
	payment: PaymentMethod;
	globalDiscount: number;
	items: DailySaleItem[];
	total: number;
};

export type SalesDay = {
	dateKey: string;
	fileName: string;
	sales: DailySale[];
};

export type WritableFileLike = {
	write(data: string): Promise<void>;
	close(): Promise<void>;
};

export type FileHandleLike = {
	name: string;
	getFile(): Promise<{ text(): Promise<string> }>;
	createWritable(): Promise<WritableFileLike>;
};

export type DirectoryHandleLike = {
	name: string;
	getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
	getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
	values(): AsyncIterable<FileHandleLike | DirectoryHandleLike>;
};

declare global {
	interface Window {
		showDirectoryPicker?: (options?: {
			id?: string;
			mode?: 'read' | 'readwrite';
			startIn?: 'documents';
		}) => Promise<DirectoryHandleLike>;
	}
}

const FILE_HEADER = '# Dr. Biomaster Daily Sales v1';
const DATE_FILE_PATTERN = /^(\d{2})-(\d{2})-(\d{4})\.txt$/;

function roundMoney(value: number) {
	return Number(value.toFixed(2));
}

function clampPercent(value: number) {
	return Math.min(100, Math.max(0, Number(value) || 0));
}

export function dateKey(date = new Date()) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function fileNameForDate(key: string) {
	const [year, month, day] = key.split('-');
	return `${day}-${month}-${year}.txt`;
}

export function dateKeyFromFileName(fileName: string) {
	const match = fileName.match(DATE_FILE_PATTERN);
	return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function displayDate(key: string) {
	const [year, month, day] = key.split('-');
	return `${day}/${month}/${year}`;
}

export function dayOfWeek(key: string) {
	return new Intl.DateTimeFormat('bg-BG', { weekday: 'long' }).format(new Date(`${key}T12:00:00`));
}

export function calculateSaleTotal(sale: Pick<DailySale, 'items' | 'globalDiscount'>) {
	const subtotal = sale.items.reduce((sum, item) => {
		const quantity = Math.max(0, Number(item.quantity) || 0);
		const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
		return sum + quantity * unitPrice * (1 - clampPercent(item.discountPercent) / 100);
	}, 0);

	return roundMoney(subtotal * (1 - clampPercent(sale.globalDiscount) / 100));
}

export function normalizeSale(sale: DailySale): DailySale {
	const normalized: DailySale = {
		id: String(sale.id || crypto.randomUUID()),
		createdAt: sale.createdAt || new Date().toISOString(),
		payment: sale.payment === 'card' ? 'card' : 'cash',
		globalDiscount: clampPercent(sale.globalDiscount),
		items: sale.items
			.map((item) => ({
				productId: String(item.productId ?? ''),
				name: String(item.name ?? '').trim(),
				quantity: Math.max(0, Number(item.quantity) || 0),
				unitPrice: roundMoney(Math.max(0, Number(item.unitPrice) || 0)),
				discountPercent: clampPercent(item.discountPercent)
			}))
			.filter((item) => item.name && item.quantity > 0),
		total: 0
	};

	normalized.total = calculateSaleTotal(normalized);
	return normalized;
}

function readableSaleLine(sale: DailySale, index: number) {
	const products = sale.items.map((item) => `${item.name} x${item.quantity}`).join(' , ');
	const payment = sale.payment === 'card' ? '💳 CARD' : '💵 CASH';
	return `${index + 1}: ${products} - ${sale.total.toFixed(2)} EUR - ${payment}`;
}

export function serializeSalesFile(key: string, sales: DailySale[]) {
	const lines = sales.map((rawSale, index) => {
		const sale = normalizeSale(rawSale);
		return `${readableSaleLine(sale, index)}\t${JSON.stringify(sale)}`;
	});

	return `${FILE_HEADER}\n# Date: ${displayDate(key)}\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

export function parseSalesFile(contents: string): DailySale[] {
	return contents
		.split(/\r?\n/)
		.filter((line) => line && !line.startsWith('#'))
		.flatMap((line) => {
			const separator = line.indexOf('\t');
			if (separator < 0) return [];

			try {
				const parsed = JSON.parse(line.slice(separator + 1)) as DailySale;
				return [normalizeSale(parsed)];
			} catch {
				return [];
			}
		});
}

export async function chooseDailySalesDirectory() {
	if (!window.showDirectoryPicker) {
		throw new Error('Този браузър не поддържа запис в папка. Използвай Chrome или Edge.');
	}

	const chosen = await window.showDirectoryPicker({
		id: 'dr-biomaster-daily-sales',
		mode: 'readwrite',
		startIn: 'documents'
	});

	if (chosen.name.toLocaleLowerCase('bg-BG') === 'daily sales') return chosen;
	return chosen.getDirectoryHandle('daily sales', { create: true });
}

export async function readSalesDay(directory: DirectoryHandleLike, key: string): Promise<SalesDay> {
	const fileName = fileNameForDate(key);

	try {
		const handle = await directory.getFileHandle(fileName);
		const file = await handle.getFile();
		return { dateKey: key, fileName, sales: parseSalesFile(await file.text()) };
	} catch (error) {
		if (error instanceof DOMException && error.name === 'NotFoundError') {
			return { dateKey: key, fileName, sales: [] };
		}
		throw error;
	}
}

export async function writeSalesDay(directory: DirectoryHandleLike, key: string, sales: DailySale[]) {
	const fileName = fileNameForDate(key);
	const handle = await directory.getFileHandle(fileName, { create: true });
	const writable = await handle.createWritable();
	await writable.write(serializeSalesFile(key, sales));
	await writable.close();
}

export async function appendSale(directory: DirectoryHandleLike, sale: DailySale) {
	const key = dateKey(new Date(sale.createdAt));
	const day = await readSalesDay(directory, key);
	const normalized = normalizeSale(sale);
	await writeSalesDay(directory, key, [...day.sales, normalized]);
	return normalized;
}

export async function listSalesDays(directory: DirectoryHandleLike) {
	const keys: string[] = [];

	for await (const entry of directory.values()) {
		const key = dateKeyFromFileName(entry.name);
		if (key) keys.push(key);
	}

	return keys.sort((a, b) => b.localeCompare(a));
}
