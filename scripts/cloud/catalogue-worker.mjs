// Only Cloudflare's scheduler fetches the source. HTTP callers read public snapshots.
const MAX_AGE = 30 * 60 * 1000;

export async function collectCatalogue() {
	const products = [];
	const ids = new Set();
	let expectedTotal;
	for (let page = 1; page <= 50; page++) {
		const response = await fetch(`https://drbiomaster.com/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { signal: AbortSignal.timeout(30000) });
		if (!response.ok) throw new Error(`Catalogue page ${page}: HTTP ${response.status}`);
		const batch = await response.json();
		const total = Number(response.headers.get('x-wp-total'));
		if (!Array.isArray(batch) || !batch.length || batch.length > 100 || !Number.isInteger(total) || total < 1 || (expectedTotal !== undefined && total !== expectedTotal)) {
			throw new Error('Incomplete or changing catalogue');
		}
		expectedTotal = total;
		for (const product of batch) {
			if (!Number.isInteger(product?.id) || product.id <= 0 || ids.has(product.id) || typeof product.name !== 'string' || !product.name.trim() || !product.prices) {
				throw new Error('Invalid or duplicate catalogue product');
			}
			ids.add(product.id);
			products.push(product);
		}
		if (products.length >= total) {
			if (products.length !== total) throw new Error('Catalogue count mismatch');
			const fetchedAt = new Date().toISOString();
			return { source: 'https://drbiomaster.com', snapshotId: fetchedAt, fetchedAt, total, products };
		}
	}
	throw new Error('Catalogue exceeds pagination limit');
}

export default {
	async scheduled(_controller, env) {
		const snapshot = await collectCatalogue();
		console.log(JSON.stringify({ event: 'catalogue-fetched', fetchedAt: snapshot.fetchedAt, total: snapshot.total }));
		if (!env.CATALOGUE_SNAPSHOTS) throw new Error('Catalogue snapshot storage is not configured');
		// One atomic write after every page passed validation; failures preserve the previous snapshot.
		await env.CATALOGUE_SNAPSHOTS.put('latest', JSON.stringify(snapshot));
		console.log(JSON.stringify({ event: 'catalogue-stored', snapshotId: snapshot.snapshotId, total: snapshot.total }));
	},
	async fetch(request, env) {
		const url = new URL(request.url);
		if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
		if (url.pathname !== '/catalogue') return new Response('Not found', { status: 404 });
		const rawPage = url.searchParams.get('page') ?? '1';
		const page = Number(rawPage);
		if (!/^\d+$/.test(rawPage) || !Number.isInteger(page) || page < 1 || page > 50) return Response.json({ error: 'Invalid page' }, { status: 400 });
		try {
			const snapshot = await env.CATALOGUE_SNAPSHOTS.get('latest', { type: 'json', cacheTtl: 30 });
			const age = Date.now() - Date.parse(snapshot?.fetchedAt);
			if (!snapshot || !Number.isFinite(age) || age < -60000 || age > MAX_AGE) throw new Error('No recent verified cloud snapshot');
			const { products, ...evidence } = snapshot;
			return Response.json({ ...evidence, page, products: products.slice((page - 1) * 100, page * 100) }, { headers: { 'cache-control': 'no-store' } });
		} catch (error) {
			return Response.json({ error: String(error.message || error) }, { status: 503, headers: { 'cache-control': 'no-store' } });
		}
	}
};
