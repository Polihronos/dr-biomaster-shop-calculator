<script lang="ts">
	import {
		ChartNoAxesCombined,
		FolderOpen,
		MapPin,
		Package,
		ReceiptText,
		RefreshCcw,
		ShoppingBasket,
		Users,
		X
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import {
		analyticsGeography,
		analyticsPermission,
		chooseAnalyticsDirectory,
		loadAnalytics,
		restoreAnalyticsDirectories,
		summarizeAnalytics,
		type AnalyticsDirectories,
		type AnalyticsDirectoryKind,
		type AnalyticsLoadResult,
		type AnalyticsSourceFilter,
		type MapMetric,
		type RankedRow
	} from '$lib/analytics';
	import type { Product } from '$lib/products';

	let { products, onclose }: { products: Product[]; onclose: () => void } = $props();

	const EMPTY_RESULT: AnalyticsLoadResult = {
		transactions: [],
		filesRead: 0,
		orderFiles: 0,
		salesFiles: 0,
		loadedAt: ''
	};
	const METRIC_LABELS: Record<MapMetric, string> = {
		transactions: 'Покупки',
		units: 'Бройки',
		revenue: 'Приход'
	};
	const PALETTE = ['#edf1ee', '#d8efdf', '#aed8bd', '#72b38c', '#347d57', '#165538'];

	let directories: AnalyticsDirectories = $state({ orders: null, sales: null });
	let result: AnalyticsLoadResult = $state(EMPTY_RESULT);
	let loading = $state(true);
	let needsPermission = $state({ orders: false, sales: false });
	let error = $state('');
	let source: AnalyticsSourceFilter = $state('all');
	let from = $state('');
	let to = $state('');
	let mapMetric: MapMetric = $state('transactions');
	let selectedRegionId = $state('');

	const summary = $derived(summarizeAnalytics(result.transactions, { source, from, to }));
	const regionById = $derived(new Map(summary.regions.map((region) => [region.key, region])));
	const selectedRegion = $derived(summary.regions.find((region) => region.key === selectedRegionId) ?? null);
	const rankedRegions = $derived(rankRows(summary.regions, mapMetric));
	const visibleCities = $derived(rankRows(selectedRegion ? summary.cities.filter((city) => city.regionName === selectedRegion.name) : summary.cities, mapMetric));
	const visibleClients = $derived(rankRows(summary.clients, mapMetric));
	const mapMaximum = $derived(Math.max(0, ...summary.regions.map((region) => metricValue(region, mapMetric))));
	const regionRankingMaximum = $derived(Math.max(0, ...summary.regions.map((region) => metricValue(region, mapMetric))));
	const dateCoverage = $derived.by(() => {
		if (!result.transactions.length) return '';
		const dates = result.transactions.map((transaction) => transaction.date).toSorted();
		return `${displayDate(dates[0])} – ${displayDate(dates.at(-1) ?? dates[0])}`;
	});
	const hasReadableDirectory = $derived(Boolean(
		(directories.orders && !needsPermission.orders) || (directories.sales && !needsPermission.sales)
	));

	onMount(() => {
		void initialize();
	});

	async function initialize() {
		loading = true;
		try {
			directories = await restoreAnalyticsDirectories();
			for (const kind of ['orders', 'sales'] as const) {
				const directory = directories[kind];
				needsPermission[kind] = Boolean(directory && (await analyticsPermission(directory, false)) !== 'granted');
			}
			if (currentReadableDirectories().orders || currentReadableDirectories().sales) await refresh();
		} catch (caught) {
			error = messageFor(caught);
		} finally {
			loading = false;
		}
	}

	async function connect(kind: AnalyticsDirectoryKind) {
		loading = true;
		error = '';
		try {
			const existing = directories[kind];
			if (existing && needsPermission[kind]) {
				const permission = await analyticsPermission(existing, true);
				if (permission !== 'granted') throw new Error(`Достъпът до папка „${existing.name}“ не беше разрешен.`);
			} else {
				directories[kind] = await chooseAnalyticsDirectory(kind);
			}
			needsPermission[kind] = false;
			await refresh();
		} catch (caught) {
			if (!(caught instanceof DOMException && caught.name === 'AbortError')) error = messageFor(caught);
		} finally {
			loading = false;
		}
	}

	async function refresh() {
		const readable = currentReadableDirectories();
		if (!readable.orders && !readable.sales) return;
		loading = true;
		error = '';
		try {
			result = await loadAnalytics(readable, products);
			if (!result.filesRead) error = 'В свързаните папки няма TXT файлове.';
		} catch (caught) {
			error = messageFor(caught);
		} finally {
			loading = false;
		}
	}

	function currentReadableDirectories(): AnalyticsDirectories {
		return {
			orders: needsPermission.orders ? null : directories.orders,
			sales: needsPermission.sales ? null : directories.sales
		};
	}

	function folderButtonText(kind: AnalyticsDirectoryKind) {
		if (needsPermission[kind]) return `Разреши ${kind === 'orders' ? 'daily orders' : 'daily sales'}`;
		if (directories[kind]) return `${kind === 'orders' ? 'daily orders' : 'daily sales'} ✓`;
		return `Свържи ${kind === 'orders' ? 'daily orders' : 'daily sales'}`;
	}

	function displayDate(key: string) {
		const [year, month, day] = key.split('-');
		return `${day}.${month}.${year}`;
	}

	function formatMoney(value: number) {
		return `${value.toLocaleString('bg-BG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
	}

	function formatNumber(value: number) {
		return value.toLocaleString('bg-BG', { maximumFractionDigits: 2 });
	}

	function metricValue(row: RankedRow, metric: MapMetric) {
		return metric === 'transactions' ? row.transactions : metric === 'units' ? row.units : row.revenue;
	}

	function metricDisplay(row: RankedRow, metric: MapMetric) {
		return metric === 'revenue' ? formatMoney(row.revenue) : formatNumber(metricValue(row, metric));
	}

	function regionColor(regionId: string) {
		const value = metricValue(regionById.get(regionId) ?? emptyRow(regionId), mapMetric);
		if (value <= 0 || mapMaximum <= 0) return '#ece9e1';
		const normalized = Math.sqrt(value / mapMaximum);
		return PALETTE[Math.min(PALETTE.length - 1, Math.max(1, Math.ceil(normalized * (PALETTE.length - 1))))];
	}

	function emptyRow(key: string): RankedRow {
		return { key, name: key, transactions: 0, units: 0, revenue: 0 };
	}

	function selectRegion(regionId: string) {
		selectedRegionId = selectedRegionId === regionId ? '' : regionId;
	}

	function barWidth(value: number, maximum: number) {
		return `${maximum > 0 ? Math.max(3, (value / maximum) * 100) : 0}%`;
	}

	function rankRows(rows: RankedRow[], metric: MapMetric) {
		return rows.toSorted((a, b) => metricValue(b, metric) - metricValue(a, metric) || b.revenue - a.revenue || a.name.localeCompare(b.name, 'bg'));
	}

	function messageFor(caught: unknown) {
		return caught instanceof Error ? caught.message : 'Данните не можаха да бъдат прочетени.';
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="analytics-backdrop" transition:fade={{ duration: 120 }}>
	<section class="analytics-modal" aria-label="Анализи на продажби и поръчки" transition:fly={{ y: 18, duration: 180 }}>
		<header class="analytics-header">
			<div class="analytics-heading">
				<span class="heading-icon"><ChartNoAxesCombined size={22} /></span>
				<div>
					<strong>Анализи</strong>
					<span>{dateCoverage || 'Дневни поръчки + продажби от магазина'}</span>
				</div>
			</div>
			<div class="header-actions">
				{#if hasReadableDirectory}
					<button class="icon-button" title="Прочети файловете отново" aria-label="Прочети файловете отново" onclick={refresh} disabled={loading}>
						<RefreshCcw size={18} />
					</button>
				{/if}
				<button class="icon-button" title="Затвори" aria-label="Затвори" onclick={onclose}><X size={20} /></button>
			</div>
		</header>

		{#if !hasReadableDirectory}
			<div class="connect-state">
				<span class="connect-icon"><FolderOpen size={34} /></span>
				<div>
					<strong>Свържи папките с данни</strong>
					<p>Избери директно <code>daily orders</code> и <code>daily sales</code>, без да избираш Documents. Може да започнеш само с едната.</p>
				</div>
				<div class="folder-buttons">
					<button class="primary" onclick={() => connect('orders')} disabled={loading}>{folderButtonText('orders')}</button>
					<button class="primary" onclick={() => connect('sales')} disabled={loading}>{folderButtonText('sales')}</button>
				</div>
			</div>
		{:else}
			<div class="analytics-body">
				<div class="folder-toolbar" aria-label="Свързани папки">
					<span>TXT източници</span>
					<button class:connected={Boolean(directories.orders && !needsPermission.orders)} onclick={() => connect('orders')} disabled={loading}><FolderOpen size={15} /> {folderButtonText('orders')}</button>
					<button class:connected={Boolean(directories.sales && !needsPermission.sales)} onclick={() => connect('sales')} disabled={loading}><FolderOpen size={15} /> {folderButtonText('sales')}</button>
				</div>
				<div class="dashboard-controls">
					<div class="source-filter" aria-label="Източник">
						<button class:active={source === 'all'} onclick={() => (source = 'all')}>Всичко</button>
						<button class:active={source === 'orders'} onclick={() => (source = 'orders')}>Поръчки</button>
						<button class:active={source === 'sales'} onclick={() => (source = 'sales')}>Магазин София</button>
					</div>
					<div class="date-filters">
						<label>От<input type="date" bind:value={from} /></label>
						<label>До<input type="date" bind:value={to} /></label>
						{#if from || to}<button class="clear-filter" onclick={() => { from = ''; to = ''; }}>Всички дати</button>{/if}
					</div>
				</div>

				{#if error}<p class="analytics-status">{error}</p>{/if}
				{#if loading}<div class="loading-line"><span></span></div>{/if}

				<div class="metric-strip">
					<article><span><ReceiptText size={17} /> Приход</span><strong>{formatMoney(summary.revenue)}</strong></article>
					<article><span><ShoppingBasket size={17} /> Покупки</span><strong>{formatNumber(summary.transactions)}</strong></article>
					<article><span><Package size={17} /> Продадени бройки</span><strong>{formatNumber(summary.units)}</strong></article>
					<article><span><MapPin size={17} /> Населени места</span><strong>{formatNumber(summary.uniqueCities)}</strong></article>
					<article><span><Users size={17} /> Клиенти с поръчки</span><strong>{formatNumber(summary.uniqueClients)}</strong></article>
				</div>

				<div class="map-section">
					<article class="map-card">
						<div class="card-heading">
							<div><strong>България по области</strong><span>Натисни област за градовете в нея</span></div>
							<div class="metric-toggle" aria-label="Показател на картата и класациите">
								{#each Object.entries(METRIC_LABELS) as [metric, label] (metric)}
									<button class:active={mapMetric === metric} onclick={() => (mapMetric = metric as MapMetric)}>{label}</button>
								{/each}
							</div>
						</div>
						<div class="map-wrap">
							<svg viewBox={analyticsGeography.viewBox} role="img" aria-label={`Карта на България по ${METRIC_LABELS[mapMetric].toLocaleLowerCase('bg-BG')}`}>
								{#each analyticsGeography.regions as region (region.id)}
									{@const row = regionById.get(region.id) ?? emptyRow(region.id)}
									<path
										d={region.path}
										fill={regionColor(region.id)}
										class:selected={selectedRegionId === region.id}
										role="button"
										tabindex="0"
										aria-label={`${region.name}: ${metricDisplay(row, mapMetric)}`}
										onclick={() => selectRegion(region.id)}
										onkeydown={(event) => (event.key === 'Enter' || event.key === ' ') && selectRegion(region.id)}
									>
										<title>{region.name}: {metricDisplay(row, mapMetric)}</title>
									</path>
								{/each}
							</svg>
							<div class="map-legend"><span>Няма</span>{#each PALETTE.slice(1) as color (color)}<i style:background={color}></i>{/each}<span>Най-много</span></div>
						</div>
					</article>

					<article class="ranking-card region-ranking">
						<div class="card-heading"><div><strong>Области</strong><span>по {METRIC_LABELS[mapMetric].toLocaleLowerCase('bg-BG')}</span></div></div>
						<div class="ranking-list">
							{#each rankedRegions.filter((row) => metricValue(row, mapMetric) > 0).slice(0, 8) as row, index (row.key)}
								<button class:selected={selectedRegionId === row.key} onclick={() => selectRegion(row.key)}>
									<span class="rank">{index + 1}</span>
									<span class="rank-main"><strong>{row.name}</strong><i style:width={barWidth(metricValue(row, mapMetric), regionRankingMaximum)}></i></span>
									<b>{metricDisplay(row, mapMetric)}</b>
								</button>
							{:else}
								<p class="empty">Няма данни за избрания период.</p>
							{/each}
						</div>
					</article>
				</div>

				<div class="tables-grid">
					<article class="ranking-card wide-table">
						<div class="card-heading">
							<div><strong>{selectedRegion ? `Градове и села · ${selectedRegion.name}` : 'Градове и села'}</strong><span>сортирани по {METRIC_LABELS[mapMetric].toLocaleLowerCase('bg-BG')}</span></div>
							{#if selectedRegion}<button class="clear-filter" onclick={() => (selectedRegionId = '')}>Всички области</button>{/if}
						</div>
						<div class="table-scroll"><table><thead><tr><th>Населено място</th><th>Покупки</th><th>Бройки</th><th>Приход</th></tr></thead><tbody>
							{#each visibleCities.slice(0, 15) as row (row.key)}<tr><td><strong>{row.name}</strong>{#if row.regionName}<small>{row.regionName}</small>{/if}</td><td>{formatNumber(row.transactions)}</td><td>{formatNumber(row.units)}</td><td>{formatMoney(row.revenue)}</td></tr>{:else}<tr><td colspan="4" class="empty">Няма данни.</td></tr>{/each}
						</tbody></table></div>
					</article>

					<article class="ranking-card wide-table">
						<div class="card-heading"><div><strong>Клиенти</strong><span>само поръчки · сортирани по {METRIC_LABELS[mapMetric].toLocaleLowerCase('bg-BG')}</span></div></div>
						<div class="table-scroll"><table><thead><tr><th>Клиент</th><th>Поръчки</th><th>Бройки</th><th>Приход</th></tr></thead><tbody>
							{#each visibleClients.slice(0, 15) as row (row.key)}<tr><td><strong>{row.name}</strong></td><td>{formatNumber(row.transactions)}</td><td>{formatNumber(row.units)}</td><td>{formatMoney(row.revenue)}</td></tr>{:else}<tr><td colspan="4" class="empty">Няма клиентски данни.</td></tr>{/each}
						</tbody></table></div>
					</article>

					<article class="ranking-card wide-table products-table">
						<div class="card-heading"><div><strong>Продукти</strong><span>обединени по каталожно или близко име</span></div></div>
						<div class="table-scroll"><table><thead><tr><th>Продукт</th><th>Покупки</th><th>Продадени бройки</th></tr></thead><tbody>
							{#each summary.products.slice(0, 20) as row (row.key)}<tr><td><strong>{row.name}</strong>{#if !row.matched}<small class="warning">неразпознато ръчно име</small>{/if}</td><td>{formatNumber(row.transactions)}</td><td>{formatNumber(row.units)}</td></tr>{:else}<tr><td colspan="3" class="empty">Няма продуктови данни.</td></tr>{/each}
						</tbody></table></div>
					</article>
				</div>

				{#if summary.unresolvedCities.length || summary.unmatchedProducts.length}
					<details class="data-notes">
						<summary>Данни за преглед ({summary.unresolvedCities.length + summary.unmatchedProducts.length})</summary>
						{#if summary.unresolvedCities.length}<p><strong>Неразпознати населени места:</strong> {summary.unresolvedCities.join(', ')}</p>{/if}
						{#if summary.unmatchedProducts.length}<p><strong>Неразпознати продуктови имена:</strong> {summary.unmatchedProducts.join(', ')}</p>{/if}
					</details>
				{/if}

				<footer class="source-note">
					<span>{result.filesRead} TXT файла · {result.orderFiles} поръчки / {result.salesFiles} магазин · обновено {new Date(result.loadedAt || Date.now()).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })}</span>
					<span>Областите са GISCO NUTS 2024; населените места са НСИ/ЕКАТТЕ. Продажбите от магазина се броят в София.</span>
				</footer>
			</div>
		{/if}
	</section>
</div>

<style>
	.analytics-backdrop{position:fixed;inset:0;z-index:45;display:grid;place-items:center;padding:14px;background:rgb(20 21 18 / 58%)}
	.analytics-modal{display:grid;grid-template-rows:auto minmax(0,1fr);width:min(1440px,100%);height:min(930px,calc(100vh - 28px));overflow:hidden;border-radius:12px;background:#f6f4ef;box-shadow:0 22px 70px rgb(0 0 0 / 28%)}
	.analytics-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border-bottom:1px solid #d8d5ca;background:#fffdf7}.analytics-heading,.header-actions{display:flex;align-items:center;gap:10px}.analytics-heading>div{display:grid;gap:2px}.analytics-heading strong{font-size:1.18rem}.analytics-heading span:not(.heading-icon){color:#6b6a63;font-size:.8rem}.heading-icon,.connect-icon{display:grid;place-items:center;border-radius:9px;background:#dff5e8;color:#1f6c45}.heading-icon{width:40px;height:40px}.icon-button{display:inline-grid;width:40px;height:40px;place-items:center;border:1px solid #cfcbbf;border-radius:8px;background:#fffdf7;color:#20231f}.icon-button:disabled{opacity:.5}
	.connect-state{align-self:center;justify-self:center;display:grid;grid-template-columns:auto minmax(0,460px) auto;align-items:center;gap:16px;margin:24px;padding:22px;border:1px solid #d8d5ca;border-radius:12px;background:#fffdf7}.connect-icon{width:58px;height:58px}.connect-state strong{font-size:1.05rem}.connect-state p{margin:5px 0 0;color:#6b6a63;font-size:.86rem;line-height:1.45}.connect-state code{padding:2px 5px;border-radius:4px;background:#f0ede4}.folder-buttons{display:grid;gap:8px}.primary{min-height:42px;padding:0 14px;border:1px solid #82bb9a;border-radius:8px;background:#dff5e8;color:#1f6c45;font-weight:800;white-space:nowrap}
	.analytics-body{overflow:auto;padding:14px 18px 18px}.folder-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:7px;margin-bottom:10px;color:#727068;font-size:.75rem;font-weight:800}.folder-toolbar button{display:inline-flex;align-items:center;gap:5px;min-height:30px;padding:0 9px;border:1px solid #d3cfc4;border-radius:7px;background:#fffdf7;color:#595850;font-size:.74rem}.folder-toolbar button.connected{border-color:#9ac8aa;background:#e8f6ed;color:#246b47}.dashboard-controls{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:12px}.source-filter,.metric-toggle,.date-filters{display:flex;align-items:center;gap:6px}.source-filter button,.metric-toggle button,.clear-filter{min-height:36px;padding:0 11px;border:1px solid #cfcbc0;border-radius:7px;background:#fffdf7;color:#44443f}.source-filter button.active,.metric-toggle button.active{border-color:#82bb9a;background:#dff5e8;color:#1f6c45;font-weight:800}.date-filters label{display:grid;gap:4px;color:#6b6a63;font-size:.72rem;font-weight:700}.date-filters input{height:36px;padding:0 8px;border:1px solid #cfcbc0;border-radius:7px;background:#fffdf7}.clear-filter{font-size:.78rem}.analytics-status{margin:0 0 10px;padding:9px 11px;border-radius:7px;background:#fff1c7;color:#704800;font-size:.82rem;font-weight:700}.loading-line{height:3px;overflow:hidden;margin:-4px 0 9px;border-radius:999px;background:#dce7df}.loading-line span{display:block;width:38%;height:100%;background:#2f7a57;animation:loading 1s infinite ease-in-out}@keyframes loading{from{transform:translateX(-100%)}to{transform:translateX(360%)}}
	.metric-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-bottom:12px}.metric-strip article{display:grid;gap:7px;padding:12px 13px;border:1px solid #ddd9ce;border-radius:9px;background:#fffdf7}.metric-strip span{display:flex;align-items:center;gap:6px;color:#6b6a63;font-size:.76rem;font-weight:700}.metric-strip strong{font-size:clamp(1.05rem,2vw,1.4rem)}
	.map-section{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(300px,.7fr);gap:12px;margin-bottom:12px}.map-card,.ranking-card{overflow:hidden;border:1px solid #ddd9ce;border-radius:10px;background:#fffdf7}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid #ece8dd}.card-heading>div:first-child{display:grid;gap:2px}.card-heading span{color:#77746c;font-size:.75rem}.map-wrap{position:relative;display:grid;min-height:360px;place-items:center;padding:10px}.map-wrap svg{width:100%;max-height:390px;overflow:visible}.map-wrap path{cursor:pointer;stroke:#fffdf7;stroke-width:1.4;vector-effect:non-scaling-stroke;transition:filter .15s,stroke-width .15s}.map-wrap path:hover{filter:brightness(.91);stroke:#20231f;stroke-width:2.2}.map-wrap path.selected{stroke:#20231f;stroke-width:3}.map-legend{position:absolute;right:14px;bottom:11px;display:flex;align-items:center;gap:3px;padding:5px 7px;border:1px solid #ddd9ce;border-radius:6px;background:rgb(255 253 247 / 92%);color:#6b6a63;font-size:.66rem}.map-legend i{width:18px;height:9px}.ranking-list{display:grid;padding:6px 12px 12px}.ranking-list button{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;padding:9px 3px;border:0;border-bottom:1px solid #ece8dd;background:transparent;color:#20231f;text-align:left}.ranking-list button.selected{color:#1f6c45}.rank{color:#918e85;font-size:.76rem;font-weight:800}.rank-main{position:relative;display:grid;gap:5px;overflow:hidden}.rank-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rank-main i{height:4px;border-radius:999px;background:#82bb9a}.ranking-list b{font-size:.8rem;white-space:nowrap}.empty{padding:20px;color:#77746c;text-align:center}
	.tables-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.products-table{grid-column:1 / -1}.table-scroll{overflow:auto;max-height:390px}table{width:100%;border-collapse:collapse;font-size:.8rem}th,td{padding:9px 11px;border-bottom:1px solid #ece8dd;text-align:left;vertical-align:top}th{position:sticky;top:0;z-index:1;background:#f3f1eb;color:#6b6a63;font-size:.7rem;text-transform:uppercase}th:not(:first-child),td:not(:first-child){text-align:right;white-space:nowrap}td:first-child{min-width:180px}td strong,td small{display:block}td small{margin-top:2px;color:#8a877f;font-size:.68rem}.warning{color:#9a5a00!important}.data-notes{margin-top:12px;padding:10px 12px;border:1px solid #e4c881;border-radius:8px;background:#fff7df;color:#664a08;font-size:.78rem}.data-notes summary{cursor:pointer;font-weight:800}.data-notes p{margin:8px 0 0;line-height:1.4}.source-note{display:flex;justify-content:space-between;gap:16px;padding:13px 2px 0;color:#77746c;font-size:.7rem}
	@media(max-width:1000px){.metric-strip{grid-template-columns:repeat(3,1fr)}.map-section{grid-template-columns:1fr}.tables-grid{grid-template-columns:1fr}.products-table{grid-column:auto}.map-wrap{min-height:300px}}
	@media(max-width:680px){.analytics-backdrop{padding:0}.analytics-modal{height:100vh;border-radius:0}.analytics-header{padding:10px}.analytics-heading span:not(.heading-icon){display:none}.analytics-body{padding:10px}.folder-toolbar{align-items:stretch;flex-direction:column}.folder-toolbar span{display:none}.folder-toolbar button{justify-content:center}.dashboard-controls{align-items:stretch;flex-direction:column}.source-filter{display:grid;grid-template-columns:repeat(3,1fr)}.date-filters{flex-wrap:wrap}.metric-strip{grid-template-columns:1fr 1fr}.map-wrap{min-height:240px;padding:4px}.card-heading{align-items:stretch;flex-direction:column}.metric-toggle{display:grid;grid-template-columns:repeat(3,1fr)}.source-note{flex-direction:column}.connect-state{grid-template-columns:1fr;text-align:center}.connect-icon{justify-self:center}}
</style>
