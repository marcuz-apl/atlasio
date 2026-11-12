import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = path.join(root, 'demo-data', 'volve');
const manifestPath = path.join(outputRoot, 'manifest.json');

const OSDU = 'https://s3.amazonaws.com/osdu-seismic-test-data/';
const SODIR_WELLS = 'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer/201/query';
const SODIR_PRODUCTION =
  'https://factpages.sodir.no/public?/Factpages/external/tableview/field_production_monthly&rs:Command=Render&rc:Toolbar=false&rc:Parameters=f&IpAddress=not_used&CultureCode=en&rs:Format=CSV&Top100=false';

const DATASETS = ['wells', 'logs', 'deviation', 'production', '2d', '3d'];
const TIME_3D_RENAME = 'ST0202R08_PS_PSDM_RAW_PP_TIME.MIG_RAW.POST_Stack.3D.JS-017534.segy';
const DEPTH_3D_RENAME = 'ST0202R08-PS_PSDM_FULL_OFFSET_DEPTH.MIG_FIN.POST_Stack.3D.JS-017534.segy';

const LICENSES = {
  volve: 'Equinor Open Data Licence — https://www.equinor.com/energy/volve-data-sharing',
  osdu: 'OSDU open test data (underlying Volve data: Equinor Open Data Licence)',
  sodir: 'NLOD 2.0 — https://data.norge.no/nlod/en/2.0',
};

const flags = new Set(process.argv.slice(2));
const force = flags.has('--force');
const dryRun = flags.has('--dry-run');
const withDepth = flags.has('--with-depth');
const all2d = flags.has('--all-2d');
const requested = readFlag('--dataset');
const selected = new Set(
  requested
    ? requested.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
    : ['all'],
);
if (selected.has('all')) DATASETS.forEach((name) => selected.add(name));
for (const name of selected) {
  if (name !== 'all' && !DATASETS.includes(name)) {
    throw new Error(`Unknown dataset '${name}'. Choose one of: all, ${DATASETS.join(', ')}`);
  }
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function objectUrl(key) {
  return `${OSDU}${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json, application/xml, text/plain' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function localEntry(relativePath, meta = {}) {
  const file = path.join(outputRoot, relativePath);
  const info = await stat(file);
  return {
    path: relativePath,
    bytes: info.size,
    sha256: await sha256File(file),
    retrieved_at: new Date().toISOString(),
    ...meta,
  };
}

async function downloadFile(url, relativePath, meta = {}) {
  const target = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });

  if (!force) {
    try {
      const existing = await stat(target);
      if (existing.size > 0 && (!meta.bytes || existing.size === meta.bytes)) {
        console.log(`skip    ${relativePath} (${formatBytes(existing.size)})`);
        return localEntry(relativePath, { url, ...meta });
      }
    } catch {
      // Missing file, download it below.
    }
  }

  if (dryRun) {
    console.log(`would fetch ${relativePath} (${meta.bytes ? formatBytes(meta.bytes) : 'size unknown'})`);
    return null;
  }

  const part = `${target}.part`;
  let offset = 0;
  try {
    offset = (await stat(part)).size;
  } catch {
    offset = 0;
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {};
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      const append = offset > 0 && response.status === 206;
      if (!append && offset > 0) offset = 0;

      const length = Number(response.headers.get('content-length') || 0);
      const expected = meta.bytes ?? (length ? length + offset : null);
      let received = offset;
      let lastReport = Date.now();
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          received += chunk.length;
          if (Date.now() - lastReport > 3000) {
            lastReport = Date.now();
            const percent = expected ? ` ${((received / expected) * 100).toFixed(1)}%` : '';
            process.stdout.write(`\r  ${relativePath}: ${formatBytes(received)}${percent}`);
          }
          callback(null, chunk);
        },
      });

      await pipeline(
        Readable.fromWeb(response.body),
        counter,
        createWriteStream(part, { flags: append ? 'a' : 'w' }),
      );
      if (expected) process.stdout.write('\r');
      const info = await stat(part);
      if (expected && info.size !== expected) {
        throw new Error(`size mismatch for ${relativePath}: expected ${expected}, got ${info.size}`);
      }
      await rename(part, target);
      console.log(`saved   ${relativePath} (${formatBytes(info.size)})`);
      return localEntry(relativePath, { url, ...meta });
    } catch (error) {
      lastError = error;
      try {
        offset = (await stat(part)).size;
      } catch {
        offset = 0;
      }
      if (attempt < 3) {
        console.warn(`retry   ${relativePath}: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }
  throw lastError;
}

async function listS3(prefix) {
  let continuation;
  const items = [];
  do {
    const query = new URLSearchParams({ 'list-type': '2', prefix });
    if (continuation) query.set('continuation-token', continuation);
    const xml = await fetchText(`${OSDU}?${query}`);
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1];
      const key = decodeXml(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] || '');
      const size = Number(block.match(/<Size>([\s\S]*?)<\/Size>/)?.[1] || 0);
      if (key && !key.endsWith('/')) items.push({ key, size });
    }
    continuation = decodeXml(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || '');
  } while (continuation);
  return items;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function downloadWells() {
  console.log('Fetching Volve well headers from Sodir…');
  const query = new URLSearchParams({
    where: "UPPER(wlbField) LIKE '%VOLVE%'",
    outFields: '*',
    returnGeometry: 'true',
    resultRecordCount: '500',
    f: 'geojson',
  });
  const response = await fetch(`${SODIR_WELLS}?${query}`, {
    headers: { Accept: 'application/geo+json, application/json' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for Sodir wells`);
  const geojson = await response.json();
  if (!Array.isArray(geojson.features) || !geojson.features.length) {
    throw new Error('Sodir returned no Volve wellbores');
  }
  if (dryRun) {
    console.log(`would write wells/volve-wellbores.geojson (${geojson.features.length} wells)`);
    return [];
  }

  const directory = path.join(outputRoot, 'wells');
  await mkdir(directory, { recursive: true });
  const geojsonPath = 'wells/volve-wellbores.geojson';
  await writeFile(path.join(outputRoot, geojsonPath), JSON.stringify(geojson, null, 2));

  const columns = [
    'name',
    'npd_wellbore_id',
    'field',
    'purpose',
    'status',
    'longitude',
    'latitude',
    'total_depth_m',
    'water_depth_m',
    'max_inclination_deg',
    'fact_page_url',
  ];
  const rows = geojson.features.map((feature) => {
    const values = feature.properties || {};
    return [
      values.wlbWellboreName,
      values.wlbNpdidWellbore,
      values.wlbField,
      values.wlbPurpose,
      values.wlbStatus,
      feature.geometry?.coordinates?.[0],
      feature.geometry?.coordinates?.[1],
      values.wlbTotalDepth,
      values.wlbWaterDepth,
      values.wlbMaxInclation,
      values.wlbFactPageUrl,
    ];
  });
  const csv = [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
  const csvPath = 'wells/volve-wellbores.csv';
  await writeFile(path.join(outputRoot, csvPath), csv);
  console.log(`saved   ${geojsonPath} (${geojson.features.length} wellbores)`);
  console.log(`saved   ${csvPath} (${geojson.features.length} rows)`);

  return [
    await localEntry(geojsonPath, {
      dataset: 'wells',
      source: 'Sodir FactMaps WGS84 wellbores (layer 201)',
      url: 'https://factpages.sodir.no/en/wellbore',
      license: LICENSES.sodir,
      source_crs: 'EPSG:4326',
    }),
    await localEntry(csvPath, {
      dataset: 'wells',
      source: 'Derived from Sodir FactMaps WGS84 wellbores (layer 201)',
      url: 'https://factpages.sodir.no/en/wellbore',
      license: LICENSES.sodir,
      source_crs: 'EPSG:4326',
    }),
  ];
}

async function downloadLogs() {
  console.log('Listing Volve LAS logs…');
  const items = await listS3('volve/welllogs/');
  const entries = [];
  for (const item of items) {
    const name = path.basename(item.key);
    const entry = await downloadFile(objectUrl(item.key), `logs/${name}`, {
      dataset: 'logs',
      bytes: item.size,
      source: 'OSDU Volve open test data — well logs',
      url: objectUrl(item.key),
      license: LICENSES.osdu,
      source_crs: 'Not applicable (LAS depth curves)',
    });
    if (entry) entries.push(entry);
  }
  return entries;
}

async function downloadDeviation() {
  console.log('Listing Volve deviation surveys…');
  const items = await listS3('volve/trajectories/');
  const entries = [];
  for (const item of items) {
    const name = path.basename(item.key);
    const entry = await downloadFile(objectUrl(item.key), `deviation/${name}`, {
      dataset: 'deviation',
      bytes: item.size,
      source: 'OSDU Volve open test data — well trajectories',
      url: objectUrl(item.key),
      license: LICENSES.osdu,
      source_crs: 'EPSG:4230 (ED50 geographic), MD/TVD in metres',
    });
    if (entry) entries.push(entry);
  }
  return entries;
}

async function downloadProduction() {
  console.log('Fetching Sodir monthly field production…');
  const fullPath = 'production/sodir-field-production-monthly.csv';
  const full = await downloadFile(SODIR_PRODUCTION, fullPath, {
    dataset: 'production',
    source: 'Sodir FactPages — monthly field production (saleable)',
    url: SODIR_PRODUCTION,
    license: LICENSES.sodir,
    source_crs: 'Not applicable (field-level volumes)',
  });
  if (dryRun) return full ? [full] : [];

  const text = (await readFile(path.join(outputRoot, fullPath), 'utf8')).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const header = lines.shift() || '';
  const rows = lines.filter((line) => line.toUpperCase().startsWith('VOLVE,'));
  if (!header || rows.length === 0) throw new Error('No Volve rows found in the Sodir production CSV');
  const filteredPath = 'production/volve-field-production-monthly.csv';
  await writeFile(path.join(outputRoot, filteredPath), [header, ...rows].join('\n') + '\n');
  console.log(`saved   ${filteredPath} (${rows.length} monthly rows)`);

  return [
    full,
    await localEntry(filteredPath, {
      dataset: 'production',
      source: 'Sodir FactPages — Volve monthly field production (filtered)',
      url: SODIR_PRODUCTION,
      license: LICENSES.sodir,
      source_crs: 'Not applicable (field-level volumes)',
    }),
  ];
}

async function download2d() {
  console.log('Listing Volve 2D seismic…');
  const items = await listS3('volve/seismic/st0299/');
  const byKey = new Map(items.map((item) => [item.key, item]));
  const lines = items
    .filter((item) => /\/ST0299-\d+\+MIG_FIN\.segy$/.test(item.key))
    .sort((a, b) => a.key.localeCompare(b.key));
  const chosenLines = all2d ? lines : lines.slice(0, 5);
  const chosen = ['Readme.txt', 'SeismicOrderSummary.txt', 'ST0299-CMP.p190'].map((name) => `volve/seismic/st0299/${name}`);
  for (const item of chosenLines) chosen.push(item.key);
  for (const item of chosenLines) {
    const match = item.key.match(/\/ST0299-(\d+)\+MIG_FIN\.segy$/);
    if (match) chosen.push(`volve/seismic/st0299/navigation_2D/ST0299-CMP-${match[1]}.p190`);
  }

  const entries = [];
  for (const key of [...new Set(chosen)]) {
    const item = byKey.get(key);
    if (!item) continue;
    const name = path.basename(key);
    const relativePath = key.includes('/navigation_2D/')
      ? `seismic-2d/navigation/${name}`
      : key.endsWith('.segy')
        ? `seismic-2d/lines/${name}`
        : `seismic-2d/${name}`;
    const entry = await downloadFile(objectUrl(key), relativePath, {
      dataset: '2d',
      bytes: item.size,
      source: 'OSDU Volve open test data — 2D site survey ST0299',
      url: objectUrl(key),
      license: LICENSES.osdu,
      source_crs: 'EPSG:23031 (ED50 / UTM zone 31N)',
    });
    if (entry) entries.push(entry);
  }
  console.log(`2D lines: ${chosenLines.length}${all2d ? ' (all)' : ' of ' + lines.length}; use --all-2d for the full set.`);
  return entries;
}

async function download3d() {
  console.log('Downloading Volve 3D post-stack time cube…');
  const entries = [];
  const headerKey = 'volve/seismic/st0202/stacks/SeismicOrderSummary+Header.txt';
  const timeKey = `volve/seismic/st0202/stacks/${TIME_3D_RENAME}`;
  const keys = [headerKey, timeKey];
  if (withDepth) keys.push(`volve/seismic/st0202/stacks/${DEPTH_3D_RENAME}`);

  const sizes = new Map((await listS3('volve/seismic/st0202/stacks/')).map((item) => [item.key, item.size]));
  for (const key of keys) {
    const name = path.basename(key);
    const entry = await downloadFile(objectUrl(key), `seismic-3d/${name}`, {
      dataset: '3d',
      bytes: sizes.get(key),
      source: 'OSDU Volve open test data — ST0202 3D post-stack',
      url: objectUrl(key),
      license: LICENSES.osdu,
      source_crs: 'EPSG:23031 (ED50 / UTM zone 31N); time cube in milliseconds',
    });
    if (entry) entries.push(entry);
  }
  if (withDepth) console.log('Depth cube included (--with-depth).');
  return entries;
}

function summarize(files) {
  const labels = {
    wells: 'Well headers',
    logs: 'Logs',
    deviation: 'Deviation',
    production: 'Production',
    '2d': '2D seismic',
    '3d': '3D seismic',
  };
  const byDataset = new Map();
  for (const file of files) {
    const dataset = file.dataset || 'other';
    const current = byDataset.get(dataset) || { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += file.bytes || 0;
    byDataset.set(dataset, current);
  }
  return [...byDataset.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dataset, value]) => `| ${labels[dataset] || dataset} | ${value.files} | ${formatBytes(value.bytes)} |`)
    .join('\n');
}

async function writeReadme(files) {
  const content = `# Volve open subsurface demo package

Real public data from the Volve field (Norwegian North Sea, block 15/9), not synthetic fixtures.
The package is downloaded by \`scripts/fetch-demo-volve.mjs\` and is ignored by git.

| Data set | Files | Size |
| --- | ---: | ---: |
${summarize(files)}

## Layout

- \`wells/\` — Volve wellbore headers from Sodir, in EPSG:4326 (GeoJSON and CSV).
- \`logs/\` — LAS well logs from the OSDU Volve open test-data bucket.
- \`deviation/\` — well trajectory/deviation surveys (NPD CSV format, ED50 geographic). \`NPD-3145.csv\` is Volve well 15/9-19 A; \`NPD-8267.csv\` is 35/8-U-1 from the same OSDU release and is a second sample, not a Volve well.
- \`production/\` — Sodir monthly field production for VOLVE, plus the unfiltered source CSV.
- \`seismic-2d/\` — ST0299 2D site-survey SEG-Y lines, navigation, and acquisition readme.
- \`seismic-3d/\` — ST0202 3D post-stack time cube and its order/header summary.

## Sources and licences

- Volve subsurface files: Equinor Open Data Licence, via the OSDU open test-data bucket
  \`s3://osdu-seismic-test-data/volve/\` and the Equinor Volve data-sharing page.
- Volve well headers and production: Norwegian Offshore Directorate (Sodir) FactPages/FactMaps,
  NLOD 2.0.
- Volve data-sharing terms: https://www.equinor.com/energy/volve-data-sharing

## Coordinate and depth conventions

- Well headers are WGS 84 (EPSG:4326).
- The 2D and 3D SEG-Y files are in ED50 / UTM zone 31N (EPSG:23031), not WGS 84.
- Trajectories carry \`HorizontalCRS=EPSG_4230\` (ED50 geographic), MD/TVD in metres.
- Logs are measured-depth curves without a horizontal CRS.
- No coordinate transformation has been applied. Keep the source CRS with the files.

## Commands

\`\`\`sh
node scripts/fetch-demo-volve.mjs --dataset all
node scripts/fetch-demo-volve.mjs --dataset logs,deviation --force
node scripts/fetch-demo-volve.mjs --dataset 2d --all-2d
node scripts/fetch-demo-volve.mjs --dataset 3d --with-depth
\`\`\`

Downloads resume from \`.part\` files. Re-running without \`--force\` skips files whose size
already matches. \`manifest.json\` records the source URL, licence, byte count, and SHA-256
for every file.

## Current Atlasio limitation

The current ingest API accepts one well-header JSON and one original file up to 5 MiB, and only
EPSG:4326 positions. These raw logs, SEG-Y volumes, and production series are staged for the
log, deviation, production, and seismic features that are not implemented yet. They are not
loaded into the database by this script.
`;
  await writeFile(path.join(outputRoot, 'README.md'), content);
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  let previous = { files: [] };
  try {
    previous = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    previous = { files: [] };
  }

  const files = [];
  if (selected.has('wells')) files.push(...(await downloadWells()));
  if (selected.has('logs')) files.push(...(await downloadLogs()));
  if (selected.has('deviation')) files.push(...(await downloadDeviation()));
  if (selected.has('production')) files.push(...(await downloadProduction()));
  if (selected.has('2d')) files.push(...(await download2d()));
  if (selected.has('3d')) files.push(...(await download3d()));

  if (dryRun) {
    console.log('Dry run complete; no manifest written.');
    return;
  }

  const byPath = new Map((previous.files || []).map((file) => [file.path, file]));
  for (const file of files) byPath.set(file.path, file);
  const manifest = {
    package: 'Volve open subsurface demo',
    generated_at: new Date().toISOString(),
    sources: {
      volve: 'https://www.equinor.com/energy/volve-data-sharing',
      osdu: 'https://s3.amazonaws.com/osdu-seismic-test-data?list-type=2&prefix=volve/',
      sodir: 'https://factpages.sodir.no/en/wellbore',
      production: 'https://factpages.sodir.no/en/field/tableview/production/saleable/monthly',
    },
    licenses: LICENSES,
    files: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  await writeReadme(manifest.files);

  const total = manifest.files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  console.log(`\n${manifest.files.length} files, ${formatBytes(total)} under ${path.relative(root, outputRoot)}/`);
  console.log(`Manifest: ${path.relative(root, manifestPath)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
