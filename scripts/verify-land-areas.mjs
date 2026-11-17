import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Verifies the governed land-area slice against the running server:
// - real NSTA licences are cataloged with ED50 source geometry and WGS 84 display geometry
// - the map endpoint serves published, public footprints to readers
// - a restricted record is invisible to readers but visible to importers
// - the catalog count reflects the loaded concessions
// - published records are immutable at the database boundary

const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const keys = await resolveDemoKeys();

async function resolveDemoKeys() {
  const fallback = { importer: 'importer-demo', reader: 'viewer-demo' };
  try {
    const response = await fetch(`${host}/api/demo-profiles`);
    const items = await response.json();
    const resolved = Object.fromEntries(items.map((item) => [item.role, item.key]));
    return { ...fallback, ...resolved };
  } catch {
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

const licences = await request('/land-areas?kind=licence', 'importer');
assert.equal(licences.status, 200);
assert(Array.isArray(licences.value) && licences.value.length >= 700, `expected imported licences, got ${licences.value?.length}`);
const ed50 = licences.value.find((area) => area.source_crs === 'EPSG:4230');
assert(ed50, 'expected at least one ED50-sourced licence');
assert(ed50.display_footprint, 'expected a WGS 84 display footprint for the ED50 licence');
assert(ed50.footprint, 'expected the preserved source footprint');
const [sx, sy] = ed50.footprint.coordinates[0][0];
const [dx, dy] = ed50.display_footprint.coordinates[0][0];
assert(Math.abs(dx - sx) > 0.0001 || Math.abs(dy - sy) > 0.0001, 'expected the display geometry to be transformed, not copied');

const mapAll = await request('/map/land-areas', 'reader');
assert.equal(mapAll.status, 200);
assert(mapAll.value.features.length >= 700, `expected map features, got ${mapAll.value.features.length}`);
assert(mapAll.value.features.every((feature) => feature.geometry && feature.geometry.type === 'Polygon'));
assert(mapAll.value.features.every((feature) => feature.properties.land_area_id));

const dashboard = await request('/dashboard', 'reader');
assert.equal(dashboard.value.counts.concession_maps.state, 'available');
assert(dashboard.value.counts.concession_maps.value >= 300, 'catalog count should report distinct licences');

// Restricted record: visible to the importer, invisible to readers everywhere.
const suffix = randomUUID().slice(0, 8);
const restricted = await request('/land-areas', 'importer', 'POST', {
  kind: 'concession',
  code: `SYNTHETIC-RESTRICTED-${suffix}`,
  name: `SYNTHETIC RESTRICTED CONCESSION ${suffix}`,
  source: 'SYNTHETIC TEST USE',
  source_crs: 'EPSG:4326',
  footprint: { type: 'Polygon', coordinates: [[[2.0, 55.0], [2.1, 55.0], [2.1, 55.1], [2.0, 55.1], [2.0, 55.0]]] },
  license: 'SYNTHETIC TEST USE',
  confidentiality: 'restricted',
});
assert.equal(restricted.status, 200, JSON.stringify(restricted.value));
assert.equal(restricted.value.status, 'published');
const restrictedId = restricted.value.id;

const importerList = await request(`/land-areas?code=SYNTHETIC-RESTRICTED-${suffix}`, 'importer');
assert.equal(importerList.value.length, 1);
const readerList = await request(`/land-areas?code=SYNTHETIC-RESTRICTED-${suffix}`, 'reader');
assert.equal(readerList.value.length, 0, 'readers must not list restricted land areas');
assert.equal((await request(`/land-areas/${restrictedId}`, 'reader')).status, 403);
const mapReader = await request('/map/land-areas', 'reader');
assert(!mapReader.value.features.some((feature) => feature.properties.land_area_id === restrictedId));
const mapImporter = await request('/map/land-areas', 'importer');
assert(mapImporter.value.features.some((feature) => feature.properties.land_area_id === restrictedId));

// Duplicate posts are idempotent, not errors.
const again = await request('/land-areas', 'importer', 'POST', {
  kind: 'concession',
  code: `SYNTHETIC-RESTRICTED-${suffix}`,
  source: 'SYNTHETIC TEST USE',
  source_crs: 'EPSG:4326',
  footprint: { type: 'Polygon', coordinates: [[[2.0, 55.0], [2.1, 55.0], [2.1, 55.1], [2.0, 55.1], [2.0, 55.0]]] },
  license: 'SYNTHETIC TEST USE',
});
assert.equal(again.status, 200);
assert.equal(again.value.status, 'duplicate');

// Invalid input is rejected before it can be stored.
const badKind = await request('/land-areas', 'importer', 'POST', {
  kind: 'nonsense',
  code: `SYNTHETIC-BAD-${suffix}`,
  source: 'SYNTHETIC TEST USE',
  source_crs: 'EPSG:4326',
  footprint: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  license: 'SYNTHETIC TEST USE',
});
assert.equal(badKind.status, 422);
const readerPost = await request('/land-areas', 'reader', 'POST', {
  kind: 'concession',
  code: `SYNTHETIC-READER-${suffix}`,
  source: 'SYNTHETIC TEST USE',
  source_crs: 'EPSG:4326',
  footprint: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  license: 'SYNTHETIC TEST USE',
});
assert.equal(readerPost.status, 403);

// Published rows are protected by the database trigger.
const deleteAttempt = psql(`DELETE FROM land_areas WHERE id='${restrictedId}';`);
assert(deleteAttempt.status !== 0 && /immutable/i.test(`${deleteAttempt.stderr}${deleteAttempt.stdout}`), 'expected the immutability trigger to block deletion');

// Remove the synthetic verification record through the operator path.
const purge = psql(`BEGIN;
DROP TRIGGER published_land_areas_immutable ON land_areas;
DELETE FROM land_areas WHERE id='${restrictedId}';
CREATE TRIGGER published_land_areas_immutable BEFORE UPDATE OR DELETE ON land_areas FOR EACH ROW EXECUTE FUNCTION forbid_published_land_area_change();
COMMIT;`);
assert.equal(purge.status, 0, `cleanup failed: ${purge.stderr}`);
const leftover = await request(`/land-areas/${restrictedId}`, 'importer');
assert.equal(leftover.status, 404);

console.log('Land areas: NSTA licences cataloged with ED50 source + WGS 84 display, map features served, restricted records hidden from readers, duplicates idempotent, invalid input rejected, immutability enforced, verification record removed.');

function psql(sql) {
  const container = process.env.ATLASIO_DB_CONTAINER || 'atlasio-db-1';
  const args = ['docker', 'exec', '-i', container, 'psql', '-U', 'atlasio', '-d', 'atlasio', '-v', 'ON_ERROR_STOP=1'];
  const command = process.platform === 'win32'
    ? ['wsl', ['-d', process.env.ATLASIO_WSL_DISTRO || 'ubuntu24', ...args]]
    : [args[0], args.slice(1)];
  return spawnSync(command[0], command[1], { input: sql, encoding: 'utf8' });
}
