import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { fetchStoreProducts } from './lib/fetch-store-products.mjs';
import { pricesFromStore, stripHtml } from '../src/lib/catalogue.ts';

const TARGET = resolve('src/lib/products.ts');

async function readExistingCatalog() {
	try {
		const source = await readFile(TARGET, 'utf8');
		const updatedAt = source.match(/export const catalogUpdatedAt = (.+);/)?.[1];
		const products = source.match(/export const products: Product\[\] = ([\s\S]*);\s*$/)?.[1];

		return {
			updatedAt: updatedAt ? JSON.parse(updatedAt) : null,
			products: products ? JSON.parse(products) : null
		};
	} catch (error) {
		if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
			return { updatedAt: null, products: null };
		}

		throw error;
	}
}

const products = await fetchStoreProducts();

const normalized = products
	.filter((product) => !product.is_password_protected)
	.map((product) => {
		const prices = pricesFromStore(product);
		return {
			id: String(product.id),
			name: stripHtml(product.name),
			category: stripHtml(product.categories?.at(-1)?.name) || 'Без категория',
			...prices,
			hasOptions: Boolean(product.has_options),
			image: product.images?.[0]?.thumbnail || product.images?.[0]?.src || '',
			imageLarge: product.images?.[0]?.src || product.images?.[0]?.thumbnail || '',
			sourceUrl: product.permalink,
			shortDescription: stripHtml(product.short_description),
			priceLabel: stripHtml(product.price_html) || `${prices.price.toFixed(2)} лв.`
		};
	})
	.sort((a, b) => a.category.localeCompare(b.category, 'bg') || a.name.localeCompare(b.name, 'bg'));

const existingCatalog = await readExistingCatalog();
const catalogChanged = JSON.stringify(existingCatalog.products) !== JSON.stringify(normalized);
const catalogUpdatedAt = catalogChanged || !existingCatalog.updatedAt ? new Date().toISOString() : existingCatalog.updatedAt;

const output = `import type { QuantityPromotion } from './catalogue';

export type Product = {
	id: string;
	name: string;
	category: string;
	price: number;
	regularPrice: number;
	onSale: boolean;
	promotion?: QuantityPromotion | null;
	promotionEvidence?: string[];
	promotionWarnings?: string[];
	hasOptions: boolean;
	image: string;
	imageLarge: string;
	sourceUrl: string;
	shortDescription: string;
	priceLabel: string;
};

export const catalogUpdatedAt = ${JSON.stringify(catalogUpdatedAt)};
export const catalogCheckedAt = ${JSON.stringify(new Date().toISOString().slice(0, 10))};

export const products: Product[] = ${JSON.stringify(normalized, null, '\t')};
`;

await mkdir(dirname(TARGET), { recursive: true });
await writeFile(TARGET, output, 'utf8');

console.log(`${catalogChanged ? 'Updated' : 'Checked'} ${normalized.length} products in ${TARGET}`);

const warnings = normalized.flatMap(product => product.promotionWarnings.map(warning => `${product.id} ${product.name}: ${warning}`));
for (const warning of warnings) console.warn(`Promotion needs review: ${warning}`);
