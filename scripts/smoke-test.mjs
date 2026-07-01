import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const PORT = Number(process.env.SMOKE_TEST_PORT ?? 4174);
const BASE_URL = `http://127.0.0.1:${PORT}/`;

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
	await page.locator('.cart-actions .text-button').nth(1).click();
	await expect(page.locator('.cart')).toContainText('0');
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
	await page.addInitScript(() => localStorage.clear());
	await page.goto(BASE_URL, { waitUntil: 'networkidle' });

	await expect(page.locator('.brand strong')).toHaveText('Dr. Biomaster');
	await expect(page.locator('.product-card')).toHaveCount(99);
	await expect(page.locator('.total')).toContainText('0.00 / 0.00');

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

	await browser.close();
	console.log('Smoke tests passed');
} finally {
	stopPreview(server);
}
