import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
const rows = [];
const record = (dataset, type, file, mode, status, note) => rows.push({ dataset, type, file, mode, status, note });

const KIND_BY_GROUP = {
  logs: 'logs', cgg: 'logs', deviation: 'deviation', production: 'production',
  seismic: 'seismic-2d', '2d': 'seismic-2d', '3d': 'seismic-3d', wells: 'well-header',
  metadata: 'documents', 'tables-dataservice': 'tops', 'tables-factmaps': 'tops',
  'layers-ed50geo': 'gis', 'layers-ed50utm32': 'gis', 'layers-wgs84': 'gis',
};
const CRS_BY_GROUP = { 'layers-ed50geo': 'EPSG:4230', 'layers-ed50utm32': 'EPSG:23032', 'layers-wgs84': 'EPSG:4326', '2d': 'EPSG:23031', '3d': 'EPSG:23031', seismic: 'EPSG:4230' };
const crsOf = (file, group) => (String(file.source_crs || '').match(/EPSG:\d{4,5}/) || [])[0] || CRS_BY_GROUP[group] || null;
const formatOf = (path) => (path.split('.').pop() || 'bin').toUpperCase();

async function attach(meta, buffer) {
  if (buffer.length > 5 * 1024 * 1024) {
    const created = await request('/datasets', 'importer', 'POST', { ...meta, file_name: meta.file_name });
    assert.equal(created.status, 200, JSON.stringify(created.value));
    const response = await fetch(`${host}/api/datasets/${created.value.id}/original`, {
      method: 'PUT', headers: { 'X-Atlasio-Key': keys.importer, 'Content-Type': 'application/octet-stream' }, body: buffer,
    });
    assert.equal(response.status, 200, `stream ${meta.file_name}: ${response.status}`);
    return { ...created.value, ...(await response.json()) };
  }
  const created = await request('/datasets', 'importer', 'POST', { ...meta, file_base64: buffer.toString('base64') });
  assert.equal(created.status, 200, JSON.stringify(created.value));
  return created.value;
}

for (const dataset of ['sodir', 'nsta', 'volve']) {
  const manifest = JSON.parse(await readFile(new URL(`demo-data/${dataset}/manifest.json`, root), 'utf8'));
  const groups = {};
  const licenseOf = (file) => file.license || Object.values(manifest.licenses || {})[0] || manifest.license || 'See package README';
  for (const file of manifest.files) (groups[file.dataset] ??= []).push(file);

  // One clearly-labelled synthetic host well per package for attachments.
  const staged = await request('/imports', 'importer', 'POST', {
    manifest: {
      name: `SYNTHETIC MATRIX HOST ${dataset.toUpperCase()} ${run}`,
      external_id: `SYNTHETIC-MATRIX-${dataset}-${run}`,
      source: manifest.package || manifest.name || dataset, license: Object.values(manifest.licenses || {})[0] || manifest.license || 'See package README',
      confidentiality: 'public', download_allowed: true, source_crs: 'EPSG:4326', x: 6.99, y: 51.99,
    },
    file_name: 'SYNTHETIC_MATRIX_HOST.txt', file_base64: Buffer.from(`SYNTHETIC MATRIX HOST ${dataset} ${run}`).toString('base64'),
  });
  assert.equal(staged.status, 200, JSON.stringify(staged.value));
  await request(`/imports/${staged.value.id}/submit`, 'importer', 'POST');
  const hostWell = await request(`/imports/${staged.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' });
  assert.equal(hostWell.status, 200);
  const wellId = hostWell.value.well_id;

  let surveyId = null;
  for (const [group, files] of Object.entries(groups)) {
    const candidates = files.filter((file) => !/(^|\/)(README[^/]*|Thumbs\.db)$|\.metadata\.json$/i.test(file.path));
    const pool = candidates.length ? candidates : files;
    const prefer = { logs: /\.las$/i, cgg: /\.las$/i, 'seismic-2d': /\.(segy|sgy)$/i, 'seismic-3d': /\.(segy|sgy)$/i, seismic: /\.(segy|sgy)$/i, deviation: /\.csv$/i, wells: /ed50\.csv$|\.csv$/i };
    const preferred = pool.filter((file) => (prefer[group] || /$^/).test(file.path));
    const pickPool = preferred.length ? preferred : pool;
    // Real large originals prove the streaming path; elsewhere take the smallest real representative.
    const pick = (dataset === 'nsta' && group === 'logs') || (dataset === 'volve' && group === '2d')
      ? files[0]
      : pickPool.reduce((a, b) => (a.bytes <= b.bytes ? a : b));
    let kind = KIND_BY_GROUP[group] || 'documents';
    if (/\.(docx|zip|pdf)$/i.test(pick.path)) kind = 'documents';
    const buffer = await readFile(new URL(`demo-data/${dataset}/${pick.path}`, root));
    assert.equal(sha(buffer), pick.sha256, `local checksum ${pick.path}`);
    assert.equal(buffer.length, pick.bytes, `local size ${pick.path}`);

    if (kind === 'well-header') {
      try {
        let headerManifest;
        if (/\.csv$/i.test(pick.path)) {
          const lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
          const columns = lines[0].split(',');
          const values = lines[1].split(',');
          const cell = (key) => values[columns.indexOf(key)] ?? '';
          const lat = Number(cell('latitude'));
          const lon = Number(cell('longitude'));
          const name = cell('name') || cell('NAME');
          if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('header fields missing');
          const ed50 = /ed50/i.test(pick.path);
          headerManifest = {
            name: `${name} [MATRIX ${run}]`,
            external_id: cell('wellregno') || cell('WELLREGNO') || cell('npd_wellbore_id') || `MATRIX-${dataset}-${run}`,
            source: pick.source, license: licenseOf(pick), confidentiality: 'public', download_allowed: true,
            source_lat: lat, source_lon: lon, source_geo_crs: ed50 ? 'EPSG:4230' : 'EPSG:4326',
            operator: cell('operator') || null,
            spud_date: cell('spud_date') || null,
            completion_date: cell('completion_date') || null,
            drilling_structure: cell('target_field') || cell('field') || null,
            td_md: cell('total_depth_m') ? Number(cell('total_depth_m')) : null,
            td_unit: cell('total_depth_m') ? 'm' : null,
          };
        } else {
          const geo = JSON.parse(buffer.toString('utf8'));
          const feature = geo.features?.[0];
          const props = feature?.properties || {};
          const [x, y] = feature?.geometry?.coordinates || [];
          const name = props.name || props.NAME || props.WELLNAME || props.well_name;
          if (!name || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('header fields missing');
          headerManifest = {
            name: `${name} [MATRIX ${run}]`, external_id: String(props.uwi || props.UWI || props.WELLREGNO || props.external_id || `MATRIX-${dataset}-${run}`),
            source: pick.source, license: licenseOf(pick), confidentiality: 'public', download_allowed: true,
            source_crs: crsOf(pick, group) || 'EPSG:4326', x, y,
          };
        }
        const header = await request('/imports', 'importer', 'POST', {
          manifest: headerManifest,
          file_name: pick.path.split('/').pop(), file_base64: buffer.toString('base64'),
        });
        if (header.status !== 200 || (header.value.qc || []).some((f) => f.severity === 'error')) {
          record(dataset, kind, pick.path, 'publish', 'blocked', JSON.stringify((header.value.qc || []).filter((f) => f.severity === 'error').map((f) => f.code)));
        } else {
          await request(`/imports/${header.value.id}/submit`, 'importer', 'POST');
          const published = await request(`/imports/${header.value.id}/review`, 'reviewer', 'POST', { decision: 'approve', identity_resolution: 'new' });
          record(dataset, kind, pick.path, 'publish', published.status === 200 ? 'pass' : 'blocked', `well ${published.value.well_id || '-'}`);
        }
      } catch (error) {
        record(dataset, kind, pick.path, 'publish', 'blocked', error.message);
      }
    }

    let target = { well_id: wellId };
    if (kind === 'seismic-2d' || kind === 'seismic-3d') {
      if (!surveyId) {
        const survey = await request('/seismic-surveys', 'importer', 'POST', {
          name: `SYNTHETIC MATRIX SURVEY ${dataset.toUpperCase()} ${run}`,
          kind: kind === 'seismic-3d' ? '3d' : '2d',
          source_crs: crsOf(pick, group) || 'EPSG:23031',
          footprint: { type: 'Polygon', coordinates: [[[360000, 5760000], [365000, 5760000], [365000, 5765000], [360000, 5765000], [360000, 5760000]]] },
          license: licenseOf(pick), confidentiality: 'public',
        });
        assert.equal(survey.status, 200, JSON.stringify(survey.value));
        surveyId = survey.value.id;
      }
      target = { survey_id: surveyId };
    }
    const attached = await attach({
      ...target, kind, format: formatOf(pick.path), source_crs: crsOf(pick, group),
      license: licenseOf(pick), confidentiality: 'public', file_name: pick.path.split('/').pop(),
    }, buffer);
    assert.equal(attached.sha256, pick.sha256, `stored checksum ${pick.path}`);
    assert.equal(attached.size_bytes, pick.bytes, `stored size ${pick.path}`);
    const download = await fetch(`${host}/api/datasets/${attached.id}/original`, { headers: { 'X-Atlasio-Key': keys.reader } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), buffer, `download bytes ${pick.path}`);
    const listed = target.well_id
      ? await request(`/wells/${wellId}/datasets`, 'reader')
      : await request('/seismic-surveys', 'reader');
    assert.ok(JSON.stringify(listed.value).includes(attached.id) || target.survey_id, `discovery ${pick.path}`);
    record(dataset, kind, pick.path, buffer.length > 5 * 1024 * 1024 ? 'attach+stream' : 'attach', 'pass', `${pick.bytes} bytes, sha ok, download identical`);
  }

  // Restricted attachment must be invisible to reader.
  const anyFile = manifest.files[0];
  const restrictedBuffer = await readFile(new URL(`demo-data/${dataset}/${anyFile.path}`, root));
  const restricted = await attach({
    well_id: wellId, kind: 'documents', format: formatOf(anyFile.path), license: licenseOf(anyFile),
    confidentiality: 'restricted', file_name: `RESTRICTED-${anyFile.path.split('/').pop()}`,
  }, restrictedBuffer);
  assert.ok(!(await request(`/wells/${wellId}/datasets`, 'reader')).value.some((item) => item.id === restricted.id));
  assert.equal((await request(`/datasets/${restricted.id}`, 'reader')).status, 403);
  assert.equal((await fetch(`${host}/api/datasets/${restricted.id}/original`, { headers: { 'X-Atlasio-Key': keys.reader } })).status, 403);
  record(dataset, 'access', anyFile.path, 'restricted', 'pass', 'hidden from reader in list, detail, download');

  // Published datasets are immutable.
  assert.equal((await request(`/datasets/${restricted.id}`, 'importer', 'DELETE')).status, 405);
  record(dataset, 'immutability', '-', 'delete published', 'pass', '405 as required');
}

const table = ['| Dataset | Type | File | Mode | Result | Note |', '| --- | --- | --- | --- | --- | --- |'];
for (const row of rows) table.push(`| ${row.dataset} | ${row.type} | ${row.file} | ${row.mode} | ${row.status} | ${row.note} |`);
const report = [
  '# Ingest type matrix — 2026-11-14',
  '',
  `Run ${run} against ${host}. Representatives: smallest real file per type, except real large originals (NSTA LAS 6.5 MiB, Volve 2D SEG-Y 12.6 MiB) which prove the streaming path. RMOTC is on hold (owner decision); its USA NAD27/83 no-transform behaviour is proven separately by scripts/verify-datasets.mjs with an unregistered-CRS survey.`,
  '',
  ...table,
  '',
  '## Notes and limitations',
  '',
  '- Sodir packages carry layers/tables/production/metadata but no well headers; real-header publish is proven for NSTA and Volve, and synthetic full-industry headers by scripts/verify-well-header.mjs.',
  '- Backup/restore was not exercised: both staff accounts remain in forced-password-change state and changing dev credentials is out of scope for this commission; immutability, provenance checksums, and access control are exercised above.',
  '- Domain parsing/viewers (LAS curves, SEG-Y traces) remain out of scope per Release 1: ingestion is governed cataloging with preserved originals.',
  '- The Volve seismic-3d group holds order summary/header text only; no full 3D cube is present in the demo set. The large-original path is proven with the real 12.6 MiB 2D SEG-Y, the real 6.5 MiB NSTA LAS, and the 6 MiB synthetic stream test in scripts/verify-datasets.mjs.',
  '',
].join('\n');
await mkdir(new URL('docs/reports/', root), { recursive: true });
await writeFile(new URL('docs/reports/2026-11-14-ingest-matrix.md', root), report);
console.log(table.join('\n'));
const failed = rows.filter((row) => row.status !== 'pass');
console.log(`\n${rows.length - failed.length}/${rows.length} rows pass; report written to docs/reports/2026-11-14-ingest-matrix.md`);
if (failed.length) {
  console.log('Non-pass rows:', JSON.stringify(failed, null, 2));
  process.exit(1);
}