import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStoreProducts } from './fetch-store-products.mjs';

const product = id => ({ id, name: `Product ${id}`, prices: { price: '100', regular_price: '100', currency_code: 'EUR' } });
const response = (products, total = products.length) => new Response(JSON.stringify(products), {
	headers: { 'content-type': 'application/json', 'x-wp-total': String(total) }
});

beforeEach(() => vi.stubEnv('CATALOGUE_RELAY_URL', ''));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

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


describe('Cloudflare public catalogue relay', () => {
	const relayUrl = 'https://biomaster-catalogue.example.workers.dev/catalogue';
	const fetchedAt = new Date().toISOString();
	const envelope = (products, page = 1, total = products.length, overrides = {}) => new Response(JSON.stringify({
		source: 'https://drbiomaster.com', page, fetchedAt, snapshotId: overrides.fetchedAt ?? fetchedAt, total, products, ...overrides
	}));
	it('fetches and validates all pages through the configured relay', async () => {
		const first = Array.from({ length: 100 }, (_, i) => product(i + 1));
		const fetch = vi.fn().mockResolvedValueOnce(envelope(first, 1, 101)).mockResolvedValueOnce(envelope([product(101)], 2, 101));
		vi.stubGlobal('fetch', fetch);
		expect(await fetchStoreProducts({ relayUrl })).toHaveLength(101);
		expect(String(fetch.mock.calls[1][0])).toBe(`${relayUrl}?page=2`);
	});
	it.each([
		{ fetchedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() },
		{ fetchedAt: 'unknown' },
		{ fetchedAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
		{ source: 'https://other.example' },
		{ page: 2 },
		{ snapshotId: 'different' }
	])('rejects stale or mismatched evidence: %j', async overrides => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope([product(1)], 1, 1, overrides)));
		await expect(fetchStoreProducts({ relayUrl })).rejects.toThrow('Invalid or stale');
	});
	it('rejects upstream errors, invalid products, and missing totals', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Catalogue HTTP 403' }))));
		await expect(fetchStoreProducts({ relayUrl })).rejects.toThrow('HTTP 403');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope([{}])));
		await expect(fetchStoreProducts({ relayUrl })).rejects.toThrow();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(envelope([product(1)], 1, null)));
		await expect(fetchStoreProducts({ relayUrl })).rejects.toThrow('Invalid catalogue relay count');
	});
	it('rejects a snapshot replacement between pages even when totals match', async () => {
		const first = Array.from({ length: 100 }, (_, i) => product(i + 1));
		const nextTime = new Date(Date.now() + 1000).toISOString();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(envelope(first, 1, 101)).mockResolvedValueOnce(envelope([product(101)], 2, 101, {fetchedAt:nextTime,snapshotId:nextTime})));
		await expect(fetchStoreProducts({relayUrl})).rejects.toThrow('snapshot changed');
	});
	it('rejects an unrelated relay host before making a request', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		await expect(fetchStoreProducts({ relayUrl: 'https://example.com/macros/s/test/exec' })).rejects.toThrow('Invalid Cloudflare');
		expect(fetch).not.toHaveBeenCalled();
	});
});
