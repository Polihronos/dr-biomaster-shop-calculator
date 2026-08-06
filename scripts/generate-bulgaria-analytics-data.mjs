import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NUTS_URL = 'https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_20M_2024_4326_LEVL_3.geojson';
const SETTLEMENTS_URL = 'https://www.nsi.bg/nrnm/ekatte/territorial-units/json';
const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/data/bulgaria-analytics.json');
const WIDTH = 760;
const HEIGHT = 430;
const PADDING = 12;

const [nutsResponse, settlementsResponse] = await Promise.all([fetch(NUTS_URL), fetch(SETTLEMENTS_URL)]);
if (!nutsResponse.ok) throw new Error(`GISCO download failed: ${nutsResponse.status}`);
if (!settlementsResponse.ok) throw new Error(`NSI settlement download failed: ${settlementsResponse.status}`);

const nuts = await nutsResponse.json();
const rawSettlements = await settlementsResponse.json();
const features = nuts.features.filter((feature) => feature.properties?.CNTR_CODE === 'BG' && feature.properties?.LEVL_CODE === 3);
if (features.length !== 28) throw new Error(`Expected 28 Bulgarian NUTS 3 regions, received ${features.length}`);

const allPoints = features.flatMap((feature) => polygonRings(feature.geometry).flat(2));
const meanLatitude = allPoints.reduce((sum, point) => sum + point[1], 0) / allPoints.length;
const longitudeFactor = Math.cos((meanLatitude * Math.PI) / 180);
const projected = allPoints.map(([longitude, latitude]) => [longitude * longitudeFactor, -latitude]);
const bounds = projected.reduce(
	(accumulator, [x, y]) => ({
		minX: Math.min(accumulator.minX, x),
		maxX: Math.max(accumulator.maxX, x),
		minY: Math.min(accumulator.minY, y),
		maxY: Math.max(accumulator.maxY, y)
	}),
	{ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
);
const scale = Math.min((WIDTH - PADDING * 2) / (bounds.maxX - bounds.minX), (HEIGHT - PADDING * 2) / (bounds.maxY - bounds.minY));
const offsetX = (WIDTH - (bounds.maxX - bounds.minX) * scale) / 2;
const offsetY = (HEIGHT - (bounds.maxY - bounds.minY) * scale) / 2;

function project([longitude, latitude]) {
	return [
		Number((offsetX + (longitude * longitudeFactor - bounds.minX) * scale).toFixed(2)),
		Number((offsetY + (-latitude - bounds.minY) * scale).toFixed(2))
	];
}

function polygonRings(geometry) {
	if (geometry.type === 'Polygon') return [geometry.coordinates];
	if (geometry.type === 'MultiPolygon') return geometry.coordinates;
	throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

function pathFor(geometry) {
	return polygonRings(geometry)
		.flatMap((polygon) => polygon.map((ring) => ring.map(project)))
		.map((ring) => `${ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x},${y}`).join('')}Z`)
		.join('');
}

function centroidFor(geometry) {
	const outerRings = polygonRings(geometry).map((polygon) => polygon[0]);
	const largest = outerRings.toSorted((a, b) => b.length - a.length)[0];
	const points = largest.map(project);
	return [
		Number((points.reduce((sum, point) => sum + point[0], 0) / points.length).toFixed(2)),
		Number((points.reduce((sum, point) => sum + point[1], 0) / points.length).toFixed(2))
	];
}

const regionNames = new Map();
for (const settlement of rawSettlements) {
	if (!regionNames.has(settlement.nuts3)) {
		regionNames.set(settlement.nuts3, String(settlement.oblast_name || '').replace(/^обл\.\s*/iu, '').trim());
	}
}

const data = {
	sources: { nuts: NUTS_URL, settlements: SETTLEMENTS_URL },
	viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
	regions: features
		.map((feature) => ({
			id: feature.properties.NUTS_ID,
			name: regionNames.get(feature.properties.NUTS_ID) || feature.properties.NUTS_NAME,
			path: pathFor(feature.geometry),
			centroid: centroidFor(feature.geometry)
		}))
		.toSorted((a, b) => a.name.localeCompare(b.name, 'bg')),
	settlements: rawSettlements.map((settlement) => ({
		n: settlement.name,
		e: settlement.name_en,
		r: settlement.nuts3,
		t: settlement.kind
	}))
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(data)}\n`, 'utf8');
console.log(`Wrote ${data.regions.length} regions and ${data.settlements.length} settlements to ${OUTPUT}`);
