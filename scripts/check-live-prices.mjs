import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const API = 'https://drbiomaster.com/wp-json/wc/store/v1/products';
const PRODUCTS_FILE = resolve('src/lib/products.ts');

function decodeEntities(value = '') {
	return value
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#8211;/g, '-')
		.replace(/&#8217;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function stripHtml(value = '') {
	return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function amountToLeva(amount, prices) {
	const minorUnit = Number(prices.currency_minor_unit ?? 2);
	const divisor = 10 ** minorUnit;
	const price = Number(amount || 0) / divisor;

	if (prices.currency_code === 'BGN') return Number(price.toFixed(2));
	if (prices.currency_code === 'EUR') return Number((price * 1.95583).toFixed(2));
	return Number(price.toFixed(2));
}

async function fetchLiveProducts() {
	const products = [];

	for (let page = 1; page <= 20; page += 1) {
		const response = await fetch(`${API}?per_page=100&page=${page}`);
		if (!response.ok) {
			if (response.status === 400 || response.status === 404) break;
			throw new Error(`Failed to fetch products page ${page}: ${response.status}`);
		}

		const batch = await response.json();
		products.push(...batch);
		if (batch.length < 100) break;
	}

	return products;
}

async function readLocalProducts() {
	const source = await readFile(PRODUCTS_FILE, 'utf8');
	const match = source.match(/export const products: Product\[\] = ([\s\S]*);\s*$/);
	if (!match) throw new Error(`Could not find products export in ${PRODUCTS_FILE}`);
	return JSON.parse(match[1]);
}

function normalizeLiveProduct(product) {
	const price = amountToLeva(product.prices.sale_price || product.prices.price || product.prices.regular_price, product.prices);
	const regularPrice = product.prices.regular_price ? amountToLeva(product.prices.regular_price, product.prices) : price;

	return {
		id: String(product.id),
		name: stripHtml(product.name),
		price,
		regularPrice,
		onSale: Boolean(product.on_sale)
	};
}

const localProducts = await readLocalProducts();
const liveProducts = (await fetchLiveProducts()).map(normalizeLiveProduct);
const localById = new Map(localProducts.map((product) => [product.id, product]));
const mismatches = [];

for (const live of liveProducts) {
	const local = localById.get(live.id);
	if (!local) {
		mismatches.push({ id: live.id, name: live.name, issue: 'missing-local' });
		continue;
	}

	const priceDiff = Math.abs(Number(local.price) - live.price);
	const regularDiff = Math.abs(Number(local.regularPrice) - live.regularPrice);
	const saleDiff = Boolean(local.onSale) !== live.onSale;

	if (priceDiff > 0.01 || regularDiff > 0.01 || saleDiff) {
		mismatches.push({
			id: live.id,
			name: live.name,
			local: { price: local.price, regularPrice: local.regularPrice, onSale: local.onSale },
			live: { price: live.price, regularPrice: live.regularPrice, onSale: live.onSale }
		});
	}
}

if (mismatches.length === 0) {
	console.log(`OK: ${liveProducts.length} live products match ${PRODUCTS_FILE}`);
} else {
	console.log(`Found ${mismatches.length} price/sale mismatches:`);
	console.table(mismatches.slice(0, 50));
	process.exitCode = 1;
}
