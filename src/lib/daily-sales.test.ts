import { describe, expect, it } from 'vitest';
import {
	appendSale,
	calculateSaleTotal,
	dateKeyFromFileName,
	displayDate,
	fileNameForDate,
	listSalesDays,
	parseSalesFile,
	readSalesDay,
	serializeSalesFile,
	writeSalesDay,
	type DailySale,
	type DirectoryHandleLike,
	type FileHandleLike
} from './daily-sales';

const CASH_SALE: DailySale = {
	id: 'sale-1',
	createdAt: '2026-08-04T09:15:00.000Z',
	payment: 'cash',
	globalDiscount: 10,
	items: [
		{ productId: 'a', name: 'Продукт A', quantity: 2, unitPrice: 20, discountPercent: 25 },
		{ productId: 'c', name: 'Продукт C', quantity: 1, unitPrice: 40, discountPercent: 0 }
	],
	total: 63
};

class MemoryFile implements FileHandleLike {
	constructor(public name: string, private files: Map<string, string>) {}

	async getFile() {
		const contents = this.files.get(this.name) ?? '';
		return { text: async () => contents };
	}

	async createWritable() {
		let contents = '';
		return {
			write: async (data: string) => {
				contents = data;
			},
			close: async () => {
				this.files.set(this.name, contents);
			}
		};
	}
}

class MemoryDirectory implements DirectoryHandleLike {
	name = 'daily sales';
	files = new Map<string, string>();

	async getDirectoryHandle() {
		return this;
	}

	async getFileHandle(name: string, options?: { create?: boolean }) {
		if (!this.files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
		if (!this.files.has(name)) this.files.set(name, '');
		return new MemoryFile(name, this.files);
	}

	async *values() {
		for (const name of this.files.keys()) yield new MemoryFile(name, this.files);
	}
}

describe('daily sales format', () => {
	it('uses Windows-safe filenames and Bulgarian display dates', () => {
		expect(fileNameForDate('2026-08-04')).toBe('04-08-2026.txt');
		expect(dateKeyFromFileName('04-08-2026.txt')).toBe('2026-08-04');
		expect(dateKeyFromFileName('notes.txt')).toBeNull();
		expect(displayDate('2026-08-04')).toBe('04/08/2026');
	});

	it('calculates item and global percentage discounts', () => {
		expect(calculateSaleTotal(CASH_SALE)).toBe(63);
	});

	it('round-trips losslessly while keeping each row human-readable', () => {
		const contents = serializeSalesFile('2026-08-04', [CASH_SALE]);
		expect(contents).toContain('1: Продукт A x2 , Продукт C x1 - 63.00 EUR - 💵 CASH');
		expect(parseSalesFile(contents)).toEqual([CASH_SALE]);
	});

	it('ignores malformed or manually added lines safely', () => {
		expect(parseSalesFile('# heading\nnot a sale\n1: broken\t{nope}\n')).toEqual([]);
	});
});

describe('daily sales file operations', () => {
	it('creates, reads, overwrites, appends, and lists dated text files', async () => {
		const directory = new MemoryDirectory();
		await writeSalesDay(directory, '2026-08-03', []);
		await writeSalesDay(directory, '2026-08-04', [CASH_SALE]);
		await appendSale(directory, { ...CASH_SALE, id: 'sale-2', payment: 'card' });

		const day = await readSalesDay(directory, '2026-08-04');
		expect(day.sales.map((sale) => sale.id)).toEqual(['sale-1', 'sale-2']);
		expect(day.sales[1].payment).toBe('card');
		expect(await listSalesDays(directory)).toEqual(['2026-08-04', '2026-08-03']);

		await writeSalesDay(directory, '2026-08-04', [day.sales[1]]);
		expect((await readSalesDay(directory, '2026-08-04')).sales).toHaveLength(1);
	});

	it('returns an empty day when the text file does not exist', async () => {
		const day = await readSalesDay(new MemoryDirectory(), '2026-08-02');
		expect(day.sales).toEqual([]);
	});
});
