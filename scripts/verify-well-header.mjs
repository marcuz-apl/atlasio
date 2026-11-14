import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const fallback = { importer: 'importer-demo', reviewer: 'reviewer-demo', reader: 'viewer-demo' };
let keys = fallback;
try {
  const items = await (await fetch(`${host}/api/demo-profiles`)).json();
  keys = { ...fallback, ...Object.fromEntries(items.map((item) => [item.role, item.key])) };
} catch {}

async function request(path, role, method = 'GET', body) {
  const response = await fetch(`${host}/api${path}`, {
    method,
    headers: { 'X-Atlasio-Key': keys[role], 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  return { status: response.status, value };
}

const source = await readFile(new URL('fixtures/SYNTHETIC_HEADER.txt', root));
const run = randomUUID().slice(0, 8);
const stage = (manifest) => request('/imports', 'importer', 'POST', {
  manifest, file_name: 'SYNTHETIC_HEADER.txt', file_base64: source.toString('base64'),
});
const errors = (value) => value.qc.filter((finding) => finding.severity === 'error');
const warnings = (value) => value.qc.filter((finding) => finding.severity === 'warning').map((finding) => finding.code);
async function publish(manifest) {
  const staged = await stage(manifest);
  assert.equal(staged.status, 200, JSON.stringify(staged.value));
  assert.deepEqual(errors(staged.value), [], `blocking findings: ${JSON.stringify(staged.value.qc)}`);
  const submitted = await request(`/imports/${staged.value.id}/submit`, 'importer', 'POST');
  assert.equal(submitted.status, 200, JSON.stringify(submitted.value));
  const reviewed = await request(`/imports/${staged.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value));
  const record = await request(`/wells/${reviewed.value.well_id}`, 'reader');
  assert.equal(record.status, 200);
  return { staged, version: record.value.versions[0] };
}

const industry = {
  folder: `SYNTHETIC FOLDER ${run}`,
  well_symbol: 'OIL',
  drilling_structure: 'SYNTHETIC STRUCTURE',
  operator: 'SYNTHETIC OPERATOR',
  datum_name: 'KB',
  datum_value: 25.5,
  datum_unit: 'm',
  td_md: 3500.0,
  td_unit: 'm',
  bottom_hole_x: 362799.0,
  bottom_hole_y: 5763146.0,
  source_lat: 51.9992313,
  source_lon: 6.9987599,
  source_geo_crs: 'EPSG:4230',
  spud_date: '1990-05-13',
  completion_date: '1990-08-02',
};

// 1. Full 17-column industry header round-trips with source preserved.
const full = await publish({
  name: `SYNTHETIC INDUSTRY WELL ${run}`,
  aliases: [`SYNTHETIC INDUSTRY ALT ${run}`],
  external_id: `SYNTHETIC-UWI-${run}`,
  source: 'SYNTHETIC PACKAGE',
  license: 'SYNTHETIC TEST USE',
  confidentiality: 'public',
  download_allowed: true,
  source_crs: 'EPSG:23032',
  x: 362699.019998,
  y: 5763046.671862,
  ...industry,
});
for (const [key, expected] of Object.entries(industry)) {
  assert.deepEqual(full.version[key], expected, `record field ${key}`);
}
assert.equal(full.version.external_id, `SYNTHETIC-UWI-${run}`);
assert.equal(full.version.source_crs, 'EPSG:23032');
assert.equal(full.version.source_x, 362699.019998);
assert.equal(full.version.source_y, 5763046.671862);
assert.equal(full.version.transform_operation, 'EPSG:1311');
assert.ok(Math.abs(full.version.longitude - 6.9987599) < 1e-6);
assert.ok(Math.abs(full.version.latitude - 51.9992313) < 1e-6);

// 2. Geographic-only header (no x/y) publishes through the verified operation.
const geo = await publish({
  name: `SYNTHETIC GEO ONLY WELL ${run}`,
  external_id: `SYNTHETIC-GEO-${run}`,
  source: 'SYNTHETIC PACKAGE',
  license: 'SYNTHETIC TEST USE',
  confidentiality: 'public',
  download_allowed: true,
  source_lat: 51.9992313,
  source_lon: 6.9987599,
  source_geo_crs: 'EPSG:4230',
});
assert.equal(geo.version.source_lat, 51.9992313);
assert.equal(geo.version.source_lon, 6.9987599);
assert.equal(geo.version.source_geo_crs, 'EPSG:4230');
assert.equal(geo.version.transform_operation, 'EPSG:1311');
assert.ok(Math.abs(geo.version.longitude - 6.9987599) < 0.01);
assert.ok(Math.abs(geo.version.latitude - 51.9992313) < 0.01);

// 3. CRS written as an industry alias is accepted and preserved as provided.
const alias = await publish({
  name: `SYNTHETIC ALIAS CRS WELL ${run}`,
  external_id: `SYNTHETIC-ALIAS-${run}`,
  source: 'SYNTHETIC PACKAGE',
  license: 'SYNTHETIC TEST USE',
  confidentiality: 'public',
  download_allowed: true,
  source_crs: 'ED50 / UTM zone 32N',
  x: 362699.019998,
  y: 5763046.671862,
});
assert.equal(alias.version.source_crs, 'ED50 / UTM zone 32N');
assert.equal(alias.version.transform_operation, 'EPSG:1311');

// 4. Header gaps raise warnings, never blocks.
const warned = await stage({
  name: `SYNTHETIC WARNED WELL ${run}`,
  external_id: `SYNTHETIC-WARN-${run}`,
  source: 'SYNTHETIC PACKAGE',
  license: 'SYNTHETIC TEST USE',
  confidentiality: 'public',
  download_allowed: true,
  source_crs: 'EPSG:23032',
  x: 362699.019998,
  y: 5763046.671862,
  datum_name: 'MSL',
  datum_value: 25.5,
  td_md: 3500.0,
  spud_date: '13/05/1990',
});
assert.equal(warned.status, 200);
for (const code of ['missing_datum_unit', 'missing_td_unit', 'unknown_datum_name', 'invalid_spud_date']) {
  assert.ok(warnings(warned.value).includes(code), `expected warning ${code}: ${JSON.stringify(warned.value.qc)}`);
}
assert.deepEqual(errors(warned.value), []);
assert.equal((await request(`/imports/${warned.value.id}/submit`, 'importer', 'POST')).status, 200);

console.log('Industry well header round-trip, geographic-only publish, CRS alias, and warnings-not-blocks passed.');