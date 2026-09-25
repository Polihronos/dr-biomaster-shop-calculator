// Public, read-only catalogue relay. No account data, credentials, or arbitrary URLs.
export default {
	async fetch(request) {
		const url = new URL(request.url);
		if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
		if (url.pathname !== '/catalogue') return new Response('Not found', { status: 404 });
		const rawPage = url.searchParams.get('page') ?? '1';
		const page = Number(rawPage);
		if (!/^\d+$/.test(rawPage) || !Number.isInteger(page) || page < 1 || page > 100) {
			return Response.json({ error: 'Invalid page' }, { status: 400 });
		}
		try {
			const response = await fetch(`https://drbiomaster.com/wp-json/wc/store/v1/products?per_page=100&page=${page}`, {
				signal: AbortSignal.timeout(30000)
			});
			if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`);
			const products = await response.json();
			const total = Number(response.headers.get('x-wp-total'));
			if (!Array.isArray(products) || !Number.isInteger(total) || total < 1 || products.length > 100) {
				throw new Error('Invalid catalogue response');
			}
			return Response.json({ source: 'https://drbiomaster.com', page, fetchedAt: new Date().toISOString(), total, products }, {
				headers: { 'cache-control': 'no-store' }
			});
		} catch (error) {
			return Response.json({ error: String(error.message || error) }, { status: 502, headers: { 'cache-control': 'no-store' } });
		}
	}
};
