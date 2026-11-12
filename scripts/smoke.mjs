import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const host = process.env.ATLASIO_URL || 'http://localhost:8000';
const keys = await resolveDemoKeys();

// Demo keys are managed records and may be rotated from the admin panel.
async function resolveDemoKeys() {
  const fallback = { importer: 'importer-demo', reviewer: 'reviewer-demo', reader: 'reader-demo' };
  try {
    const response = await fetch(`${host}/api/demo-profiles`);
    const items = await response.json();
    const resolved = Object.fromEntries(items.map((item) => [item.role, item.key]));
    return { ...fallback, ...resolved };
  } catch (error) {
    return fallback;
  }
}

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
const ca = JSON.parse(await readFile(new URL('fixtures/synthetic-ca.json', root), 'utf8'));
const au = JSON.parse(await readFile(new URL('fixtures/synthetic-au.json', root), 'utf8'));
const run = randomUUID().slice(0, 8);
for (const manifest of [ca, au]) {
  manifest.name += ` ${run}`;
  manifest.external_id += `-${run}`;
  manifest.aliases = manifest.aliases.map(alias => `${alias} ${run}`);
}
const stage = (manifest) => request('/imports', 'importer', 'POST', {
  manifest, file_name: 'SYNTHETIC_HEADER.txt', file_base64: source.toString('base64'),
});

const blocked = await stage({ ...ca, source_crs: null });
assert.equal(blocked.status, 200, JSON.stringify(blocked.value));
assert(blocked.value.qc.some((finding) => finding.code === 'missing_crs'));
assert.equal((await request(`/imports/${blocked.value.id}/submit`, 'importer', 'POST')).status, 422);
assert.equal((await request(`/imports/${blocked.value.id}`, 'importer', 'PATCH', { source_crs: 'EPSG:4326' })).status, 200);
assert.equal((await request(`/imports/${blocked.value.id}/submit`, 'importer', 'POST')).status, 200);
const published = await request(`/imports/${blocked.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' });
assert.equal(published.status, 200, JSON.stringify(published.value));
const wellId = published.value.well_id;

const byAlias = await request(`/wells/search?q=${encodeURIComponent(ca.aliases[0])}`, 'reader');
assert.equal(byAlias.status, 200);
assert(byAlias.value.some((well) => well.id === wellId));
const map = await request('/map/wells', 'reader');
assert.equal(map.status, 200);
assert(map.value.features.some((feature) => feature.properties.well_id === wellId));
const record = await request(`/wells/${wellId}`, 'reader');
assert.equal(record.value.versions.length, 1);
assert.equal(record.value.versions[0].source_crs, 'EPSG:4326');
assert.equal(record.value.versions[0].source_x, -110);
const download = await fetch(`${host}/api/files/${record.value.versions[0].file_id}`, { headers: { 'X-Atlasio-Key': keys.reader } });
assert.equal(download.status, 200);
assert.deepEqual(Buffer.from(await download.arrayBuffer()), source);

const second = await stage({ ...ca, name: 'SYNTHETIC WELL CA-001 REVISION' });
assert.equal(second.status, 200);
assert(second.value.qc.some((finding) => finding.code === 'possible_duplicate'));
assert.equal((await request(`/imports/${second.value.id}/submit`, 'importer', 'POST')).status, 200);
const replacement = await request(`/imports/${second.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: wellId });
assert.equal(replacement.status, 200, JSON.stringify(replacement.value));
assert.equal(replacement.value.version_no, 2);
const updated = await request(`/wells/${wellId}`, 'reader');
assert.equal(updated.value.versions.length, 2);
assert.equal(updated.value.versions[1].name, ca.name);

const otherCountry = await stage(au);
assert.equal(otherCountry.status, 200);
assert.equal((await request(`/imports/${otherCountry.value.id}/submit`, 'importer', 'POST')).status, 200);
assert.equal((await request(`/imports/${otherCountry.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' })).status, 200);
assert.equal((await request(`/wells/search?q=${encodeURIComponent(au.aliases[0])}`, 'reader')).value.length, 1);

const restrictedId = `SYNTHETIC-RESTRICTED-${run}`;
const restricted = await stage({ ...ca, name: `SYNTHETIC RESTRICTED WELL ${run}`, aliases: [`SYNTHETIC RESTRICTED ALIAS ${run}`], external_id: restrictedId, confidentiality: 'restricted' });
assert.equal(restricted.status, 200);
assert.equal((await request(`/imports/${restricted.value.id}/submit`, 'importer', 'POST')).status, 200);
const restrictedPublished = await request(`/imports/${restricted.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' });
assert.equal(restrictedPublished.status, 200);
assert.equal((await request(`/wells/search?q=${encodeURIComponent(restrictedId)}`, 'reader')).value.length, 0);
assert.equal((await request(`/wells/search?q=${encodeURIComponent(restrictedId)}`, 'importer')).value.length, 1);
assert.equal((await request(`/wells/${restrictedPublished.value.well_id}`, 'reader')).status, 403);
assert.equal((await fetch(`${host}/api/files/${restricted.value.file_id}`, { headers: { 'X-Atlasio-Key': keys.reader } })).status, 403);
assert(!(await request('/map/wells', 'reader')).value.features.some((feature) => feature.properties.well_id === restrictedPublished.value.well_id));

assert.equal((await request('/wells/search', 'importer')).status, 200);
assert.equal((await request('/imports', 'reader')).status, 403);
console.log('Well staging, QC correction, review, immutable replacement, alias search, map, file, access, and second-country fixture passed.');
