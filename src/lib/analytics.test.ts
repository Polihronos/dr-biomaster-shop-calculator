import { describe, expect, it } from 'vitest';
import {
	loadAnalytics,
	normalizeLookup,
	parseMoneyEur,
	parseOrderFile,
	summarizeAnalytics,
	type AnalyticsGeography
} from './analytics';
import { serializeSalesFile, type DirectoryHandleLike, type FileHandleLike } from './daily-sales';
import type { Product } from './products';

class MemoryFile implements FileHandleLike {
	constructor(public name: string, private contents: string) {}
	async getFile() {
		return { text: async () => this.contents };
	}
	async createWritable() {
		return { write: async () => {}, close: async () => {} };
	}
}

class MemoryDirectory implements DirectoryHandleLike {
	files = new Map<string, MemoryFile>();
	directories = new Map<string, MemoryDirectory>();
	constructor(public name: string) {}
	addFile(name: string, contents: string) {
		this.files.set(name, new MemoryFile(name, contents));
		return this;
	}
	addDirectory(directory: MemoryDirectory) {
		this.directories.set(directory.name, directory);
		return this;
	}
	async getDirectoryHandle(name: string) {
		const directory = this.directories.get(name);
		if (!directory) throw new DOMException('Missing', 'NotFoundError');
		return directory;
	}
	async getFileHandle(name: string) {
		const file = this.files.get(name);
		if (!file) throw new DOMException('Missing', 'NotFoundError');
		return file;
	}
	async *values() {
		yield* this.directories.values();
		yield* this.files.values();
	}
}

const GEOGRAPHY: AnalyticsGeography = {
	sources: { nuts: 'test', settlements: 'test' },
	viewBox: '0 0 10 10',
	regions: [
		{ id: 'BG411', name: 'София (столица)', path: '', centroid: [5, 5] },
		{ id: 'BG341', name: 'Бургас', path: '', centroid: [8, 8] }
	],
	settlements: [
		{ n: 'София', e: 'Sofia', r: 'BG411', t: 1 },
		{ n: 'Бургас', e: 'Burgas', r: 'BG341', t: 1 }
	]
};

const PRODUCTS: Product[] = [
	{
		id: 'p1',
		name: 'КОРИОЛУС MRL, 90 капсули / 500 mg',
		category: 'Гъби',
		price: 50,
		regularPrice: 50,
		onSale: false,
		hasOptions: false,
		image: '',
		imageLarge: '',
		sourceUrl: '',
		shortDescription: '',
		priceLabel: '50.00 лв.'
	}
];

describe('analytics parsing and normalization', () => {
	it('normalizes case, punctuation, accents, and currencies', () => {
		expect(normalizeLookup('  ГР. СОФИЯ ')).toBe('гр софия');
		expect(parseMoneyEur('19,5583 лв.')).toBe(10);
		expect(parseMoneyEur('25.50 EUR')).toBe(25.5);
	});

	it('reads JSON-backed and readable order rows', () => {
		const json = JSON.stringify({ orderNumber: '1', city: 'СОФИЯ', name: 'Иван', products: 'Кориолус x2', sum: '20 EUR' });
		const records = parseOrderFile(`# Date: 01.08.2026\n#1 | СОФИЯ | Иван | Кориолус x2 | 20 EUR\t${json}\n`, '2026-08-01');
		expect(records).toHaveLength(1);
		expect(records[0].city).toBe('СОФИЯ');
	});
});

describe('file-backed analytics', () => {
	it('combines extension orders and Sofia shop sales with fuzzy product matching', async () => {
		const order = {
			orderNumber: '30001',
			date: '2026-08-01',
			createdAt: '2026-08-01T10:00:00.000Z',
			city: 'ГР. БУРГАС',
			name: 'ИВАН ИВАНОВ',
			products: 'Кориолус MRL 90 капс x2',
			sum: '50.00 EUR'
		};
		const orders = new MemoryDirectory('daily orders').addFile('01-08-2026.txt', `# Dr. Biomaster Daily Orders v1\n#30001 | Бургас | Иван | Кориолус x2 | 50 EUR\t${JSON.stringify(order)}\n`);
		const sales = new MemoryDirectory('daily sales').addFile(
					'02-08-2026.txt',
					serializeSalesFile('2026-08-02', [
						{
							id: 'sale-1',
							createdAt: '2026-08-02T12:00:00.000Z',
							payment: 'cash',
							globalDiscount: 0,
							items: [{ productId: 'p1', name: PRODUCTS[0].name, quantity: 1, unitPrice: 30, discountPercent: 0 }],
							total: 30
						}
					])
				);

		const loaded = await loadAnalytics({ orders, sales }, PRODUCTS, GEOGRAPHY);
		expect(loaded.transactions).toHaveLength(2);
		expect(loaded.transactions[0]).toMatchObject({ city: 'Бургас', regionId: 'BG341', revenueEur: 50 });
		expect(loaded.transactions[1]).toMatchObject({ city: 'София', regionId: 'BG411', revenueEur: 30 });
		expect(loaded.transactions.every((transaction) => transaction.items[0].matched)).toBe(true);

		const summary = summarizeAnalytics(loaded.transactions, { source: 'all', from: '', to: '' }, GEOGRAPHY);
		expect(summary).toMatchObject({ transactions: 2, units: 3, revenue: 80, uniqueCities: 2, uniqueClients: 1 });
		expect(summary.products[0]).toMatchObject({ units: 3, transactions: 2 });
		expect(summary.cities.map((city) => city.name).sort()).toEqual(['Бургас', 'София']);
	});
});
