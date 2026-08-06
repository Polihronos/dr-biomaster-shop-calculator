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
	await page.addInitScript(() => {
		localStorage.clear();
		const files = new Map();
		window.__dailySalesTestFiles = files;
		window.__dailySalesFolderCreated = false;

		class TestFileHandle {
			constructor(name) {
				this.name = name;
			}

			async getFile() {
				return { text: async () => files.get(this.name) ?? '' };
			}

			async createWritable() {
				let contents = '';
				return {
					write: async (data) => {
						contents = data;
					},
					close: async () => files.set(this.name, contents)
				};
			}
		}

		const directory = {
			name: 'daily sales',
			getDirectoryHandle: async () => directory,
			getFileHandle: async (name, options = {}) => {
				if (!files.has(name) && !options.create) throw new DOMException('Missing', 'NotFoundError');
				if (!files.has(name)) files.set(name, '');
				return new TestFileHandle(name);
			},
			async *values() {
				for (const name of files.keys()) yield new TestFileHandle(name);
			}
		};
		const documents = {
			name: 'Documents',
			getDirectoryHandle: async (name, options = {}) => {
				if (name !== 'daily sales' || !options.create) throw new DOMException('Missing', 'NotFoundError');
				window.__dailySalesFolderCreated = true;
				return directory;
			}
		};

		window.showDirectoryPicker = async () => documents;
	});
	await page.goto(BASE_URL, { waitUntil: 'networkidle' });

	await expect(page.locator('.brand strong')).toHaveText('Dr. Biomaster');
	await expect(page.locator('.product-card')).toHaveCount(99);
	await expect(page.locator('.total')).toContainText('0.00 / 0.00');
	await expect(page.locator('.price-check-button')).toBeVisible();
	await expect(page.locator('.price-check-button')).toBeEnabled();
	await expect(page.locator('.daily-sales-button')).toBeVisible();
	await expect(page.locator('.daily-orders-button')).toHaveCount(0);
	await page.evaluate(() => {
		window.__dailyOrdersOpenRequests = 0;
		document.addEventListener('dr-biomaster-open-daily-orders', () => {
			window.__dailyOrdersOpenRequests += 1;
		});
		document.documentElement.dataset.drBiomasterOrdersExtension = 'active';
		document.dispatchEvent(new CustomEvent('dr-biomaster-orders-extension-ready'));
	});
	await expect(page.locator('.daily-orders-button')).toBeVisible();
	await page.locator('.daily-orders-button').click();
	expect(await page.evaluate(() => window.__dailyOrdersOpenRequests)).toBe(1);
	await expect(page.getByRole('button', { name: 'Добави продажба в брой' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Добави продажба с карта' })).toBeDisabled();

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
	await page.getByRole('button', { name: '40%' }).click();
	await expect(page.locator('.cart-total')).toContainText('19.02 / 37.20');
	await page.getByLabel('Отстъпка по избор в проценти').fill('12.5');
	await expect(page.locator('.cart-total')).toContainText('27.74 / 54.25');

	await expect(page.getByRole('button', { name: 'Принтирай кошницата' })).toBeVisible();
	await page.getByRole('button', { name: 'Добави продажба в брой' }).click();
	await expect(page.locator('.sales-message')).toContainText('в брой');
	await expectCartEmpty(page);
	const writtenSalesFile = await page.evaluate(() => [...window.__dailySalesTestFiles.values()][0]);
	expect(await page.evaluate(() => window.__dailySalesFolderCreated)).toBe(true);
	expect(writtenSalesFile).toContain('АЛОЕ АРБОРЕСЦЕНС');
	expect(writtenSalesFile).toContain('💵 CASH');
	expect(writtenSalesFile).toContain('обща отстъпка -12.5%');

	await page.locator('.daily-sales-button').click();
	await expect(page.locator('.sales-modal')).toBeVisible();
	await expect(page.locator('.sale-row')).toHaveCount(1);
	await expect(page.locator('.sale-row').first().locator('.row-actions button')).toHaveCount(2);
	await expect(page.locator('.sales-header')).toContainText('27.74 EUR');
	await expect(page.locator('.sale-row')).toContainText('Обща отстъпка −12.5%');
	await page.locator('.sales-header').getByRole('button', { name: 'Добави продажба ръчно' }).click();
	const suggestedProduct = PRODUCTS.find((product) => product.id === '2433');
	await page.locator('.sale-editor .product-field input').fill(suggestedProduct.name);
	await expect(page.locator('.sale-editor input[type="number"]').nth(2)).toHaveValue(
		String(Number((suggestedProduct.price / 1.95583).toFixed(2)))
	);
	await page.locator('.sale-editor select').selectOption('card');
	await page.getByRole('button', { name: /Запиши във файла/ }).click();
	await expect(page.locator('.sale-row')).toHaveCount(2);
	await page.locator('.filters button').filter({ hasText: 'Карта' }).click();
	await expect(page.locator('.sale-row')).toHaveCount(1);
	await expect(page.locator('.sales-header')).toContainText('31.70 EUR');
	await page.locator('.filters button').filter({ hasText: 'В брой' }).click();
	await expect(page.locator('.sale-row')).toHaveCount(1);
	await page.locator('.filters button').filter({ hasText: 'Всички' }).click();
	await expect(page.locator('.sales-header')).toContainText('59.44 EUR');

	await page.locator('.sale-row').first().getByRole('button', { name: 'Редактирай' }).click();
	await expect(page.locator('.sale-editor')).toBeVisible();
	await page.locator('.sale-editor input[type="number"]').last().fill('50');
	await page.getByRole('button', { name: /Запиши във файла/ }).click();
	await expect(page.locator('.sales-header')).toContainText('45.57 EUR');
	page.once('dialog', (dialog) => dialog.accept());
	await page.locator('.sale-row').first().getByRole('button', { name: 'Изтрий' }).click();
	await expect(page.locator('.sale-row')).toHaveCount(1);
	await page.getByRole('button', { name: 'Затвори', exact: true }).click();
	await page.evaluate(() => {
		const oldSale = {
			id: 'older-sale',
			createdAt: '2026-08-03T10:00:00.000Z',
			payment: 'card',
			globalDiscount: 0,
			items: [{ productId: 'old', name: 'Архивен продукт', quantity: 1, unitPrice: 25, discountPercent: 0 }],
			total: 25
		};
		window.__dailySalesTestFiles.set(
			'03-08-2026.txt',
			`# Dr. Biomaster Daily Sales v1\n# Date: 03/08/2026\n1: Архивен продукт x1 - 25.00 EUR - 💳 CARD\t${JSON.stringify(oldSale)}\n`
		);
	});
	await page.locator('.daily-sales-button').click();
	await expect(page.locator('.sale-row')).toHaveCount(1);
	await page.locator('.sales-toolbar select').selectOption('2026-08-03');
	await expect(page.locator('.sales-header')).toContainText('25.00 EUR');
	await expect(page.locator('.sale-row')).toContainText('Архивен продукт');
	await page.getByRole('button', { name: 'Затвори', exact: true }).click();
	await page.getByLabel('Отстъпка по избор в проценти').fill('0');

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
