// End-to-end verification of the ingest preconditioning wizard:
// upload a deliberately messy CSV, check the profile flags and suggested
// mapping, save the mapping without hand-tuned rules (the server derives
// them from the profile), confirm the cleaned manifests and the blocked
// row, download the error report, and stage the clean rows into the queue.
//
// Usage: node scripts/verify-ingest-wizard.mjs   (server on ATLASIO_URL)

import assert from 'node:assert/strict';

const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const key = process.env.ATLASIO_IMPORTER_KEY || 'importer-demo';

async function api(path, method = 'GET', body) {
  const response = await fetch(`${host}/api${path}`, {
    method,
    headers: {
      'X-Atlasio-Key': key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  return { status: response.status, value };
}

// Synthetic fixture, clearly not real data. One row per messy pattern:
//  row 0: DMS latitude/longitude, embedded unit with decimal comma, null-token datum
//  row 1: plain decimals, dot-decimal depth, slash date
//  row 2: missing identity and position — must be blocked
//  row 3: clean row
//  row 4: duplicate of row 3's UWI — warned for reviewer resolution
const CSV = [
  'Well Name,UWI,Latitude,Longitude,X,Y,Source CRS,TD (MD),Spud Date,Operator',
  'Alpha-1,SYN:0001,55°23\'12.5"N,3°12\'00.0"W,444390,5930200,EPSG:23032,"3,450 m","01/09/2021",Synthetic Energy',
  'Beta-2,SYN:0002,55.38,3.2,444390,5930200,EPSG:23032,3450,2021-09-15,Synthetic Energy',
  ',,,,"444.100,5",,,"3.000",15.03.2022,',
  'Delta-4,SYN:0004,55.1,3.0,444100,5930100,EPSG:23032,4200,2022-05-10,Delta Synthetic',
  'Delta-4,SYN:0004,55.1,3.0,444100,5930100,EPSG:23032,4200,2022-05-10,Delta Synthetic',
].join('\n');

const fileName = 'synthetic-messy-headers.csv';

// 1. Upload and profile
const upload = await api('/ingest/tables', 'POST', {
  name: 'Wizard verify — synthetic messy headers',
  file_name: fileName,
  file_base64: Buffer.from(CSV, 'utf8').toString('base64'),
  license: 'CC0-1.0 (synthetic fixture)',
  confidentiality: 'restricted',
});
assert.equal(upload.status, 200, `upload: ${JSON.stringify(upload.value)}`);
const tableId = upload.value.id;
const flagsByColumn = Object.fromEntries(
  upload.value.profile.columns.map((column) => [column.name, column.flags]),
);
assert.ok(
  flagsByColumn['Latitude'].includes('dms'),
  'Latitude column is flagged dms',
);
assert.ok(
  flagsByColumn['TD (MD)'].includes('units_embedded') || flagsByColumn['TD (MD)'].includes('decimal_comma'),
  'TD column is flagged for embedded units / decimal commas',
);
assert.ok(
  Object.keys(upload.value.suggested_mapping).includes('name'),
  'a suggested mapping is returned',
);
console.log(`uploaded table ${tableId} · ${upload.value.rows} rows profiled`);

// 2. Save the suggested mapping WITHOUT rules — the server must derive them
const mapping = upload.value.suggested_mapping;
const saved = await api(`/ingest/tables/${tableId}/mapping`, 'PUT', { mapping });
assert.equal(saved.status, 200, `save mapping: ${JSON.stringify(saved.value)}`);
assert.equal(saved.value.total_rows, 5, 'all five data rows were processed');
assert.equal(saved.value.blocked_rows, 1, 'only the identity-less row is blocked');
assert.equal(saved.value.status, 'staged_partial');

const outcomes = saved.value.outcomes;
const alpha = outcomes.find((o) => o.manifest.name === 'Alpha-1');
assert.ok(alpha, 'Alpha-1 row produced an outcome');
assert.equal(alpha.manifest.source_lat, 55.386806, 'DMS latitude cleaned to decimal degrees');
assert.ok(Math.abs(alpha.manifest.source_lon - -3.2) < 0.001, 'DMS west longitude cleaned to negative decimal');
assert.equal(alpha.manifest.td_md, 3450, 'embedded unit and decimal comma cleaned from TD');
assert.equal(alpha.manifest.spud_date, '2021-09-01', 'slash date normalized to ISO');
assert.ok(
  !alpha.blocked && alpha.findings.every((f) => f.severity !== 'error'),
  'the messy-but-fixable row is not blocked',
);

const blocked = outcomes.find((o) => o.blocked);
assert.ok(blocked, 'one row is blocked');
const blockedCodes = blocked.findings.filter((f) => f.severity === 'error').map((f) => f.code);
assert.ok(blockedCodes.includes('missing_crs') || blockedCodes.includes('invalid_coordinates'),
  `blocked row carries a positional error: ${blockedCodes.join(', ')}`);

const duplicateRow = outcomes.filter((o) => o.manifest.name === 'Delta-4')[1];
assert.ok(
  duplicateRow.findings.some((f) => f.code === 'duplicate_external_id'),
  'the repeated UWI is surfaced as a duplicate finding',
);

// 3. Download the error report
const report = await fetch(`${host}/api/ingest/tables/${tableId}/report`, {
  headers: { 'X-Atlasio-Key': key },
});
assert.equal(report.status, 200, 'the error report downloads');
const reportText = await report.text();
assert.ok(reportText.includes('row_index,error_code'), 'the report is a CSV with headers');
assert.ok(reportText.split('\n').length >= 3, 'the blocked row appears in the report');

// 4. Stage the clean rows
const staged = await api(`/ingest/tables/${tableId}/stage`, 'POST');
assert.equal(staged.status, 200, `stage: ${JSON.stringify(staged.value)}`);
assert.equal(staged.value.staged, 4, 'four clean rows became import batches');

// 5. The staged rows appear in the importer queue
const queue = await api('/imports');
assert.equal(queue.status, 200);
const stagedNames = queue.value
  .filter((item) => item.status === 'staged')
  .map((item) => item.manifest.name);
for (const expected of ['Alpha-1', 'Beta-2', 'Delta-4']) {
  assert.ok(stagedNames.includes(expected), `${expected} is in the import queue`);
}

console.log('ingest wizard verified: profile → auto-rules → clean → report → stage ✓');
