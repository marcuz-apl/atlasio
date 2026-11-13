// End-to-end check of import-time CRS transformation.
//
// Stages synthetic wells whose source coordinates are the PROJ-confirmed
// EPSG:1311 control points, publishes them, and asserts that the source CRS and
// source coordinates are preserved while the display position is transformed to
// EPSG:4326 with the recorded operation and accuracy. Also asserts that an
// out-of-area ED50 position and an unregistered CRS are blocked.
//
// Run against a live stack:  node scripts/verify-crs.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const host = process.env.ATLASIO_URL || 'http://localhost:8000';
const run = randomUUID().slice(0, 8);

async function resolveDemoKeys() {
  const fallback = { importer: 'importer-demo', reviewer: 'reviewer-demo', reader: 'viewer-demo' };
  try {
    const items = await (await fetch(`${host}/api/demo-profiles`)).json();
    return { ...fallback, ...Object.fromEntries(items.map((item) => [item.role, item.key])) };
  } catch {
    return fallback;
  }
}
const keys = await resolveDemoKeys();

async function request(path, role, method = 'GET', body) {
  const response = await fetch(`${host}/api${path}`, {
    method,
    headers: { 'X-Atlasio-Key': keys[role], 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, value: await response.json().catch(() => null) };
}

const original = Buffer.from(`SYNTHETIC ED50 HEADER ${run}\n`);
function manifest(label, source_crs, x, y) {
  return {
    name: `SYNTHETIC ED50 ${label} ${run}`,
    aliases: [`SYNTHETIC ED50 ALIAS ${label} ${run}`],
    external_id: `SYNTHETIC-ED50-${label}-${run}`,
    source: 'SYNTHETIC ED50 TEST PACKAGE',
    license: 'Synthetic fixture for unrestricted testing',
    confidentiality: 'public',
    download_allowed: true,
    source_crs,
    x,
    y,
  };
}
const stage = (m) => request('/imports', 'importer', 'POST', {
  manifest: m, file_name: 'SYNTHETIC_ED50_HEADER.txt', file_base64: original.toString('base64'),
});

// Expected display positions come from the PROJ-confirmed control fixture so
// this check stays anchored to the same authority as the domain unit tests.
const fixture = JSON.parse(await readFile(new URL('../fixtures/crs-control-points.json', import.meta.url), 'utf8'));
function control(crs) {
  const found = fixture.controls.find((c) => c.source_crs === crs);
  assert(found, `fixture has a control for ${crs}`);
  return found;
}
const cases = [
  ['UTM31N', control('EPSG:23031')],
  ['UTM32N', control('EPSG:23032')],
  ['GEO', control('EPSG:4230')],
];

const publishedIds = [];
for (const [label, c] of cases) {
  const { source_crs: crs, x, y, expected_lon: lon, expected_lat: lat } = c;
  const staged = await stage(manifest(label, crs, x, y));
  assert.equal(staged.status, 200, JSON.stringify(staged.value));
  assert(!staged.value.qc.some((f) => f.severity === 'error'), `${label}: unexpected QC errors ${JSON.stringify(staged.value.qc)}`);
  assert.equal((await request(`/imports/${staged.value.id}/submit`, 'importer', 'POST')).status, 200);
  const published = await request(`/imports/${staged.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' });
  assert.equal(published.status, 200, JSON.stringify(published.value));
  const wellId = published.value.well_id;
  publishedIds.push(wellId);

  const detail = await request(`/wells/${wellId}`, 'reader');
  assert.equal(detail.status, 200);
  const version = detail.value.versions[0];
  // Source is preserved exactly.
  assert.equal(version.source_crs, crs, `${label}: source CRS preserved`);
  assert.equal(version.source_x, x, `${label}: source X preserved`);
  assert.equal(version.source_y, y, `${label}: source Y preserved`);
  // Display is transformed to EPSG:4326 within 1e-7 deg (~1 cm).
  assert(Math.abs(version.longitude - lon) < 1e-7, `${label}: display lon ${version.longitude} != ${lon}`);
  assert(Math.abs(version.latitude - lat) < 1e-7, `${label}: display lat ${version.latitude} != ${lat}`);
  assert.equal(version.transform_operation, 'EPSG:1311', `${label}: operation recorded`);
  assert.equal(version.transform_accuracy_m, 1.0, `${label}: accuracy recorded`);

  // The map places the well at the transformed display position, not the source.
  const map = await request('/map/wells', 'reader');
  const feature = map.value.features.find((f) => f.properties.well_id === wellId);
  assert(feature, `${label}: well present on map`);
  assert(Math.abs(feature.geometry.coordinates[0] - lon) < 1e-7, `${label}: map lon transformed`);
  assert(Math.abs(feature.geometry.coordinates[1] - lat) < 1e-7, `${label}: map lat transformed`);
  console.log(`${label}: source ${crs} (${x}, ${y}) preserved; display EPSG:4326 (${version.longitude.toFixed(7)}, ${version.latitude.toFixed(7)}) via ${version.transform_operation} ±${version.transform_accuracy_m} m`);
}

// Out-of-area ED50 is blocked at QC and cannot be submitted.
const outOfArea = await stage(manifest('OUTAREA', 'EPSG:4230', 100.0, 0.0));
assert.equal(outOfArea.status, 200);
assert(outOfArea.value.qc.some((f) => f.code === 'out_of_range_coordinates' && f.severity === 'error'), 'out-of-area ED50 must be blocked');
assert.equal((await request(`/imports/${outOfArea.value.id}/submit`, 'importer', 'POST')).status, 422);

// An unregistered CRS is blocked.
const unsupported = await stage(manifest('RDNEW', 'EPSG:28992', 100000.0, 400000.0));
assert.equal(unsupported.status, 200);
assert(unsupported.value.qc.some((f) => f.code === 'unverified_crs' && f.severity === 'error'), 'unregistered CRS must be blocked');
assert.equal((await request(`/imports/${unsupported.value.id}/submit`, 'importer', 'POST')).status, 422);

console.log(`CRS transformation verified: ${cases.length} ED50 variants preserved source and transformed display; out-of-area and unregistered CRS blocked.`);