import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

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
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const run = randomUUID().slice(0, 8);

// A published well to attach datasets to.
const header = await readFile(new URL('fixtures/SYNTHETIC_HEADER.txt', root));
const staged = await request('/imports', 'importer', 'POST', {
  manifest: {
    name: `SYNTHETIC DATASET HOST ${run}`, external_id: `SYNTHETIC-HOST-${run}`,
    source: 'SYNTHETIC PACKAGE', license: 'SYNTHETIC TEST USE', confidentiality: 'public',
    download_allowed: true, source_crs: 'EPSG:4326', x: 6.99, y: 51.99,
  },
  file_name: 'SYNTHETIC_HEADER.txt', file_base64: header.toString('base64'),
});
assert.equal(staged.status, 200, JSON.stringify(staged.value));
await request(`/imports/${staged.value.id}/submit`, 'importer', 'POST');
const published = await request(`/imports/${staged.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' });
assert.equal(published.status, 200);
const wellId = published.value.well_id;

// 1. Small attach: checksum, size, source CRS, licence, access state.
const las = Buffer.from(`SYNTHETIC LAS CURVE FIXTURE ${run}\n~CURVE\nDEPT.M\nGR.GAPI\n`);
const attached = await request('/datasets', 'importer', 'POST', {
  well_id: wellId, kind: 'logs', format: 'LAS', source_crs: null,
  license: 'SYNTHETIC TEST USE', confidentiality: 'public',
  file_name: 'SYNTHETIC_LOG.las', file_base64: las.toString('base64'),
});
assert.equal(attached.status, 200, JSON.stringify(attached.value));
assert.equal(attached.value.sha256, sha(las));
assert.equal(attached.value.size_bytes, las.length);
assert.equal(attached.value.status, 'published');
const listed = await request(`/wells/${wellId}/datasets`, 'reader');
assert.equal(listed.status, 200);
assert.ok(listed.value.some((item) => item.id === attached.value.id));
const detail = await request(`/datasets/${attached.value.id}`, 'reader');
assert.equal(detail.value.kind, 'logs');
assert.equal(detail.value.license, 'SYNTHETIC TEST USE');
const download = await fetch(`${host}/api/datasets/${attached.value.id}/original`, { headers: { 'X-Atlasio-Key': keys.reader } });
assert.equal(download.status, 200);
assert.deepEqual(Buffer.from(await download.arrayBuffer()), las);

// 2. Large file streams (no base64): 6 MiB raw body.
const big = Buffer.alloc(6 * 1024 * 1024, 7);
const meta = await request('/datasets', 'importer', 'POST', {
  well_id: wellId, kind: 'logs', format: 'LAS', license: 'SYNTHETIC TEST USE', confidentiality: 'public',
  file_name: 'SYNTHETIC_BIG.las',
});
assert.equal(meta.status, 200, JSON.stringify(meta.value));
const streamed = await fetch(`${host}/api/datasets/${meta.value.id}/original`, {
  method: 'PUT', headers: { 'X-Atlasio-Key': keys.importer, 'Content-Type': 'application/octet-stream' }, body: big,
});
assert.equal(streamed.status, 200, JSON.stringify(await streamed.json().catch(() => null)));
const streamedValue = await streamed.json().catch(() => null);
const bigDetail = await request(`/datasets/${meta.value.id}`, 'importer');
assert.equal(bigDetail.value.size_bytes, big.length);
assert.equal(bigDetail.value.sha256, sha(big));
const bigDownload = await fetch(`${host}/api/datasets/${meta.value.id}/original`, { headers: { 'X-Atlasio-Key': keys.importer } });
assert.deepEqual(Buffer.from(await bigDownload.arrayBuffer()), big);

// 3. Base64 path still refuses oversized payloads.
const oversized = await request('/datasets', 'importer', 'POST', {
  well_id: wellId, kind: 'logs', format: 'LAS', license: 'SYNTHETIC TEST USE', confidentiality: 'public',
  file_name: 'SYNTHETIC_TOO_BIG.las', file_base64: big.toString('base64'),
});
assert.equal(oversized.status, 413);

// 4. Restricted datasets are hidden from reader everywhere.
const restricted = await request('/datasets', 'importer', 'POST', {
  well_id: wellId, kind: 'documents', format: 'PDF', license: 'SYNTHETIC TEST USE', confidentiality: 'restricted',
  file_name: 'SYNTHETIC_RESTRICTED.pdf', file_base64: las.toString('base64'),
});
assert.equal(restricted.status, 200);
assert.ok(!(await request(`/wells/${wellId}/datasets`, 'reader')).value.some((item) => item.id === restricted.value.id));
assert.equal((await request(`/datasets/${restricted.value.id}`, 'reader')).status, 403);
assert.equal((await fetch(`${host}/api/datasets/${restricted.value.id}/original`, { headers: { 'X-Atlasio-Key': keys.reader } })).status, 403);

// 5. Published datasets are immutable.
assert.equal((await request(`/datasets/${attached.value.id}`, 'importer', 'DELETE')).status, 405);

// 6. Seismic survey catalog with footprint: display transformed, source preserved.
const footprint = { type: 'Polygon', coordinates: [[[360000, 5760000], [365000, 5760000], [365000, 5765000], [360000, 5765000], [360000, 5760000]]] };
const survey = await request('/seismic-surveys', 'importer', 'POST', {
  name: `SYNTHETIC SURVEY ${run}`, kind: '3d', source_crs: 'EPSG:23032', footprint,
  license: 'SYNTHETIC TEST USE', confidentiality: 'public',
});
assert.equal(survey.status, 200, JSON.stringify(survey.value));
const surveys = await request('/seismic-surveys', 'reader');
assert.ok(surveys.value.some((item) => item.id === survey.value.id));
const map = await request('/map/seismic', 'reader');
assert.equal(map.status, 200);
const feature = map.value.features.find((item) => item.properties.survey_id === survey.value.id);
assert.ok(feature, 'survey footprint on map');
assert.equal(feature.properties.source_crs, 'EPSG:23032');
const [lon, lat] = feature.geometry.coordinates[0][0];
assert.ok(lon > 6 && lon < 8 && lat > 51 && lat < 53, `display footprint in WGS84: ${lon},${lat}`);
const cube = await request('/datasets', 'importer', 'POST', {
  survey_id: survey.value.id, kind: 'seismic-3d', format: 'SEG-Y', source_crs: 'EPSG:23032',
  license: 'SYNTHETIC TEST USE', confidentiality: 'public', file_name: 'SYNTHETIC_CUBE.sgy',
});
assert.equal(cube.status, 200);
const cubeStream = await fetch(`${host}/api/datasets/${cube.value.id}/original`, {
  method: 'PUT', headers: { 'X-Atlasio-Key': keys.importer, 'Content-Type': 'application/octet-stream' }, body: big,
});
assert.equal(cubeStream.status, 200);

// 7. Unregistered CRS survey stays catalog-only: no display footprint, no silent transform.
const nad = await request('/seismic-surveys', 'importer', 'POST', {
  name: `SYNTHETIC NAD SURVEY ${run}`, kind: '2d', source_crs: 'NAD27 / Texas South', footprint,
  license: 'SYNTHETIC TEST USE', confidentiality: 'public',
});
assert.equal(nad.status, 200);
const nadMap = await request('/map/seismic', 'reader');
assert.ok(!nadMap.value.features.some((item) => item.properties.survey_id === nad.value.id));
const nadDetail = await request('/seismic-surveys', 'importer');
const nadRow = nadDetail.value.find((item) => item.id === nad.value.id);
assert.equal(nadRow.source_crs, 'NAD27 / Texas South');
assert.equal(nadRow.display_footprint, null);

console.log('Datasets attach/stream/checksum/access/immutability and seismic catalog/footprints passed.');