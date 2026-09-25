// Google Apps Script: public catalogue access only; no Google account data is read.
function fetchPublicCataloguePage(page) {
  if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid page');
  const url = 'https://drbiomaster.com/wp-json/wc/store/v1/products?per_page=100&page=' + page;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('Catalogue HTTP ' + response.getResponseCode() + ': ' +
      response.getContentText().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 250));
  }
  const products = JSON.parse(response.getContentText());
  const headers = response.getAllHeaders();
  const countKey = Object.keys(headers).find(key => key.toLowerCase() === 'x-wp-total');
  const total = Number(countKey ? headers[countKey] : NaN);
  if (!Array.isArray(products) || !Number.isInteger(total) || total < 1) throw new Error('Invalid catalogue response');
  return { source: 'https://drbiomaster.com', fetchedAt: new Date().toISOString(), total, products };
}

function doGet(event) {
  let result;
  try {
    const rawPage = event && event.parameter && event.parameter.page || '1';
    if (!/^\d+$/.test(rawPage)) throw new Error('Invalid page');
    result = fetchPublicCataloguePage(Number(rawPage));
  } catch (error) {
    result = { error: String(error.message || error) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function checkPublicCatalogue() {
  const result = fetchPublicCataloguePage(1);
  console.log(JSON.stringify({ fetchedAt: result.fetchedAt, total: result.total, pageCount: result.products.length }));
}
