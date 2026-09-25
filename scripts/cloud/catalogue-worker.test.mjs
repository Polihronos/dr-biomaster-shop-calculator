import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './catalogue-worker.mjs';

afterEach(() => vi.unstubAllGlobals());
const request = (path = '/catalogue', options) => new Request(`https://example.workers.dev${path}`, options);

describe('read-only public catalogue Worker', () => {
	it('fetches only the fixed public source and returns dated page evidence', async () => {
		const products = [{ id: 1 }];
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(products), { headers: { 'x-wp-total': '105' } }));
		vi.stubGlobal('fetch', fetch);
		const response = await worker.fetch(request('/catalogue?page=2&url=https://other.example'));
		expect(fetch.mock.calls[0][0]).toBe('https://drbiomaster.com/wp-json/wc/store/v1/products?per_page=100&page=2');
		expect(await response.json()).toMatchObject({ source: 'https://drbiomaster.com', page: 2, total: 105, products, fetchedAt: expect.any(String) });
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
	it('rejects writes, unrelated routes, and unbounded pages without a source request', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		expect((await worker.fetch(request('/catalogue', { method: 'POST' }))).status).toBe(405);
		expect((await worker.fetch(request('/other'))).status).toBe(404);
		for (const page of ['0', '-1', '101', '1.5', 'abc']) {
			expect((await worker.fetch(request(`/catalogue?page=${page}`))).status).toBe(400);
		}
		expect(fetch).not.toHaveBeenCalled();
	});
	it('fails closed on source rejection and missing pagination evidence', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })));
		expect((await worker.fetch(request())).status).toBe(502);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]')));
		expect((await worker.fetch(request())).status).toBe(502);
	});
});
