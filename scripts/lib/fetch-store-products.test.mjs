import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchStoreProducts } from './fetch-store-products.mjs';

const product = id => ({ id, name: `Product ${id}`, prices: { price: '100', regular_price: '100', currency_code: 'EUR' } });
const response = (products, total = products.length) => new Response(JSON.stringify(products), {
	headers: { 'content-type': 'application/json', 'x-wp-total': String(total) }
});

afterEach(() => vi.unstubAllGlobals());

describe('complete public catalogue transport', () => {
	it('uses the standard query route when the pretty URL is unavailable', async () => {
		const fetch = vi.fn().mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
			.mockResolvedValueOnce(response([product(1)]));
		vi.stubGlobal('fetch', fetch);
		expect(await fetchStoreProducts()).toEqual([product(1)]);
		expect(fetch.mock.calls[1][0]).toContain('?rest_route=/wc/store/v1/products&per_page=100&page=1');
	});
	it('collects every page and rejects a duplicate across pages', async () => {
		const first = Array.from({ length: 100 }, (_, i) => product(i + 1));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(first, 101)).mockResolvedValueOnce(response([product(101)], 101)));
		expect(await fetchStoreProducts()).toHaveLength(101);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(first, 101)).mockResolvedValueOnce(response([product(1)], 101)));
		await expect(fetchStoreProducts()).rejects.toThrow('повторен продукт');
	});
	it('fails safely on a rejected fallback instead of returning an empty catalogue', async () => {
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('<h1>Forbidden</h1>', { status: 403 })));
		await expect(fetchStoreProducts()).rejects.toThrow('No catalogue was published');
	});
	it('rejects a catalogue whose total changes during pagination', async () => {
		const first = Array.from({ length: 100 }, (_, i) => product(i + 1));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(first, 101)).mockResolvedValueOnce(response([product(101)], 102)));
		await expect(fetchStoreProducts()).rejects.toThrow('count changed');
	});
});
