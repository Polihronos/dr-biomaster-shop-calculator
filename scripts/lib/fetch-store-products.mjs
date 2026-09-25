import { validateStoreProducts } from '../../src/lib/catalogue.ts';

const API = 'https://drbiomaster.com/wp-json/wc/store/v1/products';
const headers = { accept: 'application/json', 'user-agent': 'DrBiomasterCatalogueSync/1.0', referer: 'https://drbiomaster.com/' };

export async function fetchStoreProducts() {
	const products = [];
	let expectedTotal;
	for (let page = 1; page <= 100; page++) {
		let url = `${API}?per_page=100&page=${page}`;
		let response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
		// WordPress exposes the same public REST route with and without pretty permalinks.
		if (response.status === 403 || response.status === 404) {
			console.warn(`Catalogue pretty URL: HTTP ${response.status}; server=${response.headers.get('server')}; challenge=${response.headers.get('cf-mitigated') ?? 'none'}`);
			url = `https://drbiomaster.com/?rest_route=/wc/store/v1/products&per_page=100&page=${page}`;
			response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
		}
		let batch;
		if (response.status === 403) {
			const callback = `drBiomasterSync_${page}`;
			response = await fetch(`${url}&_jsonp=${callback}`, { headers, signal: AbortSignal.timeout(30000) });
			if (!response.ok) {
				const detail = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 350);
				throw new Error(`Website rejected catalogue page ${page}: HTTP ${response.status}; server=${response.headers.get('server')}; challenge=${response.headers.get('cf-mitigated') ?? 'none'}; ${detail}. No catalogue was published.`);
			}
			const body = await response.text();
			if (!body.startsWith(`${callback}(`) || !body.trimEnd().endsWith(');')) throw new Error('Invalid catalogue JSONP response');
			batch = JSON.parse(body.slice(callback.length+1,body.lastIndexOf(');')));
		} else {
			if (!response.ok) throw new Error(`Catalogue page ${page}: HTTP ${response.status}`);
			batch = await response.json();
		}
		const totalHeader = response.headers.get('x-wp-total');
		if (totalHeader !== null) {
			const total = Number(totalHeader);
			if (!Number.isInteger(total) || total < 1 || (expectedTotal !== undefined && total !== expectedTotal)) throw new Error('Catalogue count changed during pagination');
			expectedTotal = total;
		}
		validateStoreProducts(batch);
		products.push(...batch);
		if (expectedTotal !== undefined ? products.length >= expectedTotal : batch.length < 100) {
			if (!products.length || (expectedTotal !== undefined && products.length !== expectedTotal)) throw new Error('Incomplete catalogue');
			validateStoreProducts(products);
			return products;
		}
	}
	throw new Error('Catalogue pagination limit reached; refusing a partial update');
}
