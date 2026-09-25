import { readFile } from 'node:fs/promises';
import { fetchStoreProducts } from './lib/fetch-store-products.mjs';
import { compareCatalog } from '../src/lib/catalogue.ts';

const source = await readFile('src/lib/products.ts', 'utf8');
const match = source.match(/export const products: Product\[\] = ([\s\S]*);\s*$/);
if (!match) throw new Error('Cannot read local catalogue');
const local = JSON.parse(match[1]);
const live = await fetchStoreProducts();
const { rows } = compareCatalog(local, live);
const warnings = rows.filter(row => row.field === 'Нужна проверка');
const mismatches = rows.filter(row => row.field !== 'Нужна проверка');
if (mismatches.length) {
	console.table(mismatches);
	process.exitCode = 1;
}
if (warnings.length) {
	console.warn('Public offers requiring manual verification:');
	console.table(warnings);
	// Cloud may publish the explicit warnings, but never silently call them verified.
	if (!process.argv.includes('--allow-review')) process.exitCode = 1;
}
if (!rows.length) console.log(`OK: ${live.length} products match, including public promotion terms.`);
else console.log(`${mismatches.length} mismatches; ${warnings.length} offers require review.`);
