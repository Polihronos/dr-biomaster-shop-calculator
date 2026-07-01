import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const API = 'https://drbiomaster.com/wp-json/wc/store/v1/products';
const TARGET = resolve('src/lib/products.ts');

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

function priceToLeva(product) {
	return amountToLeva(product.prices.sale_price || product.prices.price || product.prices.regular_price, product.prices);
}

function amountToLeva(amount, prices) {
	const minorUnit = Number(prices.currency_minor_unit ?? 2);
	const divisor = 10 ** minorUnit;
	const price = Number(amount || 0) / divisor;

	if (prices.currency_code === 'BGN') {
		return price;
	}

	if (prices.currency_code === 'EUR') {
		return Number((price * 1.95583).toFixed(2));
	}

	return Number(price.toFixed(2));
}

function formatCategory(categories = []) {
	const leaf = categories.at(-1);
	return leaf?.name ? decodeEntities(leaf.name) : 'Без категория';
}

async function fetchPage(page) {
	const response = await fetch(`${API}?per_page=100&page=${page}`);
	if (!response.ok) {
		if (response.status === 400 || response.status === 404) return [];
		throw new Error(`Failed to fetch products page ${page}: ${response.status}`);
	}

	return response.json();
}

const products = [];

for (let page = 1; page <= 20; page += 1) {
	const batch = await fetchPage(page);
	products.push(...batch);
	if (batch.length < 100) break;
}

const normalized = products
	.filter((product) => !product.is_password_protected)
	.map((product) => {
		const price = priceToLeva(product);
		const regularPrice = product.prices.regular_price
			? amountToLeva(product.prices.regular_price, product.prices)
			: price;

		return {
			id: String(product.id),
			name: stripHtml(product.name),
			category: formatCategory(product.categories),
			price,
			regularPrice,
			onSale: Boolean(product.on_sale),
			hasOptions: Boolean(product.has_options),
			image: product.images?.[0]?.thumbnail || product.images?.[0]?.src || '',
			imageLarge: product.images?.[0]?.src || product.images?.[0]?.thumbnail || '',
			sourceUrl: product.permalink,
			shortDescription: stripHtml(product.short_description),
			priceLabel: stripHtml(product.price_html) || `${price.toFixed(2)} лв.`
		};
	})
	.sort((a, b) => a.category.localeCompare(b.category, 'bg') || a.name.localeCompare(b.name, 'bg'));

const output = `export type Product = {
	id: string;
	name: string;
	category: string;
	price: number;
	regularPrice: number;
	onSale: boolean;
	hasOptions: boolean;
	image: string;
	imageLarge: string;
	sourceUrl: string;
	shortDescription: string;
	priceLabel: string;
};

export const catalogUpdatedAt = ${JSON.stringify(new Date().toISOString())};

export const products: Product[] = ${JSON.stringify(normalized, null, '\t')};
`;

await mkdir(dirname(TARGET), { recursive: true });
await writeFile(TARGET, output, 'utf8');

console.log(`Wrote ${normalized.length} products to ${TARGET}`);
