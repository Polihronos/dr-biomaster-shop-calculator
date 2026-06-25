<script lang="ts">
	import {
		BadgePercent,
		Check,
		CircleMinus,
		CirclePlus,
		Edit3,
		ExternalLink,
		RefreshCcw,
		RotateCcw,
		Search,
		ShoppingBasket,
		Trash2,
		X
	} from '@lucide/svelte';
	import { catalogUpdatedAt, products, type Product } from '$lib/products';

	type Selection = Record<string, number>;
	type Overrides = Record<string, number>;
	type DiscountMap = Record<string, number>;
	type SaleMap = Record<string, boolean>;
	type PromoMap = Record<string, { buy: number; pay: number }>;
	type PersistedState = {
		selection?: Selection;
		priceOverrides?: Overrides;
		productDiscounts?: DiscountMap;
		saleOverrides?: SaleMap;
		promotions?: PromoMap;
		globalDiscount?: number;
	};

	const BGN_PER_EUR = 1.95583;
	const STORAGE_KEY = 'dr-biomaster-shop-calculator-v2';
	const ALL_CATEGORIES = 'Всички';
	const categories = [ALL_CATEGORIES, ...new Set(products.map((product) => product.category))];
	const quickDiscounts = [3, 5, 10];
	const packageRules = [
		{ label: 'ПАКЕТ „АНТИСТРЕС“', terms: ['антистрес'] },
		{ label: 'ПАКЕТ „ИМУНИТЕТ“', terms: ['имюн', 'имунити'] },
		{ label: 'ПАКЕТ „МЕТАБОЛИЗЪМ И ИР“', terms: ['ямакиро', 'майтаке'] },
		{ label: 'ПАКЕТ „СТАВИ“', terms: ['куркумин'] },
		{ label: 'ПАКЕТ „СЪРДЕЧНО-СЪДОВА СИСТЕМА“', terms: ['супер формула'] },
		{ label: 'ПАКЕТ „ХРАНОСМИЛАТЕЛНА СИСТЕМА“', terms: ['детокс', 'алое'] },
		{ label: 'ПАКЕТ „ЗДРАВИ КЛЕТКИ“', terms: ['амигдалин', 'есияк'] },
		{ label: 'Комплект д-р Хулда Кларк', terms: ['хулда кларк'] }
	];

	let selection: Selection = $state({});
	let priceOverrides: Overrides = $state({});
	let productDiscounts: DiscountMap = $state({});
	let saleOverrides: SaleMap = $state({});
	let promotions: PromoMap = $state({});
	let globalDiscount = $state(0);
	let query = $state('');
	let activeCategory = $state(ALL_CATEGORIES);
	let onlySale = $state(false);
	let editMode = $state(false);

	const selectedRows = $derived(products.filter((product) => (selection[product.id] ?? 0) > 0).map(rowForProduct));
	const subtotal = $derived(selectedRows.reduce((total, row) => total + row.lineTotal, 0));
	const total = $derived(subtotal * (1 - globalDiscount / 100));
	const selectedCount = $derived(Object.values(selection).reduce((sum, quantity) => sum + quantity, 0));
	const filteredProducts = $derived(
		products
			.filter((product) => {
				const row = rowForProduct(product);
				const matchesCategory = activeCategory === ALL_CATEGORIES || product.category === activeCategory;
				const normalizedQuery = normalizeText(query.trim());
				const searchable = normalizeText(`${product.name} ${product.category}`);
				const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
				const matchesSale = !onlySale || row.isOnSale;

				return matchesCategory && matchesQuery && matchesSale;
			})
			.toSorted((a, b) => productSortRank(a) - productSortRank(b) || a.name.localeCompare(b.name, 'bg'))
	);
	const packageMatches = $derived(
		packageRules.filter((rule) => {
			const packageProductSelected = selectedRows.some(
				(row) => isPackageProduct(row.product) && normalizeText(row.product.name).includes(normalizeText(rule.label))
			);
			const termMatch = rule.terms.some((term) =>
				selectedRows.some((row) => !isPackageProduct(row.product) && normalizeText(row.product.name).includes(term))
			);

			return packageProductSelected || termMatch;
		})
	);

	$effect(() => {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;

		try {
			const saved = JSON.parse(raw) as PersistedState;
			selection = saved.selection ?? {};
			priceOverrides = saved.priceOverrides ?? {};
			productDiscounts = saved.productDiscounts ?? {};
			saleOverrides = saved.saleOverrides ?? {};
			promotions = saved.promotions ?? {};
			globalDiscount = saved.globalDiscount ?? 0;
		} catch {
			localStorage.removeItem(STORAGE_KEY);
		}
	});

	$effect(() => {
		const payload: PersistedState = {
			selection: $state.snapshot(selection),
			priceOverrides: $state.snapshot(priceOverrides),
			productDiscounts: $state.snapshot(productDiscounts),
			saleOverrides: $state.snapshot(saleOverrides),
			promotions: $state.snapshot(promotions),
			globalDiscount
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	});

	function bgnToEur(value: number) {
		return Number((value / BGN_PER_EUR).toFixed(2));
	}

	function eurToBgn(value: number) {
		return Number((value * BGN_PER_EUR).toFixed(2));
	}

	function money(valueEur: number) {
		return `€${valueEur.toFixed(2)} / ${eurToBgn(valueEur).toFixed(2)} лв.`;
	}

	function normalizeText(value: string) {
		return value.toLocaleLowerCase('bg').normalize('NFKC');
	}

	function isPackageProduct(product: Product) {
		const text = normalizeText(`${product.category} ${product.name}`);
		return text.includes('комплект') || text.includes('пакет');
	}

	function isTicketProduct(product: Product) {
		return normalizeText(`${product.category} ${product.name}`).includes('билет');
	}

	function isBookProduct(product: Product) {
		return normalizeText(product.category).includes('книг');
	}

	function isHawlikProduct(product: Product) {
		const text = normalizeText(product.name);
		return text.includes('hawlik') || text.includes('био женска сила') || text.includes('био релакс');
	}

	function isOtherProduct(product: Product) {
		const text = normalizeText(`${product.category} ${product.name}`);
		return (
			text.includes('други продукти') ||
			text.includes('cibdol') ||
			text.includes('enecta') ||
			text.includes('alchemic') ||
			text.includes('lactoflor') ||
			text.includes('парапротекс') ||
			text.includes('алое вера') ||
			text.includes('сибирска чага') ||
			text.includes('био хуск') ||
			text.includes('сода') ||
			text.includes('рибено масло')
		);
	}

	function productSortRank(product: Product) {
		if (activeCategory !== ALL_CATEGORIES) return 0;
		if (isTicketProduct(product)) return 5;
		if (isPackageProduct(product)) return 4;
		if (isBookProduct(product)) return 3;
		if (isHawlikProduct(product)) return 1;
		if (isOtherProduct(product)) return 2;
		return 0;
	}

	function packagingBadges(product: Product) {
		const text = normalizeText(product.name);
		const badges = [];
		const capsules = text.match(/(\d+)\s*(капс|капсули|caps)/);
		const grams = text.match(/(\d+(?:[.,]\d+)?)\s*(g|гр|грама)/);
		const milliliters = text.match(/(\d+(?:[.,]\d+)?)\s*(ml|мл)/);
		const cbd = text.match(/(\d+(?:[.,]\d+)?)\s*%\s*cbd/);
		const milligrams = text.match(/(\d+)\s*mg/);

		if (text.includes('прах') || text.includes('прахо') || text.includes('чай')) {
			badges.push(grams ? `прах ${grams[1]} g` : 'прах');
		}

		if (capsules) badges.push(`${capsules[1]} капс.`);
		if (milliliters) badges.push(`${milliliters[1]} ml`);
		if (cbd) badges.push(`${cbd[1]}% CBD`);
		if (milligrams && badges.length < 2) badges.push(`${milligrams[1]} mg`);

		return [...new Set(badges)].slice(0, 3);
	}

	function regularPriceEur(product: Product) {
		return bgnToEur(product.regularPrice || product.price);
	}

	function currentCatalogPriceEur(product: Product) {
		return bgnToEur(product.price);
	}

	function isSaleEnabled(product: Product) {
		return saleOverrides[product.id] ?? product.onSale;
	}

	function catalogSalePercent(product: Product) {
		const regular = regularPriceEur(product);
		const current = currentCatalogPriceEur(product);
		if (regular <= current) return 0;
		return Number((((regular - current) / regular) * 100).toFixed(1));
	}

	function effectiveUnitPriceEur(product: Product) {
		const manualPrice = priceOverrides[product.id];
		if (manualPrice !== undefined) return manualPrice;

		const regular = regularPriceEur(product);
		const saleDiscount = productDiscounts[product.id];
		if (isSaleEnabled(product) && saleDiscount) {
			return Number((regular * (1 - saleDiscount / 100)).toFixed(2));
		}

		if (isSaleEnabled(product) && product.onSale) {
			return currentCatalogPriceEur(product);
		}

		return regular;
	}

	function effectiveSalePercent(product: Product) {
		if (!isSaleEnabled(product)) return 0;

		const custom = productDiscounts[product.id];
		if (custom) return custom;

		const regular = regularPriceEur(product);
		const current = effectiveUnitPriceEur(product);
		if (regular <= current) return 0;

		return Number((((regular - current) / regular) * 100).toFixed(1));
	}

	function rowForProduct(product: Product) {
		const quantity = selection[product.id] ?? 0;
		const unitPrice = effectiveUnitPriceEur(product);
		const salePercent = effectiveSalePercent(product);
		const promo = promotions[product.id];
		const chargedQuantity =
			promo && promo.buy > 0 && promo.pay > 0 && promo.pay < promo.buy
				? Math.floor(quantity / promo.buy) * promo.pay + (quantity % promo.buy)
				: quantity;
		const lineTotal = unitPrice * chargedQuantity;

		return {
			product,
			quantity,
			unitPrice,
			regularPrice: regularPriceEur(product),
			isOnSale: isSaleEnabled(product),
			salePercent,
			promo,
			chargedQuantity,
			lineTotal
		};
	}

	function changeQuantity(product: Product, delta: number) {
		const current = selection[product.id] ?? 0;
		const next = Math.max(0, current + delta);

		if (next === 0) {
			delete selection[product.id];
			return;
		}

		selection[product.id] = next;
	}

	function setQuantity(product: Product, value: number | undefined) {
		const next = Math.max(0, Number(value ?? 0));

		if (!next) {
			delete selection[product.id];
			return;
		}

		selection[product.id] = next;
	}

	function setPrice(product: Product, value: number | undefined) {
		const next = Number(value ?? effectiveUnitPriceEur(product));
		if (!Number.isFinite(next) || next <= 0 || Math.abs(next - effectiveUnitPriceEur(product)) < 0.001) {
			delete priceOverrides[product.id];
			return;
		}

		priceOverrides[product.id] = Number(next.toFixed(2));
	}

	function setSaleDiscount(product: Product, value: number | undefined) {
		const next = Math.min(100, Math.max(0, Number(value ?? 0)));
		if (!next) {
			delete productDiscounts[product.id];
			return;
		}

		productDiscounts[product.id] = next;
		saleOverrides[product.id] = true;
		delete priceOverrides[product.id];
	}

	function setSale(product: Product, enabled: boolean) {
		saleOverrides[product.id] = enabled;
		delete priceOverrides[product.id];

		if (enabled && !productDiscounts[product.id] && !product.onSale) {
			productDiscounts[product.id] = 10;
		}

		if (!enabled) {
			delete productDiscounts[product.id];
		}
	}

	function setPromotion(product: Product, buy: number | undefined, pay: number | undefined) {
		const normalizedBuy = Math.max(0, Math.floor(Number(buy ?? 0)));
		const normalizedPay = Math.max(0, Math.floor(Number(pay ?? 0)));

		if (normalizedBuy < 2 || normalizedPay < 1 || normalizedPay >= normalizedBuy) {
			delete promotions[product.id];
			return;
		}

		promotions[product.id] = { buy: normalizedBuy, pay: normalizedPay };
	}

	function resetSaleTools() {
		globalDiscount = 0;
		productDiscounts = {};
		saleOverrides = {};
		promotions = {};
	}

	function clearCart() {
		selection = {};
	}

	function resetEdits() {
		priceOverrides = {};
		productDiscounts = {};
		saleOverrides = {};
		promotions = {};
		globalDiscount = 0;
	}

	function openProduct(product: Product) {
		window.open(product.sourceUrl, '_blank', 'noopener,noreferrer');
	}
</script>

<svelte:head>
	<title>Dr. Biomaster Shop Calculator</title>
	<meta
		name="description"
		content="Frontend calculator for Dr. Biomaster product prices, discounts, and shop promotions."
	/>
</svelte:head>

<main>
	<header class="topbar">
		<div class="brand">
			<ShoppingBasket size={24} />
			<div>
				<strong>Dr. Biomaster</strong>
				<span>{products.length} продукта</span>
			</div>
		</div>

		<div class="total">
			<span>Общо</span>
			<strong>{money(total)}</strong>
			{#if globalDiscount > 0}
				<small>-{globalDiscount}% върху кошницата</small>
			{/if}
		</div>

		<div class="actions">
			<button class="icon-button" title="Редакция" aria-label="Редакция" onclick={() => (editMode = true)}>
				<Edit3 size={20} />
			</button>
			<button class="icon-button" title="Изчисти кошницата" aria-label="Изчисти кошницата" onclick={clearCart}>
				<Trash2 size={20} />
			</button>
		</div>
	</header>

	<section class="toolbar">
		<label class="search">
			<Search size={18} />
			<input bind:value={query} type="search" placeholder="Търси продукт" />
		</label>

		<select bind:value={activeCategory} aria-label="Категория">
			{#each categories as category (category)}
				<option>{category}</option>
			{/each}
		</select>

		<label class="toggle">
			<input type="checkbox" bind:checked={onlySale} />
			<span>Само промоции</span>
		</label>
	</section>

	<section class="quick-strip">
		<span>Бърза отстъпка</span>
		{#each quickDiscounts as discount (discount)}
			<button onclick={() => (globalDiscount = discount)}>-{discount}%</button>
		{/each}
		<button onclick={resetSaleTools}>
			<RotateCcw size={16} />
			Нулирай
		</button>
	</section>

	{#if packageMatches.length > 0}
		<section class="package-strip" aria-label="Разпознати пакети">
			<strong>Пакет избран</strong>
			{#each packageMatches as match (match.label)}
				<span>{match.label}</span>
			{/each}
		</section>
	{/if}

	<section class="content">
		<div class="grid" aria-label="Продукти">
			{#each filteredProducts as product (product.id)}
				{@const row = rowForProduct(product)}
				{@const badges = packagingBadges(product)}
				<article class={['product-card', row.quantity > 0 && 'selected']}>
					<button
						class="product-main"
						aria-pressed={row.quantity > 0}
						onclick={() => changeQuantity(product, 1)}
					>
						<div class="image-wrap">
							{#if product.image}
								<img src={product.image} alt={product.name} loading="lazy" />
							{:else}
								<div class="placeholder">{product.name.slice(0, 2)}</div>
							{/if}
							{#if row.isOnSale}
								<span class="sale"><BadgePercent size={14} /> -{row.salePercent}%</span>
							{/if}
							{#if row.quantity > 0}
								<span class="picked"><Check size={16} /> {row.quantity}</span>
							{/if}
							{#if badges.length > 0}
								<div class="variant-badges">
									{#each badges as badge (badge)}
										<span>{badge}</span>
									{/each}
								</div>
							{/if}
						</div>

						<span class="category">{product.category}</span>
						<strong>{product.name}</strong>
						<span class="price">
							{money(row.unitPrice)}
							{#if row.isOnSale && row.regularPrice > row.unitPrice}
								<small>{money(row.regularPrice)}</small>
							{/if}
						</span>
					</button>

					{#if row.quantity > 0}
						<div class="card-controls">
							<button
								class="decrease"
								title="Намали"
								aria-label="Намали"
								onclick={() => changeQuantity(product, -1)}
							>
								<CircleMinus size={18} />
							</button>
							<button class="remove" title="Премахни" aria-label="Премахни" onclick={() => setQuantity(product, 0)}>
								<X size={18} />
							</button>
							<button
								class="increase"
								title="Увеличи"
								aria-label="Увеличи"
								onclick={() => changeQuantity(product, 1)}
							>
								<CirclePlus size={18} />
							</button>
						</div>
					{/if}
				</article>
			{/each}
		</div>

		<aside class="cart" aria-label="Избрани продукти">
			<div class="cart-head">
				<div>
					<strong>Кошница</strong>
					<span>{selectedCount} бр.</span>
				</div>
				<button class="text-button" onclick={clearCart}>Изчисти</button>
			</div>

			{#if selectedRows.length === 0}
				<p class="empty">Няма избрани продукти.</p>
			{:else}
				<div class="cart-list">
					{#each selectedRows as row (row.product.id)}
						<div class="cart-row">
							<div>
								<strong>{row.product.name}</strong>
								<span>{money(row.unitPrice)} x {row.chargedQuantity}</span>
								{#if row.isOnSale || row.promo}
									<small>
										{#if row.isOnSale}-{row.salePercent}%{/if}
										{#if row.promo} {row.promo.buy} за {row.promo.pay}{/if}
									</small>
								{/if}
							</div>

							<div class="qty">
								<button title="Намали" aria-label="Намали" onclick={() => changeQuantity(row.product, -1)}>
									<CircleMinus size={18} />
								</button>
								<input
									type="number"
									min="0"
									value={row.quantity}
									oninput={(event) =>
										setQuantity(row.product, Number((event.currentTarget as HTMLInputElement).value))}
									aria-label={`Количество ${row.product.name}`}
								/>
								<button title="Увеличи" aria-label="Увеличи" onclick={() => changeQuantity(row.product, 1)}>
									<CirclePlus size={18} />
								</button>
							</div>

							<strong class="line-total">{money(row.lineTotal)}</strong>
						</div>
					{/each}
				</div>
			{/if}
		</aside>
	</section>

	<footer>
		<span>Данни от drbiomaster.com, обновени {new Date(catalogUpdatedAt).toLocaleDateString('bg-BG')}</span>
	</footer>
</main>

{#if editMode}
	<div class="modal-backdrop">
		<section class="modal" aria-label="Редакция на цени и промоции">
			<header>
				<div>
					<strong>Редакция</strong>
					<span>Цените са в евро. Еквивалентът в лева се смята по 1 EUR = 1.95583 BGN.</span>
				</div>
				<button class="icon-button" title="Затвори" aria-label="Затвори" onclick={() => (editMode = false)}>
					<X size={20} />
				</button>
			</header>

			<div class="editor-tools">
				<label>
					Отстъпка за цялата кошница
					<input type="number" min="0" max="100" step="0.1" bind:value={globalDiscount} />
				</label>
				<button onclick={() => (globalDiscount = 3)}>-3%</button>
				<button onclick={() => (globalDiscount = 10)}>-10%</button>
				<button onclick={resetEdits}>
					<RefreshCcw size={16} />
					Нулирай редакции
				</button>
			</div>

			<div class="editor-list">
				{#each selectedRows as row (row.product.id)}
					<div class="editor-row">
						<img src={row.product.image} alt={row.product.name} loading="lazy" />
						<div class="editor-main">
							<div class="editor-title">
								<strong>{row.product.name}</strong>
								<button type="button" onclick={() => openProduct(row.product)} aria-label="Отвори продукта">
									<ExternalLink size={16} />
								</button>
							</div>

							<div class="fields">
								<label>
									Цена €
									<input
										type="number"
										min="0"
										step="0.01"
										value={row.unitPrice}
										oninput={(event) =>
											setPrice(row.product, Number((event.currentTarget as HTMLInputElement).value))}
									/>
								</label>
								<label>
									Промо
									<select
										value={row.isOnSale ? 'yes' : 'no'}
										onchange={(event) =>
											setSale(row.product, (event.currentTarget as HTMLSelectElement).value === 'yes')}
									>
										<option value="yes">Да</option>
										<option value="no">Не</option>
									</select>
								</label>
								<label>
									Промо %
									<input
										type="number"
										min="0"
										max="100"
										step="0.1"
										value={row.salePercent || catalogSalePercent(row.product)}
										oninput={(event) =>
											setSaleDiscount(row.product, Number((event.currentTarget as HTMLInputElement).value))}
									/>
								</label>
								<label>
									Вземи
									<input
										type="number"
										min="0"
										step="1"
										value={row.promo?.buy ?? ''}
										oninput={(event) =>
											setPromotion(
												row.product,
												Number((event.currentTarget as HTMLInputElement).value),
												row.promo?.pay
											)}
									/>
								</label>
								<label>
									Плати
									<input
										type="number"
										min="0"
										step="1"
										value={row.promo?.pay ?? ''}
										oninput={(event) =>
											setPromotion(
												row.product,
												row.promo?.buy,
												Number((event.currentTarget as HTMLInputElement).value)
											)}
									/>
								</label>
							</div>
						</div>
					</div>
				{:else}
					<p class="empty">Избери продукт, за да редактираш цена или промоция.</p>
				{/each}
			</div>
		</section>
	</div>
{/if}

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: #f6f4ef;
		color: #20231f;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}

	button,
	input,
	select {
		font: inherit;
	}

	button {
		cursor: pointer;
	}

	main {
		min-height: 100vh;
	}

	.topbar {
		position: sticky;
		top: 0;
		z-index: 10;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 16px;
		padding: 12px clamp(14px, 3vw, 32px);
		border-bottom: 1px solid #d8d5ca;
		background: rgb(246 244 239 / 94%);
		backdrop-filter: blur(10px);
	}

	.brand,
	.actions,
	.total,
	.quick-strip,
	.search,
	.toggle,
	.cart-head,
	.qty,
	.card-controls,
	.editor-tools,
	.editor-title {
		display: flex;
		align-items: center;
	}

	.brand {
		gap: 10px;
	}

	.brand div,
	.cart-head div {
		display: grid;
		gap: 2px;
	}

	.brand span,
	.cart-head span,
	footer,
	.modal header span {
		color: #6b6a63;
		font-size: 0.82rem;
	}

	.total {
		justify-self: center;
		flex-direction: column;
		min-width: 270px;
		text-align: center;
	}

	.total span {
		color: #67645c;
		font-size: 0.82rem;
	}

	.total strong {
		font-size: clamp(1.35rem, 3vw, 2.2rem);
		line-height: 1;
	}

	.total small {
		color: #2f7a57;
		font-weight: 700;
	}

	.actions {
		justify-self: end;
		gap: 8px;
	}

	.icon-button,
	.qty button,
	.card-controls button {
		display: inline-grid;
		width: 40px;
		height: 40px;
		place-items: center;
		border: 1px solid #cfcbbf;
		border-radius: 8px;
		background: #fffdf7;
		color: #20231f;
	}

	.toolbar {
		display: grid;
		grid-template-columns: minmax(220px, 1fr) minmax(180px, 260px) auto;
		gap: 12px;
		padding: 18px clamp(14px, 3vw, 32px) 10px;
	}

	.search {
		gap: 8px;
		padding: 0 12px;
		border: 1px solid #d8d5ca;
		border-radius: 8px;
		background: #fffdf7;
	}

	.search input,
	select,
	.editor-tools input,
	.fields input,
	.qty input {
		min-width: 0;
		border: 0;
		background: transparent;
		color: inherit;
		outline: none;
	}

	.search input,
	select {
		width: 100%;
		height: 44px;
	}

	select {
		padding: 0 12px;
		border: 1px solid #d8d5ca;
		border-radius: 8px;
		background: #fffdf7;
	}

	.toggle {
		gap: 8px;
		min-height: 44px;
		white-space: nowrap;
	}

	.quick-strip {
		flex-wrap: wrap;
		gap: 8px;
		padding: 0 clamp(14px, 3vw, 32px) 16px;
		color: #626058;
	}

	.package-strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0 clamp(14px, 3vw, 32px) 16px;
		padding: 10px 12px;
		border: 1px solid #b9d4c5;
		border-radius: 8px;
		background: #edf8f1;
		color: #1f5d40;
	}

	.package-strip strong {
		margin-right: 4px;
	}

	.package-strip span {
		padding: 4px 8px;
		border-radius: 999px;
		background: #d8efdf;
		font-size: 0.82rem;
		font-weight: 800;
	}

	.quick-strip button,
	.text-button,
	.editor-tools button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 0 12px;
		border: 1px solid #cfcbbf;
		border-radius: 8px;
		background: #fffdf7;
		color: #20231f;
	}

	.content {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(320px, 390px);
		gap: 20px;
		padding: 0 clamp(14px, 3vw, 32px) 18px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 12px;
		align-content: start;
	}

	.product-card {
		display: grid;
		gap: 8px;
		min-height: 294px;
		padding: 10px;
		border: 2px solid transparent;
		border-radius: 8px;
		background: #fffdf7;
		box-shadow: 0 1px 2px rgb(31 28 22 / 8%);
	}

	.product-card.selected {
		border-color: #2f7a57;
		box-shadow: 0 0 0 2px rgb(47 122 87 / 16%);
	}

	.product-main {
		display: grid;
		gap: 8px;
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		text-align: left;
	}

	.image-wrap {
		position: relative;
		overflow: hidden;
		display: grid;
		aspect-ratio: 1;
		place-items: center;
		border-radius: 6px;
		background: #ece8dd;
	}

	.image-wrap img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.placeholder {
		color: #747168;
		font-size: 1.8rem;
		font-weight: 800;
	}

	.sale,
	.picked {
		position: absolute;
		top: 8px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 7px;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 800;
	}

	.sale {
		left: 8px;
		background: #ffe2c3;
		color: #8b3d0b;
	}

	.picked {
		right: 8px;
		background: #2f7a57;
		color: #fff;
	}

	.variant-badges {
		position: absolute;
		right: 7px;
		bottom: 7px;
		left: 7px;
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.variant-badges span {
		padding: 4px 7px;
		border: 1px solid rgb(255 255 255 / 62%);
		border-radius: 999px;
		background: rgb(32 35 31 / 78%);
		color: #fff;
		font-size: 0.7rem;
		font-weight: 800;
		line-height: 1;
	}

	.category {
		color: #747168;
		font-size: 0.76rem;
	}

	.product-card strong {
		overflow: hidden;
		display: -webkit-box;
		min-height: 42px;
		font-size: 0.95rem;
		line-height: 1.25;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.price {
		display: grid;
		gap: 2px;
		align-self: end;
		font-size: 1rem;
		font-weight: 800;
	}

	.price small {
		color: #8a877f;
		font-size: 0.78rem;
		font-weight: 600;
		text-decoration: line-through;
	}

	.card-controls {
		justify-content: space-between;
		gap: 6px;
	}

	.card-controls button {
		width: 34px;
		height: 34px;
	}

	.card-controls .decrease {
		border-color: #e5b756;
		background: #fff1c7;
		color: #7a4d00;
	}

	.card-controls .remove {
		border-color: #f0a9a0;
		background: #ffe4e0;
		color: #9b2319;
	}

	.card-controls .increase {
		border-color: #9fceb3;
		background: #def5e6;
		color: #1f6c45;
	}

	.cart {
		position: sticky;
		top: 92px;
		align-self: start;
		max-height: calc(100vh - 110px);
		overflow: auto;
		padding: 14px;
		border: 1px solid #d8d5ca;
		border-radius: 8px;
		background: #fffdf7;
	}

	.cart-head {
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.empty {
		margin: 20px 0;
		color: #747168;
		text-align: center;
	}

	.cart-list {
		display: grid;
		gap: 10px;
	}

	.cart-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 10px;
		padding-bottom: 10px;
		border-bottom: 1px solid #ece8dd;
	}

	.cart-row > div:first-child {
		display: grid;
		gap: 3px;
	}

	.cart-row strong {
		line-height: 1.25;
	}

	.cart-row span,
	.cart-row small {
		color: #6b6a63;
		font-size: 0.82rem;
	}

	.qty {
		grid-column: 2;
		gap: 4px;
	}

	.qty button {
		width: 32px;
		height: 32px;
	}

	.qty input {
		width: 48px;
		height: 32px;
		border: 1px solid #d8d5ca;
		border-radius: 7px;
		text-align: center;
	}

	.line-total {
		grid-column: 1 / -1;
		justify-self: end;
	}

	footer {
		padding: 0 clamp(14px, 3vw, 32px) 28px;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgb(20 21 18 / 45%);
	}

	.modal {
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		width: min(1040px, 100%);
		max-height: min(820px, calc(100vh - 32px));
		overflow: hidden;
		border-radius: 8px;
		background: #fffdf7;
		box-shadow: 0 18px 50px rgb(0 0 0 / 22%);
	}

	.modal header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px;
		border-bottom: 1px solid #ece8dd;
	}

	.modal header div {
		display: grid;
		gap: 3px;
	}

	.editor-tools {
		flex-wrap: wrap;
		gap: 10px;
		padding: 14px 16px;
		border-bottom: 1px solid #ece8dd;
	}

	.editor-tools label,
	.fields label {
		display: grid;
		gap: 5px;
		color: #6b6a63;
		font-size: 0.78rem;
		font-weight: 700;
	}

	.editor-tools input,
	.fields input,
	.fields select {
		height: 38px;
		padding: 0 9px;
		border: 1px solid #d8d5ca;
		border-radius: 7px;
		color: #20231f;
	}

	.editor-list {
		overflow: auto;
		display: grid;
		gap: 12px;
		padding: 16px;
	}

	.editor-row {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr);
		gap: 12px;
		padding-bottom: 12px;
		border-bottom: 1px solid #ece8dd;
	}

	.editor-row img {
		width: 76px;
		height: 76px;
		border-radius: 7px;
		object-fit: cover;
		background: #ece8dd;
	}

	.editor-main {
		display: grid;
		gap: 10px;
	}

	.editor-title {
		justify-content: space-between;
		gap: 10px;
	}

	.editor-title button {
		display: inline-grid;
		width: 32px;
		height: 32px;
		place-items: center;
		border: 0;
		background: transparent;
		color: #2f7a57;
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(5, minmax(88px, 1fr));
		gap: 10px;
	}

	@media (max-width: 900px) {
		.topbar {
			grid-template-columns: auto 1fr auto;
		}

		.brand span {
			display: none;
		}

		.content {
			grid-template-columns: 1fr;
		}

		.cart {
			position: static;
			max-height: none;
		}
	}

	@media (max-width: 680px) {
		.topbar {
			gap: 10px;
			padding: 10px;
		}

		.brand strong {
			display: none;
		}

		.total {
			min-width: 0;
		}

		.actions {
			gap: 5px;
		}

		.toolbar {
			grid-template-columns: 1fr;
		}

		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.product-card {
			min-height: 262px;
		}

		.product-card strong {
			font-size: 0.86rem;
		}

		.fields {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
