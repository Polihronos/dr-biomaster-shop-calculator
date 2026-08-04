<script lang="ts">
	import { Banknote, CirclePlus, CreditCard, Pencil, Plus, Printer, Save, Trash2, X } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import {
		calculateSaleTotal,
		dateKey,
		dayOfWeek,
		displayDate,
		listSalesDays,
		normalizeSale,
		readSalesDay,
		writeSalesDay,
		type DailySale,
		type DailySaleItem,
		type DirectoryHandleLike,
		type PaymentMethod
	} from '$lib/daily-sales';
	import type { Product } from '$lib/products';

	let {
		directory,
		products,
		onclose
	}: { directory: DirectoryHandleLike; products: Product[]; onclose: () => void } = $props();

	type SalesFilter = 'all' | PaymentMethod;
	const BGN_PER_EUR = 1.95583;

	let selectedDate = $state(dateKey());
	let availableDates: string[] = $state([]);
	let sales: DailySale[] = $state([]);
	let filter: SalesFilter = $state('all');
	let editorSale: DailySale | null = $state(null);
	let status = $state('');
	let loading = $state(true);
	let loadSequence = 0;

	const filteredSales = $derived(filter === 'all' ? sales : sales.filter((sale) => sale.payment === filter));
	const filteredTotal = $derived(filteredSales.reduce((sum, sale) => sum + sale.total, 0));
	const editorTotal = $derived(editorSale ? calculateSaleTotal(editorSale) : 0);

	onMount(() => {
		void refreshDates();
		void loadDay(selectedDate);
	});

	async function refreshDates() {
		try {
			const dates = await listSalesDays(directory);
			const today = dateKey();
			availableDates = [...new Set([today, ...dates])].sort((a, b) => b.localeCompare(a));
		} catch (error) {
			status = messageFor(error);
		}
	}

	async function loadDay(key: string) {
		const sequence = ++loadSequence;
		loading = true;
		status = '';

		try {
			const day = await readSalesDay(directory, key);
			if (sequence === loadSequence) sales = day.sales;
		} catch (error) {
			if (sequence === loadSequence) status = messageFor(error);
		} finally {
			if (sequence === loadSequence) loading = false;
		}
	}

	function blankItem(): DailySaleItem {
		return { productId: '', name: '', quantity: 1, unitPrice: 0, discountPercent: 0 };
	}

	function openManualSale() {
		editorSale = {
			id: crypto.randomUUID(),
			createdAt: `${selectedDate}T${new Date().toTimeString().slice(0, 8)}`,
			payment: 'cash',
			globalDiscount: 0,
			items: [blankItem()],
			total: 0
		};
	}

	function editSale(sale: DailySale) {
		editorSale = structuredClone($state.snapshot(sale));
	}

	function addEditorItem() {
		if (!editorSale) return;
		editorSale.items.push(blankItem());
	}

	function removeEditorItem(index: number) {
		if (!editorSale) return;
		editorSale.items.splice(index, 1);
		if (editorSale.items.length === 0) editorSale.items.push(blankItem());
	}

	function updateProductSuggestion(item: DailySaleItem, value: string) {
		item.name = value;
		const normalized = value.trim().toLocaleLowerCase('bg-BG');
		const match = products.find((product) => product.name.toLocaleLowerCase('bg-BG') === normalized);
		if (!match) return;

		item.productId = match.id;
		item.name = match.name;
		item.unitPrice = Number((match.price / BGN_PER_EUR).toFixed(2));
		item.discountPercent = match.onSale && match.regularPrice > 0
			? Number((100 * (1 - match.price / match.regularPrice)).toFixed(2))
			: 0;
	}

	async function saveEditor() {
		if (!editorSale) return;
		const normalized = normalizeSale(editorSale);
		if (normalized.items.length === 0) {
			status = 'Добави поне един продукт с количество.';
			return;
		}

		const nextSales = sales.some((sale) => sale.id === normalized.id)
			? sales.map((sale) => (sale.id === normalized.id ? normalized : sale))
			: [...sales, normalized];

		try {
			await writeSalesDay(directory, selectedDate, nextSales);
			sales = nextSales;
			editorSale = null;
			status = 'Продажбата е записана във файла.';
			await refreshDates();
		} catch (error) {
			status = messageFor(error);
		}
	}

	async function deleteSale(sale: DailySale) {
		if (!window.confirm('Да изтрия ли тази продажба от файла?')) return;
		const nextSales = sales.filter((candidate) => candidate.id !== sale.id);

		try {
			await writeSalesDay(directory, selectedDate, nextSales);
			sales = nextSales;
			status = 'Продажбата е изтрита от файла.';
		} catch (error) {
			status = messageFor(error);
		}
	}

	function printSales() {
		const rows = filteredSales
			.map((sale, index) => `<tr>
				<td>${index + 1}</td>
				<td>${sale.items.map((item) => `${escapeHtml(item.name)} × ${item.quantity}`).join('<br>')}</td>
				<td>${sale.payment === 'card' ? 'Карта' : 'В брой'}</td>
				<td>${sale.total.toFixed(2)} EUR</td>
			</tr>`)
			.join('');
		const printWindow = window.open('', '_blank', 'width=1000,height=760');
		if (!printWindow) return;

		printWindow.document.write(`<!doctype html><html lang="bg"><head><meta charset="utf-8">
			<title>Дневни продажби ${displayDate(selectedDate)}</title><style>
			body{font-family:Arial,sans-serif;color:#20231f;margin:32px} header{display:flex;justify-content:space-between;align-items:end;border-bottom:2px solid #20231f;padding-bottom:14px;margin-bottom:18px}
			h1{margin:0;font-size:25px} p{margin:4px 0 0;color:#666} .total{text-align:right}.total strong{display:block;font-size:25px}table{width:100%;border-collapse:collapse}th,td{padding:10px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th:last-child,td:last-child{text-align:right;font-weight:700}
			</style></head><body><header><div><h1>${displayDate(selectedDate)} | ${escapeHtml(dayOfWeek(selectedDate))}</h1><p>${filterLabel(filter)}</p></div><div class="total">Общо<strong>${filteredTotal.toFixed(2)} EUR</strong></div></header>
			<table><thead><tr><th>№</th><th>Продукти</th><th>Плащане</th><th>Сума</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Няма продажби.</td></tr>'}</tbody></table></body></html>`);
		printWindow.document.close();
		printWindow.focus();
		printWindow.print();
	}

	function filterLabel(value: SalesFilter) {
		if (value === 'cash') return 'Само в брой';
		if (value === 'card') return 'Само с карта';
		return 'Всички плащания';
	}

	function escapeHtml(value: string) {
		return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
	}

	function messageFor(error: unknown) {
		return error instanceof Error ? error.message : 'Неуспешна работа с файла.';
	}
</script>

<div class="sales-backdrop">
	<section class="sales-modal" aria-label="Дневни продажби">
		<header class="sales-header">
			<div>
				<strong>{displayDate(selectedDate)} | {dayOfWeek(selectedDate)}</strong>
				<span>Общо: {filteredTotal.toFixed(2)} EUR</span>
			</div>
			<div class="header-buttons">
				<button class="icon-button" title="Добави продажба ръчно" aria-label="Добави продажба ръчно" onclick={openManualSale}><Plus size={20} /></button>
				<button class="icon-button" title="Принтирай дневните продажби" aria-label="Принтирай дневните продажби" onclick={printSales}><Printer size={19} /></button>
				<button class="icon-button" title="Затвори" aria-label="Затвори" onclick={onclose}><X size={20} /></button>
			</div>
		</header>

		<div class="sales-toolbar">
			<label>
				Ден
				<select
					value={selectedDate}
					onchange={(event) => {
						selectedDate = event.currentTarget.value;
						void loadDay(selectedDate);
					}}
				>
					{#each availableDates as key (key)}
						<option value={key}>{displayDate(key)} | {dayOfWeek(key)}</option>
					{/each}
				</select>
			</label>
			<div class="filters" aria-label="Филтър по плащане">
				<button class:active={filter === 'all'} onclick={() => (filter = 'all')}>Всички</button>
				<button class:active={filter === 'cash'} onclick={() => (filter = 'cash')}><Banknote size={17} /> В брой</button>
				<button class:active={filter === 'card'} onclick={() => (filter = 'card')}><CreditCard size={17} /> Карта</button>
			</div>
		</div>

		{#if status}<p class="status">{status}</p>{/if}

		<div class="sales-list">
			{#if loading}
				<p class="empty">Чета файла…</p>
			{:else if filteredSales.length === 0}
				<p class="empty">Няма записани продажби за този ден.</p>
			{:else}
				{#each filteredSales as sale, index (sale.id)}
					<article class="sale-row">
						<span class="sale-number">{index + 1}</span>
						<div class="sale-products">
							{#each sale.items as item (`${sale.id}-${item.productId}-${item.name}`)}
								<span>{item.name} × {item.quantity}{item.discountPercent > 0 ? ` (−${item.discountPercent}%)` : ''}</span>
							{/each}
							{#if sale.globalDiscount > 0}<small>Обща отстъпка −{sale.globalDiscount}%</small>{/if}
						</div>
						<span class="payment" title={sale.payment === 'card' ? 'Карта' : 'В брой'}>
							{#if sale.payment === 'card'}<CreditCard size={19} />{:else}<Banknote size={19} />{/if}
						</span>
						<strong>{sale.total.toFixed(2)} EUR</strong>
						<div class="row-actions">
							<button title="Добави продажба ръчно" aria-label="Добави продажба ръчно" onclick={openManualSale}><Plus size={17} /></button>
							<button title="Редактирай" aria-label="Редактирай" onclick={() => editSale(sale)}><Pencil size={17} /></button>
							<button class="danger" title="Изтрий" aria-label="Изтрий" onclick={() => deleteSale(sale)}><Trash2 size={17} /></button>
						</div>
					</article>
				{/each}
			{/if}
		</div>
	</section>
</div>

{#if editorSale}
	<div class="editor-backdrop">
		<section class="sale-editor" aria-label="Редакция на продажба">
			<header>
				<div><strong>Продажба</strong><span>Общо: {editorTotal.toFixed(2)} EUR</span></div>
				<button class="icon-button" title="Затвори редакцията" aria-label="Затвори редакцията" onclick={() => (editorSale = null)}><X size={20} /></button>
			</header>

			<div class="editor-options">
				<label>Плащане
					<select bind:value={editorSale.payment}><option value="cash">В брой</option><option value="card">Карта</option></select>
				</label>
				<label>Обща отстъпка %<input type="number" min="0" max="100" step="0.1" bind:value={editorSale.globalDiscount} /></label>
			</div>

			<div class="editor-items">
				{#each editorSale.items as item, index (`${editorSale.id}-${index}`)}
					<div class="editor-item">
						<label class="product-field">Продукт
							<input list="product-suggestions" value={item.name} oninput={(event) => updateProductSuggestion(item, event.currentTarget.value)} placeholder="Започни да пишеш…" />
						</label>
						<label>Бр.<input type="number" min="0.01" step="1" bind:value={item.quantity} /></label>
						<label>Цена EUR<input type="number" min="0" step="0.01" bind:value={item.unitPrice} /></label>
						<label>Отстъпка %<input type="number" min="0" max="100" step="0.1" bind:value={item.discountPercent} /></label>
						<button class="remove-item" title="Премахни продукта" aria-label="Премахни продукта" onclick={() => removeEditorItem(index)}><Trash2 size={17} /></button>
					</div>
				{/each}
				<datalist id="product-suggestions">{#each products as product (product.id)}<option value={product.name}>{(product.price / BGN_PER_EUR).toFixed(2)} EUR</option>{/each}</datalist>
			</div>

			<footer>
				<button class="add-item" onclick={addEditorItem}><CirclePlus size={18} /> Добави продукт</button>
				<button class="save" onclick={saveEditor}><Save size={18} /> Запиши във файла</button>
			</footer>
		</section>
	</div>
{/if}

<style>
	.sales-backdrop,.editor-backdrop{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:16px;background:rgb(20 21 18 / 48%)}
	.editor-backdrop{z-index:35;background:rgb(20 21 18 / 62%)}
	.sales-modal,.sale-editor{display:grid;width:min(1100px,100%);max-height:calc(100vh - 32px);overflow:hidden;border-radius:10px;background:#fffdf7;box-shadow:0 18px 50px rgb(0 0 0 / 24%)}
	.sales-modal{grid-template-rows:auto auto auto minmax(0,1fr)}.sale-editor{grid-template-rows:auto auto minmax(0,1fr) auto;width:min(980px,100%)}
	.sales-header,.sale-editor header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px;border-bottom:1px solid #ece8dd}
	.sales-header>div:first-child,.sale-editor header>div{display:grid;gap:3px}.sales-header strong,.sale-editor header strong{font-size:1.2rem}.sales-header span,.sale-editor header span{color:#2f7a57;font-weight:800}
	.header-buttons,.filters,.row-actions,.sale-editor footer{display:flex;align-items:center;gap:7px}.icon-button,.row-actions button,.remove-item{display:inline-grid;width:40px;height:40px;place-items:center;border:1px solid #cfcbbf;border-radius:8px;background:#fffdf7;color:#20231f}
	.sales-toolbar{display:flex;align-items:end;justify-content:space-between;gap:14px;padding:13px 16px;border-bottom:1px solid #ece8dd}.sales-toolbar label,.editor-options label,.editor-item label{display:grid;gap:5px;color:#6b6a63;font-size:.78rem;font-weight:700}
	select,input{height:39px;padding:0 9px;border:1px solid #d8d5ca;border-radius:7px;background:#fff;color:#20231f;font:inherit}.filters button,.add-item,.save{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:39px;padding:0 12px;border:1px solid #cfcbbf;border-radius:8px;background:#fffdf7;color:#20231f}.filters button.active{border-color:#82bb9a;background:#dff5e8;color:#1f6c45;font-weight:800}
	.status{margin:0;padding:8px 16px;background:#edf8f1;color:#1f5d40;font-size:.84rem;font-weight:700}.sales-list,.editor-items{overflow:auto;padding:8px 16px 16px}.empty{padding:40px 12px;color:#747168;text-align:center}
	.sale-row{display:grid;grid-template-columns:34px minmax(0,1fr) 36px auto auto;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #ece8dd}.sale-number{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:#f0ede4;color:#68665f;font-weight:800}.sale-products{display:grid;gap:4px}.sale-products span{line-height:1.3}.sale-products small{color:#2f7a57;font-weight:800}.payment{display:grid;place-items:center;color:#2f7a57}.row-actions button{width:34px;height:34px}.row-actions .danger,.remove-item{border-color:#efbbb3;background:#ffe8e4;color:#92251c}
	.editor-options{display:flex;gap:12px;padding:13px 16px;border-bottom:1px solid #ece8dd}.editor-item{display:grid;grid-template-columns:minmax(240px,1fr) 75px 110px 110px 40px;align-items:end;gap:9px;padding:10px 0;border-bottom:1px solid #ece8dd}.product-field input{width:100%}.sale-editor footer{justify-content:space-between;padding:14px 16px;border-top:1px solid #ece8dd}.save{border-color:#82bb9a;background:#dff5e8;color:#1f6c45;font-weight:800}
	@media(max-width:720px){.sales-toolbar{align-items:stretch;flex-direction:column}.filters{display:grid;grid-template-columns:repeat(3,1fr)}.sale-row{grid-template-columns:30px minmax(0,1fr) auto}.payment{grid-column:1}.sale-row>strong{grid-column:2}.row-actions{grid-column:3;grid-row:1 / span 2}.editor-item{grid-template-columns:1fr 1fr}.product-field{grid-column:1 / -1}.remove-item{justify-self:end}.sales-header strong{font-size:1rem}}
	@media print{.header-buttons,.sales-toolbar,.row-actions,.status{display:none}}
</style>
