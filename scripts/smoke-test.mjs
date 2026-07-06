import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const PORT = Number(process.env.SMOKE_TEST_PORT ?? 4174);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const PRODUCTS_SOURCE = new URL('../src/lib/products.ts', import.meta.url);
const PRODUCTS = loadProducts();
const liveProductOverrides = new Map();

function loadProducts() {
	const source = readFileSync(PRODUCTS_SOURCE, 'utf8');
	const match = source.match(/export const products: Product\[\] = (\[[\s\S]*?\]);/);
	if (!match) throw new Error(`Unable to read local products from ${PRODUCTS_SOURCE.pathname}`);

	return JSON.parse(match[1]);
}

async function waitForServer(getServerOutput) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			const response = await fetch(BASE_URL);
			if (response.ok) return;
		} catch {
			// Server is still starting.
		}

		await delay(500);
	}

	throw new Error(`Preview server did not start at ${BASE_URL}\n${getServerOutput()}`);
}

function startPreview() {
	if (process.platform === 'win32') {
		return spawn(
			'cmd.exe',
			['/d', '/s', '/c', `npm run preview -- --host 127.0.0.1 --port ${PORT}`],
			{
				stdio: ['ignore', 'pipe', 'pipe'],
				windowsHide: true
			}
		);
	}

	return spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PORT)], {
		stdio: ['ignore', 'pipe', 'pipe']
	});
}

function productCard(page, id) {
	return page.locator(`.product-card[data-product-id="${id}"]`);
}

function storeAmount(value) {
	return String(Math.round(value * 100));
}

function liveProductFor(product) {
	const override = liveProductOverrides.get(product.id);
	const price = override?.price ?? product.price;
	const regularPrice = override?.regularPrice ?? product.regularPrice;
	const onSale = override?.onSale ?? product.onSale;

	return {
		id: Number(product.id),
		name: product.name,
		on_sale: onSale,
		prices: {
			currency_code: 'BGN',
			currency_minor_unit: 2,
			price: storeAmount(price),
			regular_price: storeAmount(regularPrice || price),
			sale_price: onSale ? storeAmount(price) : ''
		}
	};
}

async function mockLiveProductApi(page) {
	await page.route('https://drbiomaster.com/wp-json/wc/store/v1/products**', async (route) => {
		const url = new URL(route.request().url());
		const callback = url.searchParams.get('_jsonp');
		const pageNumber = Number(url.searchParams.get('page') ?? 1);
		const perPage = Number(url.searchParams.get('per_page') ?? 100);
		const start = (pageNumber - 1) * perPage;
		const products = PRODUCTS.slice(start, start + perPage).map(liveProductFor);
		const payload = JSON.stringify(products);

		await route.fulfill({
			status: 200,
			contentType: 'application/javascript',
			body: callback ? `${callback}(${payload});` : payload
		});
	});
}

async function expectCartEmpty(page) {
	await expect(page.locator('.total')).toContainText('0.00 / 0.00');
	await expect(page.locator('.cart-total')).toContainText('0.00 / 0.00');
	await expect(page.locator('.cart-head span')).toContainText('0');
	await expect(page.locator('.product-card.selected')).toHaveCount(0);
	await expect(page.locator('.cart-list')).toHaveCount(0);
}

function stopPreview(server) {
	if (!server.pid) return;

	if (process.platform === 'win32') {
		try {
			execFileSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
		} catch {
			// The process may already be gone.
		}
		return;
	}

	server.kill();
}

async function clickProduct(page, id) {
	const card = productCard(page, id);
	await expect(card).toBeVisible();
	await card.locator('.product-main').click();
	return card;
}

async function clearCart(page) {
	await page.locator('.cart-actions .text-button').last().click();
	await expectCartEmpty(page);
}

async function setOnlySale(page, enabled) {
	const checkbox = page.locator('.toggle input[type="checkbox"]');
	await checkbox.setChecked(enabled);

	if (enabled) {
		await expect(checkbox).toBeChecked();
	} else {
		await expect(checkbox).not.toBeChecked();
	}
}

async function expectVisibleCardsArePromotional(page) {
	const cards = page.locator('.product-card');
	const count = await cards.count();
	expect(count).toBeGreaterThan(0);
	expect(count).toBeLessThan(99);

	const nonPromotionalCards = await cards.evaluateAll((elements) =>
		elements
			.map((element) => ({
				id: element.getAttribute('data-product-id'),
				hasSaleBadge: Boolean(element.querySelector('.sale')),
				hasLineDiscount: Boolean(element.querySelector('.price em')?.textContent?.match(/-\d/))
			}))
			.filter((card) => !card.hasSaleBadge && !card.hasLineDiscount)
	);

	expect(nonPromotionalCards, 'Only sale filter should hide non-promotional product cards').toEqual([]);
}

const server = startPreview();
let serverOutput = '';
server.stdout.on('data', (chunk) => {
	serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
	serverOutput += chunk.toString();
});

try {
	await waitForServer(() => serverOutput);

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
	await mockLiveProductApi(page);
	await page.addInitScript(() => localStorage.clear());
	await page.goto(BASE_URL, { waitUntil: 'networkidle' });

	await expect(page.locator('.brand strong')).toHaveText('Dr. Biomaster');
	await expect(page.locator('.product-card')).toHaveCount(99);
	await expect(page.locator('.total')).toContainText('0.00 / 0.00');
	await expect(page.locator('.price-check-button')).toBeVisible();
	await expect(page.locator('.price-check-button')).toBeEnabled();

	await expect(productCard(page, '24892').locator('.sale')).toContainText('-10%');

	const cannabimaxFilterCard = await clickProduct(page, '8077');
	await cannabimaxFilterCard.locator('.product-main').click();
	await expect(cannabimaxFilterCard.locator('.sale')).toContainText('-10%');
	await expect(cannabimaxFilterCard.locator('em')).toContainText('-10%');
	await setOnlySale(page, true);
	await expect(productCard(page, '8077')).toBeVisible();
	await expect(productCard(page, '2433')).toHaveCount(0);
	await expectVisibleCardsArePromotional(page);
	await clearCart(page);
	await expect(productCard(page, '8077')).toHaveCount(0);
	await setOnlySale(page, false);
	await expect(page.locator('.product-card')).toHaveCount(99);

	await clickProduct(page, '2433');
	await expect(productCard(page, '2433')).toHaveClass(/selected/);
	await expect(page.locator('.cart-total')).toContainText('31.70 / 62.00');

	await clearCart(page);
	await page.locator('input[type="search"]').fill('');
	const cannabimaxCard = await clickProduct(page, '8077');
	await cannabimaxCard.locator('.product-main').click();
	await cannabimaxCard.locator('.product-main').click();
	await expect(cannabimaxCard.locator('em')).toContainText('-20%');
	await expect(page.locator('.cart')).toContainText('-20%');

	await clearCart(page);
	await page.locator('input[type="search"]').fill('');
	await clickProduct(page, '1769');
	await clickProduct(page, '1853');
	await expect(page.locator('.package-choice')).toBeVisible();
	await page.locator('.package-choice .use-package').click();
	await expect(productCard(page, '24723')).toHaveClass(/selected/);
	await expect(productCard(page, '1769')).not.toHaveClass(/selected/);
	await expect(productCard(page, '1853')).not.toHaveClass(/selected/);

	await page.locator('.price-check-button').click();
	await expect(page.locator('.price-check-strip')).toContainText(/99 .* live/, {
		timeout: 30000
	});
	await expect(page.locator('.price-check-strip')).toBeHidden({ timeout: 7000 });

	liveProductOverrides.set('2433', { price: 55.8, regularPrice: 62, onSale: true });
	await clearCart(page);
	await page.locator('input[type="search"]').fill('');
	await setOnlySale(page, false);
	await page.locator('.price-check-button').click();
	await expect(page.locator('.price-check-strip')).toContainText(/live/, { timeout: 30000 });
	await expect(page.locator('.price-check-strip .text-button')).toContainText(/live/);
	await page.locator('.price-check-strip .text-button').filter({ hasText: /live/ }).click();
	await expect(productCard(page, '2433').locator('.sale')).toContainText('-10%');
	await clickProduct(page, '2433');
	await expect(page.locator('.cart-total')).toContainText('28.53 / 55.80');
	await clearCart(page);
	await setOnlySale(page, true);
	await expect(productCard(page, '2433')).toBeVisible();
	await expectVisibleCardsArePromotional(page);
	await page.locator('.header-actions .text-button').filter({ hasText: /Локален|каталог/ }).click();
	await expect(productCard(page, '2433').locator('.sale')).toHaveCount(0);
	await expect(productCard(page, '2433')).toHaveCount(0);

	await browser.close();
	console.log('Smoke tests passed');
} finally {
	stopPreview(server);
}
