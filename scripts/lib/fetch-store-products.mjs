const SHOP_ORIGIN = 'https://drbiomaster.com';
const API_PATH = '/wp-json/wc/store/v1/products';
const REQUEST_HEADERS = {
	accept: 'application/json, text/plain, */*',
	'accept-language': 'bg-BG,bg;q=0.9,en-US;q=0.8,en;q=0.7',
	referer: `${SHOP_ORIGIN}/`,
	'user-agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
};

async function fetchJsonpPage(url, page) {
	const callbackName = `drBiomasterSync_${page}`;
	const response = await fetch(`${url}&_jsonp=${callbackName}`, { headers: REQUEST_HEADERS });
	if (!response.ok) {
		if (response.status === 400 || response.status === 404) return [];
		throw new Error(`Failed to fetch products page ${page} via JSONP: ${response.status}`);
	}

	const text = await response.text();
	const prefix = `${callbackName}(`;
	if (!text.startsWith(prefix) || !text.trimEnd().endsWith(');')) {
		throw new Error(`Unexpected JSONP response for products page ${page}`);
	}

	return JSON.parse(text.slice(prefix.length, text.lastIndexOf(');')));
}

async function fetchPageDirect(page) {
	const url = `${SHOP_ORIGIN}${API_PATH}?per_page=100&page=${page}`;
	const response = await fetch(url, { headers: REQUEST_HEADERS });
	if (!response.ok) {
		if (response.status === 403) return fetchJsonpPage(url, page);
		if (response.status === 400 || response.status === 404) return [];
		throw new Error(`Failed to fetch products page ${page}: ${response.status}`);
	}

	return response.json();
}

async function fetchPageInBrowser(page, pageNumber) {
	const result = await page.evaluate(
		async ({ apiPath, pageNumber: requestedPage }) => {
			const response = await fetch(`${apiPath}?per_page=100&page=${requestedPage}`, {
				headers: { accept: 'application/json, text/plain, */*' }
			});

			return { status: response.status, text: await response.text() };
		},
		{ apiPath: API_PATH, pageNumber }
	);

	if (result.status === 400 || result.status === 404) return [];
	if (result.status !== 200) {
		throw new Error(`Browser fetch failed for products page ${pageNumber}: ${result.status}`);
	}

	return JSON.parse(result.text);
}

async function fetchWithBrowser() {
	const { chromium } = await import('@playwright/test');
	const browser = await chromium.launch({ headless: true });

	try {
		const context = await browser.newContext({ locale: 'bg-BG' });
		const page = await context.newPage();
		await page.goto(`${SHOP_ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

		const products = [];
		for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
			let batch;
			for (let attempt = 1; attempt <= 4; attempt += 1) {
				try {
					batch = await fetchPageInBrowser(page, pageNumber);
					break;
				} catch (error) {
					if (attempt === 4) throw error;
					await page.waitForTimeout(2_500);
				}
			}

			products.push(...batch);
			if (batch.length < 100) break;
		}

		return products;
	} finally {
		await browser.close();
	}
}

async function fetchDirect() {
	const products = [];

	for (let page = 1; page <= 20; page += 1) {
		const batch = await fetchPageDirect(page);
		products.push(...batch);
		if (batch.length < 100) break;
	}

	return products;
}

export async function fetchStoreProducts() {
	if (process.env.FETCH_PRODUCTS_WITH_BROWSER === '1') {
		return fetchWithBrowser();
	}

	return fetchDirect();
}
