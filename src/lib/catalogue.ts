export type QuantityPromotion =
	| { kind: 'bundle'; buy: number; pay: number }
	| { kind: 'tiers'; tiers: { min: number; max: number | null; percent: number }[] };

export type CatalogPrices = {
	price: number;
	regularPrice: number;
	onSale: boolean;
	promotion?: QuantityPromotion | null;
	promotionEvidence?: string[];
	promotionWarnings?: string[];
};

export type StoreProduct = {
	id: string | number;
	name?: string;
	permalink?: string;
	short_description?: string;
	description?: string;
	price_html?: string;
	on_sale?: boolean;
	is_password_protected?: boolean;
	has_options?: boolean;
	categories?: { name: string }[];
	images?: { src?: string; thumbnail?: string }[];
	extensions?: Record<string, unknown>;
	prices?: {
		currency_code?: string;
		currency_minor_unit?: number;
		price?: string | number;
		regular_price?: string | number;
		sale_price?: string | number;
	};
};

export function decodeEntities(value = '') {
	return value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
		.replace(/&euro;/g, '€').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

export function stripHtml(value = '') {
	return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Keep image alternative text: some offers are advertised only in banners.
function offerText(html: string) {
	return stripHtml(html.replace(/<img\b[^>]*>/gi, (tag) => {
		const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
		const promotional = /promo|offer|discount|buy[-_]?\d|sale[-_]|подарък|промоци|плати|отстъпк/i.test(tag);
		if (!promotional) return ` ${alt ?? ''} `;
		const src = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
		return ` Промоционално изображение: ${alt || 'без описание'} (${src}) `;
	}));
}

export function parsePromotion(product: StoreProduct, salePercent: number) {
	const html = `${product.short_description ?? ''}\n${product.description ?? ''}`;
	const conditional = /купон|промокод|промо код|\bcoupon\b|\bcode\b|лоялн|абонат|членов|нови клиенти|регистриран[а-я ]*(?:клиент|потребител)|поръчк[аи].*(?:над|минимум)|(?:валидн[^ ]*|до)\s*\d{1,2}[./]|до изчерпване|само веднъж|\bmembers?\b|\bsubscri\w+|\bfirst order\b|\bminimum spend\b|\bexpires?\b|\buntil\b/i;
	const isBook = product.categories?.some(category => /^книги$/i.test(stripHtml(category.name)));
	const evidence = [...new Set(html.split(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?\s*>/i)
		.map(offerText)
		.filter(text => !/^\d+\s*\+\s*\d+\s*=/.test(text))
		.filter(text => {
			// An informational service is not a product discount. Keep purchase conditions
			// and any other offer in the same paragraph available for review.
			if (conditional.test(text) || (/безплатн[аи]\s+консултаци[яи]/i.test(text) && /при\s+(?:покупка|поръчка)/i.test(text))) return true;
			let candidate = /консултаци/i.test(product.name ?? '') ? text
				: text.replace(/безплатн[аи]\s+консултаци[яи]/gi, 'консултация');
			// Book descriptions can advertise supplement packs. Remove only that
			// general statement, never an entire paragraph containing another offer.
			if (isBook && /моноекстракт/i.test(text)) candidate = candidate.replace(/Предлагаме и големи опаковки тип \d+-в-\d+, като в тяхната цена е включена (?:значителна )?отстъпка за потребителя\.?/gi, '');
			return /плати|вземи|подарък|купон|промоци|отстъпк|намалени[ея][^.!?]{0,50}(?:%|цен|лв|евро)|(?:^|\s)спести(?:\s|[!.:])|половин цена|безплат|\d+\s*(?:за|\+)\s*\d+|\bbuy\s+\d|\bdiscount\b|\bcoupon\b|\bfree\b|\boffer\b|\bsale\b|\bsave\s+\d|%\s*off\b/i.test(candidate) || /^[-−–]\s*\d+(?:[.,]\d+)?\s*%[!.]?$/.test(candidate);
		})
		.filter(text => !/без промоция|другите марки|промоционални\./i.test(text)))].sort();
	const bundles: { kind: 'bundle'; buy: number; pay: number }[] = [];
	const tiers: { min: number; max: number | null; percent: number }[] = [];
	const warnings: string[] = [];
	for (const text of evidence) {
		const lower = text.replace(/https?:\/\/[^\s)]+/g, '').toLocaleLowerCase('bg');
		// Conditional offers cannot be applied as unconditional product discounts.
		if (conditional.test(lower) || /еднократн|доставка/.test(lower)) {
			warnings.push(text); continue;
		}
		const payGet = lower.match(/плати\s+(\d+)\s*(?:бр(?:оя|ой)?\.?\s*)?[,–—-]?\s*вземи\s+(\d+)/);
		const getPay = lower.match(/(?:вземи|получи)\s+(\d+)\s*(?:бр(?:оя|ой)?\.?\s*)?[,–—-]?\s*плати\s+(\d+)/);
		const xForY = lower.match(/^(?:промоция[:\s–—-]*)?(\d+)\s+за\s+(\d+)(?:\s*бр(?:оя|ой)?\.?)?[!.]?$/);
		const english = lower.match(/buy\s+(\d+)\s+get\s+(\d+)\s+(?:free|безплатно)/);
		const bundle = payGet ? { buy: Number(payGet[2]), pay: Number(payGet[1]) }
			: getPay ? { buy: Number(getPay[1]), pay: Number(getPay[2]) }
			: xForY ? { buy: Number(xForY[1]), pay: Number(xForY[2]) }
			: english ? { buy: Number(english[1]) + Number(english[2]), pay: Number(english[1]) } : null;
		if (bundle && bundle.pay > 0 && bundle.buy > bundle.pay && (lower.match(/плати|\bbuy\b/g) ?? []).length <= 1 && !/подарък|%|само веднъж|еднократн/i.test(lower)) {
			bundles.push({ kind: 'bundle', ...bundle }); continue;
		}
		const tier = lower.match(/^(при|от)\s+(\d+)\s*(\+|и повече)?\s*(?:броя|бр\.?)(\s+и повече)?\s*[-–—:]?\s*(\d+(?:[.,]\d+)?)\s*%\s*отстъпка[!.]?$/);
		if (tier) {
			const min = Number(tier[2]), percent = Number(tier[5].replace(',', '.'));
			const max = tier[1] === 'от' || tier[3] || tier[4] ? null : min;
			if (min > 0 && percent > 0 && percent < 100) { tiers.push({ min, max, percent }); continue; }
		}
		const percent = lower.match(/(?:отстъпка[^\d%]{0,80}(\d+(?:[.,]\d+)?)\s*%|(\d+(?:[.,]\d+)?)\s*%\s*отстъпка)/);
		// A plain percentage already represented by the API must not be applied twice.
		if (percent && !/\d+\s*(?:бр\.?|броя)|подарък|плати|вземи|купон/i.test(lower)
			&& Math.abs(Number((percent[1] || percent[2]).replace(',', '.')) - salePercent) < 0.15) continue;
		warnings.push(text);
	}
	if (Object.keys(product.extensions ?? {}).some(key => /discount|promo|coupon/i.test(key))) {
		warnings.push('Допълнителни правила за промоция от сайта — нужна е проверка.');
	}
	const uniqueBundles = [...new Map(bundles.map(rule => [JSON.stringify(rule), rule])).values()];
	const uniqueTiers = [...new Map(tiers.map(rule => [JSON.stringify(rule), rule])).values()].sort((a,b)=>a.min-b.min);
	if (uniqueBundles.length > 1 || (uniqueBundles.length && uniqueTiers.length)
		|| uniqueTiers.some((tier, index) => index > 0 && tier.min === uniqueTiers[index-1].min)) warnings.push('Противоречиви условия на промоцията.');
	let promotion: QuantityPromotion | null = null;
	if (!warnings.length) {
		if (uniqueBundles.length === 1) promotion = uniqueBundles[0];
		else if (uniqueTiers.length) promotion = { kind: 'tiers', tiers: uniqueTiers };
	}
	return { promotion, promotionEvidence: evidence, promotionWarnings: [...new Set(warnings)].sort() };
}

export function pricesFromStore(product: StoreProduct): CatalogPrices {
	const prices = product.prices;
	if (!prices || !['EUR', 'BGN'].includes(prices.currency_code ?? '')) throw new Error(`Невалидна валута: ${product.id}`);
	const minorUnit = Number(prices.currency_minor_unit ?? 2);
	if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 4) throw new Error(`Невалиден формат на цена: ${product.id}`);
	const divisor = 10 ** minorUnit;
	const amount = (raw: string | number | undefined) => {
		if (raw === undefined || raw === '' || !Number.isFinite(Number(raw)) || Number(raw) < 0) throw new Error(`Невалидна цена: ${product.id}`);
		return Number((Number(raw) / divisor * (prices.currency_code === 'EUR' ? 1.95583 : 1)).toFixed(2));
	};
	// `price` is the currently effective price; sale_price can describe a stale sale.
	const price = amount(prices.price ?? prices.sale_price ?? prices.regular_price);
	const regularPrice = amount(prices.regular_price || prices.price);
	const onSale = Boolean(product.on_sale) && price < regularPrice;
	const percent = regularPrice > price ? 100 * (1-price/regularPrice) : 0;
	const offer = parsePromotion(product, percent);
	if (offer.promotion && onSale) {
		offer.promotionWarnings.push('Намалена цена и количествена промоция — съвместимостта им не е потвърдена.');
		offer.promotion = null;
	}
	return { price, regularPrice, onSale, ...offer };
}

export function promotionLabel(promotion?: QuantityPromotion | null): string {
	if (!promotion) return 'Няма';
	return promotion.kind === 'bundle' ? `${promotion.buy} за ${promotion.pay}`
		: promotion.tiers.map(tier => `${tier.min}${tier.max === null ? '+' : ''} бр. -${tier.percent}%`).join('; ');
}

export function quantityPrice(unitPrice: number, quantity: number, promotion?: QuantityPromotion | null) {
	let chargedQuantity = quantity;
	let percent = 0;
	if (promotion?.kind === 'bundle' && Number.isInteger(promotion.buy) && Number.isInteger(promotion.pay)
		&& promotion.pay > 0 && promotion.buy > promotion.pay) chargedQuantity = Math.floor(quantity / promotion.buy) * promotion.pay + quantity % promotion.buy;
	if (promotion?.kind === 'tiers') percent = promotion.tiers.filter(tier => quantity >= tier.min && (tier.max === null || quantity <= tier.max)).at(-1)?.percent ?? 0;
	return { chargedQuantity, percent, lineTotal: Number((unitPrice * chargedQuantity * (1-percent/100)).toFixed(2)) };
}

export function validateStoreProducts(value: unknown): asserts value is StoreProduct[] {
	if (!Array.isArray(value)) throw new Error('Невалиден отговор от каталога.');
	const ids = new Set<string>();
	for (const product of value) {
		if (!product || !/^\d+$/.test(String(product.id)) || ids.has(String(product.id)) || !product.name) throw new Error('Непълен каталог или повторен продукт.');
		ids.add(String(product.id));
		pricesFromStore(product);
	}
}

export function compareCatalog(local: (CatalogPrices & { id: string; name: string })[], live: StoreProduct[]) {
	validateStoreProducts(live);
	if (!live.length) throw new Error('Празен каталог от сайта.');
	const rows: { id: string; name: string; field: string; local: string; live: string }[] = [];
	const overrides: Record<string, CatalogPrices> = {};
	const localById = new Map(local.map(product => [product.id, product]));
	for (const product of live.filter(product => !product.is_password_protected)) {
		const id = String(product.id), current = localById.get(id), next = pricesFromStore(product);
		const name = stripHtml(product.name);
		if (!current) { rows.push({id,name,field:'Нов продукт',local:'Няма',live:'В сайта'}); continue; }
		localById.delete(id);
		overrides[id] = next;
		for (const field of ['price','regularPrice'] as const) {
			if (Math.abs(current[field]-next[field]) > 0.009) rows.push({id,name,field:field==='price'?'Цена':'Редовна цена',local:current[field].toFixed(2),live:next[field].toFixed(2)});
		}
		if (current.onSale !== next.onSale) rows.push({id,name,field:'Намаление',local:current.onSale?'Да':'Не',live:next.onSale?'Да':'Не'});
		if (JSON.stringify(current.promotion ?? null) !== JSON.stringify(next.promotion ?? null)) rows.push({id,name,field:'Промоция',local:promotionLabel(current.promotion),live:promotionLabel(next.promotion)});
		if (JSON.stringify(current.promotionEvidence ?? []) !== JSON.stringify(next.promotionEvidence ?? [])) rows.push({id,name,field:'Условия',local:(current.promotionEvidence ?? []).join('; ')||'Няма',live:(next.promotionEvidence ?? []).join('; ')||'Няма'});
		for (const warning of next.promotionWarnings ?? []) rows.push({id,name,field:'Нужна проверка',local:'Не е потвърдено',live:warning});
	}
	for (const product of localById.values()) rows.push({id:product.id,name:product.name,field:'Липсва в сайта',local:'В каталога',live:'Няма'});
	return { rows, overrides };
}
