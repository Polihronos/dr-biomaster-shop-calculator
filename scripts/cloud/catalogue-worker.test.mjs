import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './catalogue-worker.mjs';

afterEach(() => vi.unstubAllGlobals());
const request = (path = '/catalogue', options) => new Request(`https://example.workers.dev${path}`, options);
const product = id => ({ id, name: `Product ${id}`, prices: { price: '100' } });
const response = (products, total) => new Response(JSON.stringify(products), { headers: { 'x-wp-total': String(total) } });
const snapshot = (overrides = {}) => ({ source: 'https://drbiomaster.com', snapshotId: 'one', fetchedAt: new Date().toISOString(), total: 101, products: Array.from({length:101}, (_, i) => product(i + 1)), ...overrides });

describe('scheduled public catalogue Worker', () => {
	it('stores one complete snapshot only after all pages validate', async () => {
		const all = snapshot().products;
		const fetch = vi.fn().mockResolvedValueOnce(response(all.slice(0,100),101)).mockResolvedValueOnce(response(all.slice(100),101));
		vi.stubGlobal('fetch', fetch);
		const put = vi.fn();
		await worker.scheduled({}, { CATALOGUE_SNAPSHOTS: { put } });
		expect(fetch.mock.calls[1][0]).toBe('https://drbiomaster.com/wp-json/wc/store/v1/products?per_page=100&page=2');
		expect(put).toHaveBeenCalledTimes(1);
		expect(JSON.parse(put.mock.calls[0][1])).toMatchObject({ total: 101, products: all });
	});
	it.each(['rejected', 'missing', 'duplicate', 'changed'])('preserves the previous snapshot if a page is %s', async failure => {
		const all = snapshot().products;
		const second = failure === 'rejected' ? new Response('Forbidden', {status:403}) : response(failure === 'missing' ? [] : [product(failure === 'duplicate' ? 1 : 101)], failure === 'changed' ? 102 : 101);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(all.slice(0,100),101)).mockResolvedValueOnce(second));
		const put = vi.fn();
		await expect(worker.scheduled({}, {CATALOGUE_SNAPSHOTS:{put}})).rejects.toThrow();
		expect(put).not.toHaveBeenCalled();
	});
	it('serves dated pages without letting HTTP callers trigger source requests or writes', async () => {
		const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
		const data = snapshot(); const get = vi.fn().mockResolvedValue(data); const put = vi.fn();
		const result = await worker.fetch(request('/catalogue?page=2&url=https://other.example'), {CATALOGUE_SNAPSHOTS:{get,put}});
		expect(await result.json()).toEqual({...data,page:2,products:[product(101)]});
		expect(result.headers.get('cache-control')).toBe('no-store');
		expect(fetch).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
	});
	it.each([null, snapshot({fetchedAt:'bad'}), snapshot({fetchedAt:new Date(Date.now()-31*60*1000).toISOString()})])('rejects a missing or stale snapshot', async data => {
		const result = await worker.fetch(request(), {CATALOGUE_SNAPSHOTS:{get:vi.fn().mockResolvedValue(data)}});
		expect(result.status).toBe(503);
	});
	it('rejects writes, unrelated routes, and unbounded pages without storage access', async () => {
		expect((await worker.fetch(request('/catalogue', {method:'POST'}),{})).status).toBe(405);
		expect((await worker.fetch(request('/other'),{})).status).toBe(404);
		for (const page of ['0','-1','51','1.5','abc']) expect((await worker.fetch(request(`/catalogue?page=${page}`),{})).status).toBe(400);
	});
});
