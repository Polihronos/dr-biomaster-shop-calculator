import { validateStoreProducts } from '../../src/lib/catalogue.ts';

const API = 'https://drbiomaster.com/wp-json/wc/store/v1/products';
const headers = { accept: 'application/json', 'user-agent': 'DrBiomasterCatalogueSync/1.0', referer: 'https://drbiomaster.com/' };

async function fetchRelayPage(relayUrl, page) {
	const url = new URL(relayUrl);
	if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.port || url.username || url.password || url.pathname !== '/catalogue') {
		throw new Error('Invalid Cloudflare catalogue relay URL');
	}
	url.searchParams.set('page', String(page));
	const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
	if (!response.ok) {
		const detail = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
		throw new Error(`Catalogue relay HTTP ${response.status}: ${detail}`);
	}
	const result = await response.json();
	if (result?.error) throw new Error(`Catalogue relay rejected page ${page}: ${result.error}`);
	const age = Date.now() - Date.parse(result?.fetchedAt);
	if (result?.source !== 'https://drbiomaster.com' || result.page !== page || !Number.isFinite(age) || age < -60000 || age > 15 * 60 * 1000) {
		throw new Error('Invalid or stale catalogue relay response');
	}
	if (!Number.isInteger(result.total) || result.total < 1) throw new Error('Invalid catalogue relay count');
	return new Response(JSON.stringify(result.products), { headers: { 'x-wp-total': String(result.total) } });
}

export async function fetchStoreProducts({ relayUrl = process.env.CATALOGUE_RELAY_URL } = {}) {
	const products = [];
	let expectedTotal;
	for (let page = 1; page <= 100; page++) {
		let url = `${API}?per_page=100&page=${page}`;
		let response = relayUrl
			? await fetchRelayPage(relayUrl, page)
			: await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
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
