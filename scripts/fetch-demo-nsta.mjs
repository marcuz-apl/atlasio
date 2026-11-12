import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = path.join(root, 'demo-data', 'nsta');
const manifestPath = path.join(outputRoot, 'manifest.json');

const ARCGIS = 'https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services';
const WELLS_QUERY = `${ARCGIS}/UKCS_offshore_wellbore_top_holes_(WGS84)/FeatureServer/0/query`;
const PRODUCTION_QUERY = `${ARCGIS}/UKCS_hydrocarbon_field_production_reports_PPRS_points_(WGS84)/FeatureServer/0/query`;
const SEISMIC_2D_QUERY = `${ARCGIS}/UKCS_NDR_2D_SDS_seismic_lines_(ED50)/FeatureServer/0/query`;
const SEISMIC_3D_QUERY = `${ARCGIS}/UKCS_NDR_3D_SDS_seismic_outlines_(ED50)/FeatureServer/0/query`;
const CGG_ADDITIONAL = 'https://datanstauthority.blob.core.windows.net/external/DataReleases/CGG/CGG_Additional_JDWLs.zip';
const CGG_SIZE = 196503989;

const DATASETS = ['wells', 'production', 'logs', 'deviation', 'seismic'];
const LICENSES = {
  nsta: 'Open Government Licence v3.0 — https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
  nstaRelease: 'NSTA open data release (OGL v3.0 unless the release states otherwise)',
};

const flags = new Set(process.argv.slice(2));
const force = flags.has('--force');
const dryRun = flags.has('--dry-run');
const allSeismic = flags.has('--all-seismic');
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

function slug(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

async function fetchJson(url, params, format = 'json', attempts = 3) {
  const query = new URLSearchParams({ ...params, f: format });
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}?${query}`, {
        headers: { Accept: 'application/json, application/geo+json' },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      const value = await response.json();
      if (value.error) {
        throw new Error(`${value.error.message || 'ArcGIS error'} for ${url}`);
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function arcgisCount(url, where) {
  const value = await fetchJson(url, { where, returnCountOnly: 'true' });
  return Number(value.count || 0);
}

async function arcgisFeaturesAll(
  url,
  params,
  pageSize = 2000,
  limit = Number.POSITIVE_INFINITY,
  format = 'json',
) {
  const features = [];
  let offset = 0;
  while (features.length < limit) {
    const page = await fetchJson(
      url,
      {
        ...params,
        resultOffset: String(offset),
        resultRecordCount: String(Math.min(pageSize, limit - features.length)),
      },
      format,
    );
    const got = Array.isArray(page.features) ? page.features : [];
    features.push(...got);
    if (got.length < pageSize || offset + got.length >= limit) break;
    offset += got.length;
    if (offset > 500000) throw new Error(`ArcGIS pagination exceeded 500000 features for ${url}`);
  }
  return features;
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const WELL_FIELDS = [
  'WELLREGNO',
  'NAME',
  'DEVIATTYP',
  'ORIGINTENT',
  'WELLOPSTAT',
  'SPUDDATE',
  'COMPLEDATE',
  'SUBAREAOP',
  'TARGETFLD',
  'TDMDDEPM',
  'TDTVDSSM',
  'COUNTRYCOD',
];

const PRODUCTION_FIELDS = [
  'FIELDNAME',
  'PERIODYR',
  'PERIODMNTH',
  'PERIODYRMN',
  'OILPRODM3',
  'AGASPROKSM',
  'DGASPROKSM',
  'GCONDVOL',
  'GASINJCV',
  'GASFLARVOL',
  'GASVENTVOL',
];

const SEISMIC_2D_FIELDS = [
  'SURVEY_NAM',
  'LINE_NAME',
  'DATASET_ID',
  'FIRST_SHOT',
  'LAST_SP',
  'CURR_OWNER',
  'ORIG_OPER',
  'CONTRACTOR',
  'STARTDATE',
  'ENDDATE',
  'OPEN_DATA',
];

const SEISMIC_3D_FIELDS = [
  'SURVEY_NAM',
  'DATASET_ID',
  'PROCESSING',
  'DATASET_VE',
  'SURVEYTYPE',
  'SURVEY_ENV',
  'CURR_OWNER',
  'ORIG_OPER',
  'CONTRACTOR',
  'ACQ_START',
  'ACQ_END_DT',
  'OPEN_DATA',
];

async function downloadWells() {
  console.log('Fetching NSTA open wellbore headers…');
  const total = await arcgisCount(WELLS_QUERY, "OPEN_DATA='Y'");
  const features = await arcgisFeaturesAll(
    WELLS_QUERY,
    {
      where: "OPEN_DATA='Y'",
      outFields: WELL_FIELDS.join(','),
      returnGeometry: 'true',
      outSR: '4326',
    },
    2000,
    Number.POSITIVE_INFINITY,
    'geojson',
  );
  if (!features.length) throw new Error('NSTA returned no open wellbore headers');
  if (dryRun) {
    console.log(`would write wells/nsta-wellbores.geojson (${features.length} of ${total} wellbores)`);
    return [];
  }
  const directory = path.join(outputRoot, 'wells');
  await mkdir(directory, { recursive: true });
  const geojsonPath = 'wells/nsta-wellbores.geojson';
  await writeFile(
    path.join(outputRoot, geojsonPath),
    JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
  );

  const columns = [
    'wellregno',
    'name',
    'deviation_type',
    'intent',
    'status',
    'spud_date',
    'completion_date',
    'operator',
    'target_field',
    'total_depth_m',
    'tvd_ss_m',
    'country',
    'longitude',
    'latitude',
  ];
  const rows = features.map((feature) => {
    const values = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [];
    const asDate = (value) =>
      Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : '';
    return [
      values.WELLREGNO,
      values.NAME,
      values.DEVIATTYP,
      values.ORIGINTENT,
      values.WELLOPSTAT,
      asDate(values.SPUDDATE),
      asDate(values.COMPLEDATE),
      values.SUBAREAOP,
      values.TARGETFLD,
      values.TDMDDEPM,
      values.TDTVDSSM,
      values.COUNTRYCOD,
      lon,
      lat,
    ];
  });
  const csvPath = 'wells/nsta-wellbores.csv';
  await writeFile(
    path.join(outputRoot, csvPath),
    [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n',
  );
  const metadataPath = 'wells/nsta-wellbores.metadata.json';
  await writeFile(
    path.join(outputRoot, metadataPath),
    JSON.stringify(
      {
        source: 'NSTA UKCS offshore wellbore top holes (WGS84)',
        source_url: WELLS_QUERY,
        license: LICENSES.nsta,
        count: features.length,
        source_crs: 'EPSG:4326',
        retrieved_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`saved   ${geojsonPath} (${features.length} wellbores)`);
  console.log(`saved   ${csvPath} (${features.length} rows)`);
  return [
    await localEntry(geojsonPath, {
      dataset: 'wells',
      source: 'NSTA UKCS offshore wellbore top holes (WGS84)',
      url: WELLS_QUERY,
      license: LICENSES.nsta,
      source_crs: 'EPSG:4326',
    }),
    await localEntry(csvPath, {
      dataset: 'wells',
      source: 'Derived from NSTA UKCS offshore wellbore top holes (WGS84)',
      url: WELLS_QUERY,
      license: LICENSES.nsta,
      source_crs: 'EPSG:4326',
    }),
    await localEntry(metadataPath, {
      dataset: 'wells',
      source: 'NSTA wellbore index metadata',
      url: WELLS_QUERY,
      license: LICENSES.nsta,
      source_crs: 'EPSG:4326',
    }),
  ];
}

async function downloadProduction() {
  console.log('Fetching NSTA PPRS field-month production…');
  const total = await arcgisCount(PRODUCTION_QUERY, '1=1');
  if (dryRun) {
    console.log(`would write production/pprs-field-monthly.csv (${total} field-month rows)`);
    return [];
  }

  const directory = path.join(outputRoot, 'production');
  await mkdir(directory, { recursive: true });
  const csvPath = 'production/pprs-field-monthly.csv';
  await writeFile(path.join(outputRoot, csvPath), PRODUCTION_FIELDS.join(',') + '\n');

  let offset = 0;
  let written = 0;
  const pageSize = 2000;
  while (offset < total) {
    const page = await fetchJson(PRODUCTION_QUERY, {
      where: '1=1',
      outFields: PRODUCTION_FIELDS.join(','),
      returnGeometry: 'false',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    const features = Array.isArray(page.features) ? page.features : [];
    if (!features.length) break;
    const rows = features.map((feature) => {
      const values = feature.attributes || {};
      return PRODUCTION_FIELDS.map((field) => csvCell(values[field])).join(',');
    });
    await appendFile(path.join(outputRoot, csvPath), rows.join('\n') + '\n');
    written += features.length;
    offset += features.length;
    if (features.length < pageSize) break;
    process.stdout.write(`\r  production: ${written} / ${total}`);
  }
  process.stdout.write('\r');
  if (!written) throw new Error('NSTA returned no PPRS production rows');
  console.log(`saved   ${csvPath} (${written} rows)`);

  const metadataPath = 'production/pprs-field-monthly.metadata.json';
  await writeFile(
    path.join(outputRoot, metadataPath),
    JSON.stringify(
      {
        source: 'NSTA PPRS field production points (WGS84)',
        source_url: PRODUCTION_QUERY,
        license: LICENSES.nsta,
        count: written,
        fields: PRODUCTION_FIELDS,
        source_crs: 'EPSG:4326',
        note: 'Geometry is the field centre point in the source feature service; the CSV omits geometry.',
        retrieved_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  return [
    await localEntry(csvPath, {
      dataset: 'production',
      source: 'NSTA PPRS field production points (WGS84)',
      url: PRODUCTION_QUERY,
      license: LICENSES.nsta,
      source_crs: 'EPSG:4326',
    }),
    await localEntry(metadataPath, {
      dataset: 'production',
      source: 'NSTA PPRS production metadata',
      url: PRODUCTION_QUERY,
      license: LICENSES.nsta,
      source_crs: 'EPSG:4326',
    }),
  ];
}

async function downloadCgg() {
  if (!selected.has('logs') && !selected.has('deviation')) return [];
  console.log('Fetching CGG Additional JDWLs archive…');
  const zipPath = 'cgg/CGG_Additional_JDWLs.zip';
  const zipEntry = await downloadFile(CGG_ADDITIONAL, zipPath, {
    dataset: 'cgg',
    bytes: CGG_SIZE,
    source: 'NSTA CGG Additional JDWLs release',
    url: CGG_ADDITIONAL,
    license: LICENSES.nstaRelease,
    source_crs: 'Not applicable (LAS curves and deviation tables)',
  });
  if (dryRun) {
    console.log('would extract LAS and deviation files from the CGG archive');
    return zipEntry ? [zipEntry] : [];
  }

  const archive = path.join(outputRoot, zipPath);
  const extractDir = path.join(outputRoot, 'cgg', 'extracted');
  await rm(extractDir, { recursive: true, force: true });
  try {
    execFileSync('unzip', ['-o', archive, '-d', extractDir], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch (error) {
    throw new Error(`Cannot unpack the CGG archive with unzip: ${error.message}`);
  }

  const entries = [];
  const used = new Set();
  for (const file of await walk(extractDir)) {
    const relative = path.relative(extractDir, file).replace(/\\/g, '/');
    const base = path.basename(file);
    if (base.startsWith('CGG_Narrative')) {
      const target = `cgg/${base}`;
      await mkdir(path.dirname(path.join(outputRoot, target)), { recursive: true });
      await copyFile(file, path.join(outputRoot, target));
      entries.push(
        await localEntry(target, {
          dataset: 'cgg',
          source: 'CGG release narrative',
          url: CGG_ADDITIONAL,
          license: LICENSES.nstaRelease,
          source_crs: 'Not applicable',
        }),
      );
      continue;
    }

    const parts = relative.split('/');
    let well = 'unknown';
    let dataset = null;
    if (selected.has('logs') && base.toLowerCase().endsWith('.las')) {
      const index = parts.indexOf('WirelineData');
      if (index > 0) well = parts[index - 1];
      dataset = 'logs';
    } else if (selected.has('deviation') && parts.includes('Deviation')) {
      const index = parts.indexOf('Deviation');
      if (index > 0) well = parts[index - 1];
      dataset = 'deviation';
    }
    if (!dataset) continue;

    let name = `${slug(well)}__${base}`;
    let counter = 2;
    while (used.has(`${dataset}/${name}`)) {
      const extension = path.extname(base);
      name = `${slug(well)}__${path.basename(base, extension)}-${counter}${extension}`;
      counter += 1;
    }
    used.add(`${dataset}/${name}`);
    const target = `${dataset}/${name}`;
    await mkdir(path.dirname(path.join(outputRoot, target)), { recursive: true });
    await copyFile(file, path.join(outputRoot, target));
    entries.push(
      await localEntry(target, {
        dataset,
        source: 'NSTA CGG Additional JDWLs release',
        url: CGG_ADDITIONAL,
        license: LICENSES.nstaRelease,
        source_crs:
          dataset === 'deviation' ? 'Check the deviation workbook; MD/inc/azi tables' : 'Not applicable (LAS curves)',
        original_path: relative,
        well,
      }),
    );
  }

  await rm(extractDir, { recursive: true, force: true });
  const counts = entries.reduce((accumulator, entry) => {
    accumulator[entry.dataset] = (accumulator[entry.dataset] || 0) + 1;
    return accumulator;
  }, {});
  if (selected.has('logs') && !counts.logs) throw new Error('No LAS files found in the CGG archive');
  if (selected.has('deviation') && !counts.deviation) {
    throw new Error('No deviation files found in the CGG archive');
  }
  console.log(`saved   ${counts.logs || 0} LAS files and ${counts.deviation || 0} deviation files`);
  return [zipEntry, ...entries];
}

async function downloadSeismic() {
  console.log('Fetching NSTA 2D and 3D survey metadata…');
  const directory2d = path.join(outputRoot, 'seismic-2d');
  const directory3d = path.join(outputRoot, 'seismic-3d');
  await mkdir(directory2d, { recursive: true });
  await mkdir(directory3d, { recursive: true });

  const lineLimit = allSeismic ? Number.POSITIVE_INFINITY : 200;
  const lines = await arcgisFeaturesAll(
    SEISMIC_2D_QUERY,
    {
      where: "OPEN_DATA='Y'",
      outFields: SEISMIC_2D_FIELDS.join(','),
      returnGeometry: 'true',
      outSR: '4326',
    },
    2000,
    lineLimit,
    'geojson',
  );
  const outlines = await arcgisFeaturesAll(
    SEISMIC_3D_QUERY,
    {
      where: '1=1',
      outFields: SEISMIC_3D_FIELDS.join(','),
      returnGeometry: 'true',
      outSR: '4326',
    },
    2000,
    Number.POSITIVE_INFINITY,
    'geojson',
  );
  if (!lines.length || !outlines.length) throw new Error('NSTA returned no seismic survey metadata');
  if (dryRun) {
    console.log(`would write ${lines.length} 2D line records and ${outlines.length} 3D outline records`);
    return [];
  }

  const linesPath = 'seismic-2d/nsta-2d-line-index.geojson';
  await writeFile(
    path.join(outputRoot, linesPath),
    JSON.stringify({ type: 'FeatureCollection', features: lines }, null, 2),
  );
  const outlinesPath = 'seismic-3d/nsta-3d-outline-index.geojson';
  await writeFile(
    path.join(outputRoot, outlinesPath),
    JSON.stringify({ type: 'FeatureCollection', features: outlines }, null, 2),
  );

  const note2d = `# NSTA 2D seismic index

This folder contains survey-line geometry only, sampled from the NSTA NDR 2D SDS line index. It is not SEG-Y data.

Raw NSTA offshore SEG-Y is held in the UK National Data Repository at https://ndr.nstauthority.co.uk/ and requires a free NDR account plus download-access approval. It is not available from the anonymous NSTA open-data services.

Source: ${SEISMIC_2D_QUERY}
Source CRS: ED50 (the service name carries the source CRS; this export was requested in WGS 84 for map use).
Licence: ${LICENSES.nsta}
`;
  const note3d = `# NSTA 3D seismic index

This folder contains survey outline geometry only, from the NSTA NDR 3D survey outline index. It is not a 3D SEG-Y cube.

Raw NSTA offshore SEG-Y is held in the UK National Data Repository at https://ndr.nstauthority.co.uk/ and requires a free NDR account plus download-access approval. It is not available from the anonymous NSTA open-data services.

Source: ${SEISMIC_3D_QUERY}
Source CRS: ED50 (the service name carries the source CRS; this export was requested in WGS 84 for map use).
Licence: ${LICENSES.nsta}
`;
  await writeFile(path.join(directory2d, 'README.md'), note2d);
  await writeFile(path.join(directory3d, 'README.md'), note3d);

  console.log(`saved   ${linesPath} (${lines.length} line records)`);
  console.log(`saved   ${outlinesPath} (${outlines.length} outline records)`);
  return [
    await localEntry(linesPath, {
      dataset: 'seismic',
      source: 'NSTA NDR 2D SDS seismic line index',
      url: SEISMIC_2D_QUERY,
      license: LICENSES.nsta,
      source_crs: 'ED50 source, exported in EPSG:4326',
    }),
    await localEntry(outlinesPath, {
      dataset: 'seismic',
      source: 'NSTA NDR 3D survey outline index',
      url: SEISMIC_3D_QUERY,
      license: LICENSES.nsta,
      source_crs: 'ED50 source, exported in EPSG:4326',
    }),
    await localEntry('seismic-2d/README.md', {
      dataset: 'seismic',
      source: 'NSTA seismic access note',
      url: SEISMIC_2D_QUERY,
      license: LICENSES.nsta,
      source_crs: 'Not applicable',
    }),
    await localEntry('seismic-3d/README.md', {
      dataset: 'seismic',
      source: 'NSTA seismic access note',
      url: SEISMIC_3D_QUERY,
      license: LICENSES.nsta,
      source_crs: 'Not applicable',
    }),
  ];
}

function summarize(files) {
  const labels = {
    wells: 'Well headers',
    production: 'Production',
    logs: 'Logs',
    deviation: 'Deviation',
    seismic: 'Seismic index',
    cgg: 'CGG archive',
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

async function readCount(relativePath) {
  try {
    const value = JSON.parse(await readFile(path.join(outputRoot, relativePath), 'utf8'));
    return value.count ?? value.features?.length ?? null;
  } catch {
    return null;
  }
}

async function writeReadme(files) {
  const wells = await readCount('wells/nsta-wellbores.geojson');
  const production = await readCount('production/pprs-field-monthly.metadata.json');
  const lines = await readCount('seismic-2d/nsta-2d-line-index.geojson');
  const outlines = await readCount('seismic-3d/nsta-3d-outline-index.geojson');
  const logs = files.filter((file) => file.dataset === 'logs').length;
  const deviations = files.filter((file) => file.dataset === 'deviation').length;
  const content = `# NSTA open-data demo package

Real UK open data, not synthetic fixtures. Downloaded by \`scripts/fetch-demo-nsta.mjs\`.
\`demo-data/\` is ignored by git.

| Data set | Files | Size |
| --- | ---: | ---: |
${summarize(files)}

## Contents

- \`wells/\` — ${wells ?? 'the'} open UKCS top-hole headers in EPSG:4326 (GeoJSON, CSV, metadata).
- \`production/\` — ${production ?? 'the'} PPRS field-month rows in the CSV, plus metadata. Geometry is the field centre in the source service; the CSV is attribute-only.
- \`logs/\` — ${logs} LAS files extracted from the NSTA CGG Additional JDWLs release.
- \`deviation/\` — ${deviations} deviation documents extracted from the same CGG release.
- \`seismic-2d/\` — ${lines ?? 'a sample of'} 2D survey-line records and an access note. Metadata only; no SEG-Y.
- \`seismic-3d/\` — ${outlines ?? 'the'} 3D survey outlines and an access note. Metadata only; no SEG-Y cube.
- \`cgg/\` — the CGG source archive and its release narrative.

## Sources and licences

- NSTA Open Data Hub and ArcGIS services: https://open-data-ukcs-transition.hub.arcgis.com/
- NSTA data pages: https://www.nstauthority.co.uk/data-and-insights/data/themes/production/ and https://www.nstauthority.co.uk/data-and-insights/data/themes/seismic/
- NSTA CGG Additional JDWLs release: ${CGG_ADDITIONAL}
- NSTA open data uses the Open Government Licence v3.0. Check the CGG narrative for any additional release terms.
- UK National Data Repository: https://ndr.nstauthority.co.uk/

## Coordinate and content notes

- NSTA well headers and PPRS production are WGS 84 (EPSG:4326).
- The 2D/3D survey services are named ED50; this export requested EPSG:4326 for map use, so the source CRS is ED50 / UTM zone 31N (EPSG:23031).
- The 12 NSTA wells already loaded in Atlasio are CCS wells (Liverpool Bay, Net Zero North Sea, Bacton) and have no target field. The CGG logs and deviation surveys belong to other UK wells, and PPRS production is field-level rather than tied to the loaded 12.
- Raw NSTA offshore SEG-Y is not included. It is available through the NDR after a free account and download-access approval. Use the Volve cube for a ready SEG-Y test, or UKOGL for open UK onshore seismic.

## Commands

\`\`\`sh
node scripts/fetch-demo-nsta.mjs --dataset all
node scripts/fetch-demo-nsta.mjs --dataset wells,production
node scripts/fetch-demo-nsta.mjs --dataset logs,deviation --force
node scripts/fetch-demo-nsta.mjs --dataset seismic --all-seismic
node scripts/fetch-demo-nsta.mjs --dataset all --dry-run
\`\`\`

\`manifest.json\` records the source URL, licence, byte count, and SHA-256 for every file.
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
  if (selected.has('production')) files.push(...(await downloadProduction()));
  if (selected.has('logs') || selected.has('deviation')) files.push(...(await downloadCgg()));
  if (selected.has('seismic')) files.push(...(await downloadSeismic()));

  if (dryRun) {
    console.log('Dry run complete; no manifest written.');
    return;
  }

  const byPath = new Map((previous.files || []).map((file) => [file.path, file]));
  for (const file of files) byPath.set(file.path, file);
  const manifest = {
    package: 'NSTA open-data demo',
    generated_at: new Date().toISOString(),
    sources: {
      hub: 'https://open-data-ukcs-transition.hub.arcgis.com/',
      wells: WELLS_QUERY,
      production: PRODUCTION_QUERY,
      seismic2d: SEISMIC_2D_QUERY,
      seismic3d: SEISMIC_3D_QUERY,
      cgg: CGG_ADDITIONAL,
      ndr: 'https://ndr.nstauthority.co.uk/',
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
