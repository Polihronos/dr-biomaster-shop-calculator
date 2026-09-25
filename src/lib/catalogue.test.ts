import { describe, expect, it } from 'vitest';
import { compareCatalog, pricesFromStore, quantityPrice, validateStoreProducts, type StoreProduct } from './catalogue';

function product(text = '', overrides: Partial<StoreProduct> = {}): StoreProduct {
	return { id: 8077, name: 'Cannabimax Gold', short_description: text,
		prices: { price: '3320', regular_price: '3320', sale_price: '3320', currency_code: 'EUR', currency_minor_unit: 2 }, ...overrides };
}
const banner = '<p><img src="https://drbiomaster.com/cannabimax-gold-buy-2-get-3-new.png" alt="Промоция на Cannabimax Gold - плати 2 вземи 3"></p>';

describe('public promotion import and calculations', () => {
	it('imports the live banner without a product-specific rule', () => {
		const snapshot = pricesFromStore(product(banner, { id: 999 }));
		expect(snapshot.promotion).toEqual({ kind: 'bundle', buy: 3, pay: 2 });
		expect(snapshot.promotionWarnings).toEqual([]);
		for (const [quantity, charged, total] of [[1,1,33.2],[2,2,66.4],[3,2,66.4],[4,3,99.6],[6,4,132.8]]) {
			expect(quantityPrice(33.2, quantity, snapshot.promotion)).toMatchObject({ chargedQuantity: charged, lineTotal: total });
		}
	});
	it('uses the effective price, not an expired sale_price', () => {
		const snapshot = pricesFromStore(product('', { prices: { price: '3320', regular_price: '3320', sale_price: '2656', currency_code: 'EUR' } }));
		expect(snapshot.price).toBe(64.93);
		expect(snapshot.onSale).toBe(false);
	});
	it('does not apply the advertised ordinary/package percentage twice', () => {
		const snapshot = pricesFromStore(product('<p>ВЗЕМЕТЕ СЕГА С 10% ОТСТЪПКА</p><p>ПАКЕТ – ОТСТЪПКА от общата цена на продуктите – 10%</p>', {
			on_sale: true, prices: { price:'5976', regular_price:'6640', currency_code:'EUR' }
		}));
		expect(snapshot.promotion).toBeNull();
		expect(snapshot.promotionWarnings).toEqual([]);
		expect(snapshot.onSale).toBe(true);
	});
	it('supports explicitly stated quantity thresholds', () => {
		const snapshot = pricesFromStore(product('<p>При 2+ броя -10% отстъпка</p><p>От 3 броя -20% отстъпка</p>'));
		expect(snapshot.promotionWarnings).toEqual([]);
		expect(quantityPrice(33.2,1,snapshot.promotion).lineTotal).toBe(33.2);
		expect(quantityPrice(33.2,2,snapshot.promotion).lineTotal).toBe(59.76);
		expect(quantityPrice(33.2,3,snapshot.promotion).lineTotal).toBe(79.68);
	});
	it.each(['Плати 2 вземи 3 с купон GOLD', 'Подарък книга при поръчка над 55€', 'Промоция за лоялни клиенти', '<img src="https://example.com/promo.png" alt="Промоция">', 'Плати 2 вземи 3 до 30.09.2026', '<p>Плати 2 вземи 3</p><p>Само за нови клиенти</p>', 'Плати 2 вземи 3 и плати 3 вземи 4', 'Плати 2 вземи 3 ' + 'условия '.repeat(200) + 'с купон GOLD'])('flags unsupported conditions: %s', text => {
		const snapshot = pricesFromStore(product(text));
		expect(snapshot.promotion).toBeNull();
		expect(snapshot.promotionWarnings?.length).toBeGreaterThan(0);
	});
	it('keeps exact quantities distinct from open thresholds', () => {
		const snapshot = pricesFromStore(product('При 2 броя -10% отстъпка'));
		expect(quantityPrice(10, 2, snapshot.promotion).lineTotal).toBe(18);
		expect(quantityPrice(10, 3, snapshot.promotion).lineTotal).toBe(30);
	});
	it('recognizes explicit X for Y offers and flags ambiguous plus offers', () => {
		expect(pricesFromStore(product('Промоция: 3 за 2')).promotion).toEqual({kind:'bundle',buy:3,pay:2});
		expect(pricesFromStore(product('2+1')).promotionWarnings?.length).toBeGreaterThan(0);
	});
	it('ignores invalid manually saved bundle values', () => {
		expect(quantityPrice(10, 3, {kind:'bundle',buy:0,pay:0}).lineTotal).toBe(30);
	});
	it('does not guess whether a sale and bundle can be combined', () => {
		const snapshot = pricesFromStore(product(banner, {on_sale:true,prices:{price:'2656',regular_price:'3320',currency_code:'EUR'}}));
		expect(snapshot.promotion).toBeNull();
		expect(snapshot.promotionWarnings?.length).toBeGreaterThan(0);
	});
	it('flags conflicting offers rather than choosing one', () => {
		const snapshot = pricesFromStore(product('<p>Плати 2 вземи 3</p><p>Плати 3 вземи 4</p>'));
		expect(snapshot.promotion).toBeNull();
		expect(snapshot.promotionWarnings?.length).toBeGreaterThan(0);
	});
});

describe('shared live and scheduled check', () => {
	const local = () => [{id:'8077',name:'Cannabimax Gold', ...pricesFromStore(product(banner))}];
	it('detects removal when the unit price is unchanged and clears the rule', () => {
		const result = compareCatalog(local(), [product()]);
		expect(result.rows.some(row=>row.field==='Промоция')).toBe(true);
		expect(result.overrides['8077'].promotion).toBeNull();
	});
	it('detects changed bundle terms at the same price', () => {
		const result=compareCatalog(local(),[product('Плати 3 вземи 4')]);
		expect(result.overrides['8077'].promotion).toEqual({kind:'bundle',buy:4,pay:3});
		expect(result.rows.some(row=>row.field==='Промоция')).toBe(true);
	});
	it('never reports unresolved offers as fully matched', () => {
		const live = product('Промоция с купон GOLD');
		const result=compareCatalog([{id:'8077',name:'Gold',...pricesFromStore(live)}],[live]);
		expect(result.rows.some(row=>row.field==='Нужна проверка')).toBe(true);
	});
	it('detects new and removed products', () => {
		const result=compareCatalog(local(),[product('',{id:999})]);
		expect(result.rows.map(row=>row.field)).toEqual(['Нов продукт','Липсва в сайта']);
	});
	it('rejects errors, empty catalogues, duplicates, and missing prices', () => {
		expect(()=>validateStoreProducts({code:'error'})).toThrow();
		expect(()=>compareCatalog(local(),[])).toThrow();
		expect(()=>validateStoreProducts([product(),product()])).toThrow();
		expect(()=>validateStoreProducts([product('',{prices:undefined})])).toThrow();
	});
});
