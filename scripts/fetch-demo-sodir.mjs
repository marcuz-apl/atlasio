import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = path.join(root, 'demo-data', 'sodir');
const manifestPath = path.join(outputRoot, 'manifest.json');

const SERVICES = {
  wgs84: {
    label: 'WGS 84',
    source: 'Sodir FactMaps',
    api: 'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer',
    format: 'geojson',
    crs: 'EPSG:4326',
    suffix: 'wgs84',
    layerDir: 'layers/wgs84',
    tableDir: 'tables',
    metadataFile: 'metadata/factmaps-wgs84.service.json',
    datasetLayers: 'layers-wgs84',
    datasetTables: 'tables-factmaps',
    hasTables: true,
  },
  ed50utm32: {
    label: 'ED50 / UTM zone 32N',
    source: 'Sodir FactMaps',
    api: 'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsED50UTM32/FeatureServer',
    format: 'json',
    crs: 'EPSG:23032',
    suffix: 'ed50utm32',
    layerDir: 'layers/ed50utm32',
    tableDir: 'tables',
    metadataFile: 'metadata/factmaps-ed50utm32.service.json',
    datasetLayers: 'layers-ed50utm32',
    datasetTables: 'tables-factmaps',
    hasTables: false,
  },
  data: {
    label: 'ED50 geographic (DataService)',
    source: 'Sodir DataService',
    api: 'https://factmaps.sodir.no/api/rest/services/DataService/Data/FeatureServer',
    format: 'json',
    crs: 'EPSG:4230',
    suffix: 'ed50geo',
    layerDir: 'dataservice/layers',
    tableDir: 'dataservice/tables',
    metadataFile: 'metadata/dataservice-ed50.service.json',
    datasetLayers: 'layers-ed50geo',
    datasetTables: 'tables-dataservice',
    hasTables: true,
  },
};

for (const [key, service] of Object.entries(SERVICES)) service.key = key;

const DATASETS = ['layers', 'tables', 'production'];
const PRODUCTION_TABLES = {
  monthly: 'field_production_monthly',
  yearly: 'field_production_yearly',
};
const FACT_PAGES = 'https://factpages.sodir.no';
const LICENCE = 'NLOD 2.0 — https://data.norge.no/nlod/en/2.0';
const PAGE_SIZE = 1000;
const MAX_FEATURES = 1_000_000;

const flags = new Set(process.argv.slice(2));
const force = flags.has('--force');
const dryRun = flags.has('--dry-run');
const onlyIds = parseIds(readFlag('--only'));
const requestedServices = (readFlag('--service') || 'wgs84,ed50utm32,data')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const requestedDatasets = (readFlag('--dataset') || 'all')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

for (const name of requestedServices) {
  if (!SERVICES[name]) throw new Error(`Unknown service '${name}'. Choose wgs84, ed50utm32, or data.`);
}
if (requestedDatasets.includes('all')) DATASETS.forEach((name) => requestedDatasets.push(name));
for (const name of requestedDatasets) {
  if (name !== 'all' && !DATASETS.includes(name)) {
    throw new Error(`Unknown dataset '${name}'. Choose one of: all, ${DATASETS.join(', ')}`);
  }
}
const wants = (name) => requestedDatasets.includes(name);

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseIds(value) {
  if (!value) return null;
  const ids = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  return ids.length ? new Set(ids) : null;
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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatValue(value, isDate) {
  if (value === null || value === undefined) return '';
  if (isDate && typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return value;
}

function formatDate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, params = {}, format = 'json', attempts = 4) {
  const query = new URLSearchParams({ ...params, f: format });
  const target = `${url}?${query}`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(target, {
        headers: { Accept: 'application/json, application/geo+json' },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText} for ${target}${body ? `: ${body.slice(0, 200)}` : ''}`);
      }
      const value = await response.json();
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

async function fetchText(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'text/csv, text/plain, */*' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1500);
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

async function writeAtomic(relativePath, content) {
  const target = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const part = `${target}.part`;
  await writeFile(part, content);
  await rename(part, target);
}

async function isComplete(paths) {
  for (const relativePath of paths) {
    try {
      const info = await stat(path.join(outputRoot, relativePath));
      if (!info.size) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(outputRoot, relativePath), 'utf8'));
}

async function getService(service) {
  const metadata = await fetchJson(service.api, {}, 'pjson');
  return {
    metadata,
    layers: metadata.layers || [],
    tables: metadata.tables || [],
    spatialReference: metadata.spatialReference || null,
  };
}

async function getItem(service, item) {
  const metadata = await fetchJson(`${service.api}/${item.id}`, {}, 'pjson');
  return {
    id: item.id,
    name: metadata.name || item.name,
    geometryType: metadata.geometryType || item.geometryType || null,
    fields: metadata.fields || [],
    objectIdField: metadata.objectIdField || 'OBJECTID',
    maxRecordCount: metadata.maxRecordCount || PAGE_SIZE,
    spatialReference: metadata.spatialReference || null,
    sourceUrl: `${service.api}/${item.id}`,
  };
}

async function queryAll(service, item, withGeometry) {
  const pageSize = Math.min(item.maxRecordCount || PAGE_SIZE, PAGE_SIZE);
  const features = [];
  let offset = 0;
  const orderBy = item.objectIdField ? `${item.objectIdField} ASC` : undefined;

  for (;;) {
    const params = {
      where: '1=1',
      outFields: '*',
      returnGeometry: withGeometry ? 'true' : 'false',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    };
    if (withGeometry) params.returnTrueCurves = 'false';
    if (orderBy) params.orderByFields = orderBy;

    const page = await fetchJson(`${service.api}/${item.id}/query`, params, service.format);
    const got = Array.isArray(page.features) ? page.features : [];
    features.push(...got);
    if (got.length < pageSize) break;
    offset += got.length;
    if (offset > MAX_FEATURES) {
      throw new Error(`Pagination exceeded ${MAX_FEATURES} features for layer ${item.id}`);
    }
  }
  return features;
}

function coordinateColumns(service) {
  if (service.crs === 'EPSG:4326') return ['longitude', 'latitude'];
  if (service.crs === 'EPSG:4230') return ['ed50_longitude', 'ed50_latitude'];
  return ['easting', 'northing'];
}

function layerCsv(service, item, features) {
  const columns = item.fields.map((field) => field.name);
  const point = item.geometryType === 'esriGeometryPoint';
  const header = [...columns];
  if (point) header.push(...coordinateColumns(service));
  const dateFields = new Set(
    item.fields.filter((field) => field.type === 'esriFieldTypeDate').map((field) => field.name),
  );
  const rows = [header];

  for (const feature of features) {
    const attributes = service.format === 'geojson' ? feature.properties || {} : feature.attributes || {};
    const row = columns.map((name) => formatValue(attributes[name], dateFields.has(name)));
    if (point) {
      if (service.format === 'geojson') {
        const coordinates = feature.geometry?.coordinates;
        row.push(coordinates?.[0] ?? '', coordinates?.[1] ?? '');
      } else {
        row.push(feature.geometry?.x ?? '', feature.geometry?.y ?? '');
      }
    }
    rows.push(row);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function tableCsv(item, records) {
  const columns = item.fields.map((field) => field.name);
  const dateFields = new Set(
    item.fields.filter((field) => field.type === 'esriFieldTypeDate').map((field) => field.name),
  );
  const rows = [columns];
  for (const record of records) {
    rows.push(columns.map((name) => formatValue(record[name], dateFields.has(name))));
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

async function writeLayer(serviceKey, service, entry, summaries) {
  const item = await getItem(service, entry);
  const base = `${String(item.id).padStart(3, '0')}-${slug(item.name)}`;
  const directory = service.layerDir;
  const extension = service.format === 'geojson' ? 'geojson' : 'json';
  const dataPath = `${directory}/${base}.${extension}`;
  const csvPath = `${directory}/${base}.csv`;
  const metadataPath = `${directory}/${base}.metadata.json`;
  const paths = [dataPath, csvPath, metadataPath];

  let count;
  if (!force && (await isComplete(paths))) {
    const existing = await readJson(metadataPath);
    count = existing.record_count;
    console.log(`skip    ${dataPath} (${count} features)`);
  } else {
    const features = await queryAll(service, item, true);
    count = features.length;
    const retrievedAt = new Date().toISOString();

    if (service.format === 'geojson') {
      await writeAtomic(dataPath, JSON.stringify({ type: 'FeatureCollection', features }));
    } else {
      await writeAtomic(
        dataPath,
        JSON.stringify({
          service: service.label,
          source_url: item.sourceUrl,
          spatial_reference: item.spatialReference || null,
          fields: item.fields,
          features,
          retrieved_at: retrievedAt,
          licence: LICENCE,
        }),
      );
    }

    await writeAtomic(csvPath, layerCsv(service, item, features));
    await writeAtomic(
      metadataPath,
      `${JSON.stringify(
        {
          dataset: service.datasetLayers,
          service: service.label,
          layer: { id: item.id, name: item.name, geometry_type: item.geometryType },
          record_count: count,
          fields: item.fields,
          spatial_reference: item.spatialReference || null,
          source_crs: service.crs,
          data_format: service.format === 'geojson' ? 'RFC 7946 GeoJSON' : 'Esri JSON',
          source_url: item.sourceUrl,
          query_url: `${service.api}/${item.id}/query`,
          retrieved_at: retrievedAt,
          licence: LICENCE,
          files: { data: dataPath, csv: csvPath },
        },
        null,
        2,
      )}\n`,
    );
    console.log(`saved   ${dataPath} (${count} features)`);
  }

  summaries.push({
    service: serviceKey,
    id: item.id,
    name: item.name,
    geometry_type: item.geometryType,
    record_count: count,
    files: { data: dataPath, csv: csvPath, metadata: metadataPath },
  });

  return [
    await localEntry(dataPath, {
      dataset: service.datasetLayers,
      source: `${service.source} ${service.label}`,
      url: item.sourceUrl,
      source_crs: service.crs,
      licence: LICENCE,
    }),
    await localEntry(csvPath, {
      dataset: service.datasetLayers,
      source: `${service.source} ${service.label}`,
      url: item.sourceUrl,
      source_crs: service.crs,
      licence: LICENCE,
    }),
    await localEntry(metadataPath, {
      dataset: service.datasetLayers,
      source: `${service.source} ${service.label}`,
      url: item.sourceUrl,
      source_crs: service.crs,
      licence: LICENCE,
    }),
  ];
}

async function writeTable(service, entry, summaries) {
  const item = await getItem(service, entry);
  const base = `${String(item.id).padStart(3, '0')}-${slug(item.name)}`;
  const csvPath = `${service.tableDir}/${base}.csv`;
  const dataPath = `${service.tableDir}/${base}.json`;
  const metadataPath = `${service.tableDir}/${base}.metadata.json`;
  const paths = [csvPath, dataPath, metadataPath];

  let count;
  if (!force && (await isComplete(paths))) {
    const existing = await readJson(metadataPath);
    count = existing.record_count;
    console.log(`skip    ${csvPath} (${count} rows)`);
  } else {
    const features = await queryAll(service, { ...item, geometryType: null }, false);
    const records = features.map((feature) => feature.attributes || {});
    count = records.length;
    const retrievedAt = new Date().toISOString();
    await writeAtomic(csvPath, tableCsv(item, records));
    await writeAtomic(
      dataPath,
      JSON.stringify({
        service: service.label,
        source_url: item.sourceUrl,
        fields: item.fields,
        records,
        retrieved_at: retrievedAt,
        licence: LICENCE,
      }),
    );
    await writeAtomic(
      metadataPath,
      `${JSON.stringify(
        {
          dataset: service.datasetTables,
          service: service.label,
          table: { id: item.id, name: item.name },
          record_count: count,
          fields: item.fields,
          source_url: item.sourceUrl,
          query_url: `${service.api}/${item.id}/query`,
          retrieved_at: retrievedAt,
          licence: LICENCE,
          files: { data: dataPath, csv: csvPath },
        },
        null,
        2,
      )}\n`,
    );
    console.log(`saved   ${csvPath} (${count} rows)`);
  }

  summaries.push({
    service: service.key,
    id: item.id,
    name: item.name,
    record_count: count,
    files: { data: dataPath, csv: csvPath, metadata: metadataPath },
  });

  return [
    await localEntry(dataPath, {
      dataset: service.datasetTables,
      source: `${service.source} ${service.label}`,
      url: item.sourceUrl,
      source_crs: 'not applicable (attribute table)',
      licence: LICENCE,
    }),
    await localEntry(csvPath, {
      dataset: service.datasetTables,
      source: `${service.source} ${service.label}`,
      url: item.sourceUrl,
      source_crs: 'not applicable (attribute table)',
      licence: LICENCE,
    }),
    await localEntry(metadataPath, {
      dataset: service.datasetTables,
      source: `${service.source} ${service.label}`,
      url: item.sourceUrl,
      source_crs: 'not applicable (attribute table)',
      licence: LICENCE,
    }),
  ];
}

function productionUrl(table) {
  return `${FACT_PAGES}/public?/Factpages/external/tableview/${table}&rs:Command=Render&rc:Toolbar=false&rc:Parameters=f&IpAddress=not_used&CultureCode=en&rs:Format=CSV&Top100=false`;
}

function csvLines(csv) {
  const text = csv.replace(/^\uFEFF/, '');
  const lines = [];
  let line = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        line += '""';
        index += 1;
      } else {
        quoted = !quoted;
        line += character;
      }
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (line.length) lines.push(line);
      line = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      line += character;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

function splitCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

async function writeProduction() {
  const entries = [];
  const summaries = [];
  for (const [kind, table] of Object.entries(PRODUCTION_TABLES)) {
    const relativePath = `production/sodir-field-production-${kind}.csv`;
    const metadataPath = `production/sodir-field-production-${kind}.metadata.json`;
    let summary;
    if (!force && (await isComplete([relativePath, metadataPath]))) {
      summary = await readJson(metadataPath);
      console.log(`skip    ${relativePath} (${summary.record_count} rows)`);
    } else {
      const csv = await fetchText(productionUrl(table));
      await writeAtomic(relativePath, csv);
      const lines = csvLines(csv);
      const header = lines.length ? splitCsvLine(lines[0]) : [];
      const yearIndex = header.indexOf('prfYear');
      const monthIndex = header.indexOf('prfMonth');
      let first = null;
      let last = null;
      for (const line of lines.slice(1)) {
        const values = splitCsvLine(line);
        const year = Number(values[yearIndex]);
        if (!Number.isFinite(year)) continue;
        const month = monthIndex >= 0 ? Number(values[monthIndex]) : null;
        const key = year * 100 + (Number.isFinite(month) ? month : 0);
        const stamp = { year, month: Number.isFinite(month) ? month : null, key };
        if (!first || key < first.key) first = stamp;
        if (!last || key > last.key) last = stamp;
      }
      summary = {
        dataset: 'production',
        table,
        record_count: Math.max(0, lines.length - 1),
        columns: header,
        first_year: first?.year ?? null,
        first_month: first?.month ?? null,
        last_year: last?.year ?? null,
        last_month: last?.month ?? null,
        source_url: productionUrl(table),
        retrieved_at: new Date().toISOString(),
        licence: LICENCE,
        source_crs: 'not applicable (attribute table)',
      };
      await writeAtomic(metadataPath, `${JSON.stringify(summary, null, 2)}\n`);
      console.log(`saved   ${relativePath} (${summary.record_count} rows)`);
    }
    summaries.push(summary);
    entries.push(
      await localEntry(relativePath, {
        dataset: 'production',
        source: 'Sodir FactPages field production',
        url: productionUrl(table),
        source_crs: 'not applicable (attribute table)',
        licence: LICENCE,
      }),
      await localEntry(metadataPath, {
        dataset: 'production',
        source: 'Sodir FactPages field production',
        url: productionUrl(table),
        source_crs: 'not applicable (attribute table)',
        licence: LICENCE,
      }),
    );
  }
  return { entries, summaries };
}

function mergeRows(base, additions, keyOf) {
  const rows = new Map(base.map((item) => [keyOf(item), item]));
  for (const item of additions) rows.set(keyOf(item), item);
  return [...rows.values()];
}

function summarizeFiles(files) {
  const labels = {
    'layers-wgs84': 'FactMaps layers, WGS 84',
    'layers-ed50utm32': 'FactMaps layers, ED50 / UTM 32N',
    'layers-ed50geo': 'DataService layers, ED50 geographic',
    'tables-factmaps': 'FactMaps attribute tables',
    'tables-dataservice': 'DataService attribute tables',
    production: 'FactPages field production',
    metadata: 'Service metadata',
  };
  const byDataset = new Map();
  for (const file of files) {
    const dataset = file.dataset || 'metadata';
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

async function writeReadme(files, inventory) {
  const factmapsLayerIds = new Set(
    inventory.layers.filter((layer) => layer.service !== 'data').map((layer) => layer.id),
  );
  const dataLayerIds = new Set(
    inventory.layers.filter((layer) => layer.service === 'data').map((layer) => layer.id),
  );
  const factmapsTables = inventory.tables.filter((table) => (table.service || 'wgs84') !== 'data');
  const dataTables = inventory.tables.filter((table) => table.service === 'data');
  const content = `# Sodir open-data demo package

Real public data from the Norwegian Offshore Directorate (Sodir), not synthetic fixtures.
Downloaded by \`scripts/fetch-demo-sodir.mjs\`; \`demo-data/\` is ignored by git.

| Data set | Files | Size |
| --- | ---: | ---: |
${summarizeFiles(files)}

## Layout

- \`layers/wgs84/\` — all ${factmapsLayerIds.size} FactMaps feature layers in WGS 84 (\`EPSG:4326\`), as RFC 7946 GeoJSON and CSV.
- \`layers/ed50utm32/\` — the same ${factmapsLayerIds.size} FactMaps layers in the native ED50 / UTM zone 32N service (\`EPSG:23032\`), as Esri JSON and CSV. Esri JSON keeps the explicit \`spatialReference\`; GeoJSON is deliberately not generated for ED50 because \`f=geojson\` silently reprojects to WGS 84.
- \`dataservice/layers/\` — ${dataLayerIds.size} DataService feature layers in the native ED50 geographic service (\`EPSG:4230\`), as Esri JSON and CSV. This is the source database behind the FactMaps views.
- \`tables/\` — ${factmapsTables.length} FactMaps attribute tables (well logs, casing, DST, mud, samples, licences, reserves, history) as CSV and JSON.
- \`dataservice/tables/\` — ${dataTables.length} DataService attribute tables: stratigraphy, formation tops, cores, core photos, cuttings, thin sections, well documents, seismic acquisition, discoveries, fields, reserves, and the petroleum register.
- \`production/\` — Sodir FactPages field production, monthly and yearly.
- \`metadata/\` — service metadata and \`inventory.json\`, which lists every layer and table with its record count and files.

Each layer directory contains \`NNN-name.<format>\`, \`NNN-name.csv\`, and \`NNN-name.metadata.json\`.
The wellbore records are layer \`201\` in both FactMaps services and layer \`5000\` in DataService. CSV files use the ArcGIS field names; aliases and types are in the metadata files.

## Coordinate systems

- WGS 84 layers are the published WGS 84 service: \`EPSG:4326\`.
- FactMaps ED50 layers are the published ED50 / UTM zone 32N service: \`EPSG:23032\`.
- DataService layers are the native ED50 geographic service: \`EPSG:4230\`.
- No coordinate transformation is applied by this script. The WGS 84 service is Sodir's own transformed product; the ED50 services preserve the native coordinates.
- Tables and production CSVs carry no geometry.

## Sources and licence

- FactMaps services: https://factmaps.sodir.no/api/rest/services/Factmaps
- DataService: https://factmaps.sodir.no/api/rest/services/DataService/Data/FeatureServer
- FactPages production: https://factpages.sodir.no/en/field/tableview/production/saleable/monthly
- Sodir open data: https://www.sodir.no/en/facts/data-and-analyses/open-data/
- Licence: ${LICENCE}
- Verify the licence and any third-party terms again before a public or commercial demo.

## Commands

\`\`\`sh
node scripts/fetch-demo-sodir.mjs --dataset all
node scripts/fetch-demo-sodir.mjs --dataset layers --service wgs84
node scripts/fetch-demo-sodir.mjs --dataset tables
node scripts/fetch-demo-sodir.mjs --dataset production
node scripts/fetch-demo-sodir.mjs --dataset layers --only 201 --force
node scripts/fetch-demo-sodir.mjs --dataset all --dry-run
\`\`\`

Files are fetched page by page (1000 records), retried on transient errors, and skipped when a
complete set already exists. \`manifest.json\` records the source URL, licence, byte count,
SHA-256, and source CRS for every file.

## Current Atlasio limitation

The current ingest API accepts one well-header JSON and one original file up to 5 MiB, with an
explicit \`EPSG:4326\` position. This package is staged evidence for the log, deviation, DST,
production, licence, and survey features that are not implemented yet. The script does not load
anything into the database.
`;
  await writeAtomic('README.md', content);
}

async function writeMetadataFile(relativePath, value) {
  await writeAtomic(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  await mkdir(outputRoot, { recursive: true });

  let previous = { files: [] };
  try {
    previous = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    previous = { files: [] };
  }
  let previousInventory = { services: {}, layers: [], tables: [], production: [] };
  try {
    previousInventory = JSON.parse(await readFile(path.join(outputRoot, 'metadata', 'inventory.json'), 'utf8'));
  } catch {
    previousInventory = { services: {}, layers: [], tables: [], production: [] };
  }

  const serviceState = {};
  for (const serviceKey of requestedServices) {
    const service = SERVICES[serviceKey];
    console.log(`Reading ${service.label} service metadata…`);
    serviceState[serviceKey] = await getService(service);
  }

  if (dryRun) {
    for (const [serviceKey, state] of Object.entries(serviceState)) {
      console.log(`\n${SERVICES[serviceKey].label}`);
      for (const layer of state.layers) {
        if (onlyIds && !onlyIds.has(layer.id)) continue;
        const count = await fetchJson(`${SERVICES[serviceKey].api}/${layer.id}/query`, {
          where: '1=1',
          returnCountOnly: 'true',
        });
        console.log(`  layer ${String(layer.id).padStart(3, '0')} ${String(count.count ?? '?').padStart(7)} ${layer.name}`);
      }
    }
    console.log('\nDry run complete; no files written.');
    return;
  }

  const files = [];
  const inventory = {
    package: 'Sodir open data',
    generated_at: new Date().toISOString(),
    services: { ...(previousInventory.services || {}) },
    layers: [...(previousInventory.layers || [])],
    tables: [...(previousInventory.tables || [])],
    production: [...(previousInventory.production || [])],
  };
  for (const table of inventory.tables) {
    if (table.service === 'ed50geo') table.service = 'data';
    table.service = table.service || 'wgs84';
  }
  const freshLayers = [];
  const freshTables = [];
  const freshProduction = [];
  const errors = [];

  for (const serviceKey of requestedServices) {
    const service = SERVICES[serviceKey];
    const state = serviceState[serviceKey];
    inventory.services[serviceKey] = {
      label: service.label,
      api: service.api,
      crs: service.crs,
      layer_count: state.layers.length,
      table_count: state.tables.length,
      spatial_reference: state.spatialReference,
    };
    await writeMetadataFile(
      service.metadataFile,
      {
        service: service.label,
        api: service.api,
        crs: service.crs,
        retrieved_at: new Date().toISOString(),
        metadata: state.metadata,
      },
    );
    files.push(
      await localEntry(service.metadataFile, {
        dataset: 'metadata',
        source: `${service.source} ${service.label} service metadata`,
        url: service.api,
        source_crs: service.crs,
        licence: LICENCE,
      }),
    );

    if (wants('layers')) {
      console.log(`\n${service.label}: ${state.layers.length} layers`);
      for (const layer of state.layers) {
        if (onlyIds && !onlyIds.has(layer.id)) continue;
        try {
          files.push(...(await writeLayer(serviceKey, service, layer, freshLayers)));
        } catch (error) {
          console.error(`failed  layer ${layer.id} ${layer.name}: ${error.message}`);
          errors.push(`layer ${layer.id} ${layer.name}: ${error.message}`);
        }
      }
    }

    if (wants('tables') && service.hasTables) {
      console.log(`\n${service.label}: ${state.tables.length} attribute tables`);
      for (const table of state.tables) {
        if (onlyIds && !onlyIds.has(table.id)) continue;
        try {
          files.push(...(await writeTable(service, table, freshTables)));
        } catch (error) {
          console.error(`failed  table ${table.id} ${table.name}: ${error.message}`);
          errors.push(`table ${table.id} ${table.name}: ${error.message}`);
        }
      }
    }
  }

  if (wants('production')) {
    console.log('\nFactPages production');
    try {
      const production = await writeProduction();
      files.push(...production.entries);
      freshProduction.push(...production.summaries);
    } catch (error) {
      console.error(`failed  production: ${error.message}`);
      errors.push(`production: ${error.message}`);
    }
  }

  inventory.layers = mergeRows(inventory.layers, freshLayers, (layer) => `${layer.service}:${layer.id}`);
  inventory.tables = mergeRows(inventory.tables, freshTables, (table) => `${table.service || 'wgs84'}:${table.id}`);
  for (const table of inventory.tables) table.service = table.service || 'wgs84';
  inventory.production = mergeRows(inventory.production, freshProduction, (row) => row.table);
  inventory.layers.sort((a, b) => a.id - b.id || a.service.localeCompare(b.service));
  inventory.tables.sort((a, b) => a.id - b.id);
  await writeMetadataFile('metadata/inventory.json', inventory);
  files.push(
    await localEntry('metadata/inventory.json', {
      dataset: 'metadata',
      source: 'Sodir open-data inventory',
      url: 'https://factmaps.sodir.no/api/rest/services',
      source_crs: 'mixed (see entries)',
      licence: LICENCE,
    }),
  );

  const byPath = new Map((previous.files || []).map((file) => [file.path, file]));
  for (const file of files) byPath.set(file.path, file);
  const kept = [];
  for (const [relativePath, file] of byPath) {
    try {
      const info = await stat(path.join(outputRoot, relativePath));
      if (info.size > 0) kept.push(file);
    } catch {
      // Prune entries whose files were removed.
    }
  }

  const manifest = {
    package: 'Sodir open data',
    generated_at: new Date().toISOString(),
    sources: {
      factmaps: 'https://factmaps.sodir.no/api/rest/services/Factmaps',
      dataservice: 'https://factmaps.sodir.no/api/rest/services/DataService/Data/FeatureServer',
      factpages: 'https://factpages.sodir.no',
      open_data: 'https://www.sodir.no/en/facts/data-and-analyses/open-data/',
    },
    licences: { sodir: LICENCE },
    coordinate_systems: {
      wgs84: 'EPSG:4326 (published WGS 84 FactMaps service)',
      ed50utm32: 'EPSG:23032 (published ED50 / UTM zone 32N FactMaps service)',
      ed50geo: 'EPSG:4230 (native ED50 geographic DataService)',
    },
    files: kept.sort((a, b) => a.path.localeCompare(b.path)),
  };
  await writeAtomic('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await writeReadme(manifest.files, inventory);

  const total = manifest.files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  console.log(`\n${manifest.files.length} files, ${formatBytes(total)} under ${path.relative(root, outputRoot)}/`);
  console.log(`Manifest: ${path.relative(root, manifestPath)}`);
  if (errors.length) {
    console.error(`\n${errors.length} item(s) failed:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
