import assert from 'node:assert/strict';

// Import NSTA open-data boundaries into Atlasio as governed land areas.
//
// Each layer's own metadata declares its native CRS (the licensed-block layer
// is EPSG:4230, ED50 geographic; the block grid and CCS licences are
// EPSG:4326). Source coordinates are posted unchanged with that CRS, and the
// server derives the WGS 84 display footprint through the verified CRS engine.
//
// Usage:
//   node scripts/import-land-areas.mjs                 # licences, blocks, ccs
//   node scripts/import-land-areas.mjs --only licences # one layer
//   node scripts/import-land-areas.mjs --limit 20 --dry-run

const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const ARCGIS = 'https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services';
const OGL = 'Open Government Licence v3.0 — https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';
const PAGE = 1000;

const LAYERS = {
  licences: {
    service: 'UKCS_offshore_petroleum_licence_blocks_(ED50)',
    format: 'esri',
    expectedCrs: 'EPSG:4230',
    kind: 'licence',
    source: 'NSTA Open Data — UKCS offshore petroleum licence blocks (ED50)',
    map: (a) => ({
      code: text(a.LICREF) || `LIC-${a.LICNO}`,
      name: text(a.LICREF),
      block_ref: text(a.BLOCKREF),
      operator: text(a.OPORG),
      licence_status: text(a.LICSTATUS),
      effective_from: isoDate(a.LICSTARTDT),
      effective_to: isoDate(a.LICENDDT),
      parties: [],
    }),
  },
  blocks: {
    service: 'UKCS_blocks_(WGS84)',
    format: 'geojson',
    expectedCrs: 'EPSG:4326',
    kind: 'block',
    source: 'NSTA Open Data — UKCS block reference grid (WGS 84)',
    map: (a) => ({
      code: text(a.BLOCK_REF),
      name: null,
      block_ref: text(a.BLOCK_REF),
      operator: null,
      licence_status: null,
      effective_from: null,
      effective_to: null,
      parties: [],
    }),
  },
  ccs: {
    service: 'UKCS_current_carbon_storage_licences_(WGS84)',
    format: 'geojson',
    expectedCrs: 'EPSG:4326',
    kind: 'licence',
    source: 'NSTA Open Data — UKCS current carbon storage licences (WGS 84)',
    map: (a) => ({
      code: text(a.LICREF) || text(a.LICNAME),
      name: text(a.LICNAME),
      block_ref: null,
      operator: text(a.EXPLO_OPR),
      licence_status: text(a.LICSTATUS),
      effective_from: isoDate(a.LICSTARTDT),
      effective_to: null,
      parties: [a.PART_ORG_1, a.PART_ORG_2, a.PART_ORG_3, a.PART_ORG_4]
        .map(text)
        .filter(Boolean)
        .map((name) => ({ name })),
    }),
  },
};

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const limit = Number(readFlag('--limit') || Infinity);
const only = (readFlag('--only') || Object.keys(LAYERS).join(','))
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
for (const name of only) {
  if (!LAYERS[name]) throw new Error(`Unknown layer '${name}'. Choose ${Object.keys(LAYERS).join(', ')}.`);
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed !== ' ' ? trimmed : null;
}

function isoDate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function serviceUrl(service) {
  return `${ARCGIS}/${encodeURIComponent(service)}/FeatureServer/0`;
}

async function getJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw lastError;
}

// The service metadata's spatialReference is the authoritative source CRS.
async function resolveCrs(service) {
  const metadata = await getJson(`${serviceUrl(service)}?f=json`);
  const wkid = metadata?.extent?.spatialReference?.latestWkid
    ?? metadata?.extent?.spatialReference?.wkid
    ?? metadata?.spatialReference?.latestWkid
    ?? metadata?.spatialReference?.wkid;
  return wkid ? `EPSG:${wkid}` : null;
}

// Esri rings may describe several parts; GeoJSON polygons nested parts. Keep
// the outer ring with the largest area so every record stays one Polygon.
function largestRing(rings) {
  let best = null;
  let bestArea = 0;
  for (const ring of rings) {
    const area = Math.abs(shoelace(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

function shoelace(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function ringFromGeometry(geometry, format) {
  if (!geometry) return null;
  if (format === 'esri') {
    const rings = geometry.rings || [];
    if (!rings.length) return null;
    return closeRing(largestRing(rings));
  }
  const { type, coordinates } = geometry;
  if (type === 'Polygon') return closeRing(largestRing(coordinates));
  if (type === 'MultiPolygon') {
    return closeRing(largestRing(coordinates.map((polygon) => polygon[0])));
  }
  return null;
}

function closeRing(ring) {
  if (!ring || ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
  return closed.map(([x, y]) => [Number(x), Number(y)]);
}

async function resolveImporterKey() {
  try {
    const response = await fetch(`${host}/api/demo-profiles`);
    const items = await response.json();
    const importer = items.find((item) => item.role === 'importer');
    if (importer?.key) return importer.key;
  } catch {
    // fall through
  }
  return 'importer-demo';
}

async function fetchFeatures(layerName, layer) {
  const url = `${serviceUrl(layer.service)}/query`;
  const features = [];
  for (let offset = 0; offset < limit; offset += PAGE) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(Math.min(PAGE, limit - offset)),
      f: layer.format === 'geojson' ? 'geojson' : 'json',
    });
    const page = await getJson(`${url}?${params}`);
    const got = Array.isArray(page.features) ? page.features : [];
    features.push(...got);
    process.stdout.write(`\r  ${layerName}: fetched ${features.length}`);
    if (got.length < Math.min(PAGE, limit - offset)) break;
  }
  process.stdout.write('\n');
  return features;
}

async function importLayer(key, name, layer) {
  const crs = await resolveCrs(layer.service);
  if (crs !== layer.expectedCrs) {
    throw new Error(`${name}: service reports ${crs ?? 'no CRS'}, expected ${layer.expectedCrs}`);
  }
  console.log(`\n${name}: ${layer.service} — ${crs}`);
  const features = await fetchFeatures(name, layer);
  console.log(`  ${features.length} feature(s)`);

  let created = 0;
  let duplicates = 0;
  let failed = 0;
  let withoutDisplay = 0;
  for (const feature of features) {
    const attributes = feature.attributes || feature.properties || {};
    const mapped = layer.map(attributes);
    const ring = ringFromGeometry(feature.geometry, layer.format);
    if (!ring || !mapped.code) {
      failed += 1;
      continue;
    }
    if (dryRun) {
      created += 1;
      continue;
    }
    const payload = {
      kind: layer.kind,
      code: mapped.code,
      name: mapped.name ?? null,
      block_ref: mapped.block_ref ?? null,
      operator: mapped.operator ?? null,
      parties: mapped.parties ?? [],
      licence_status: mapped.licence_status ?? null,
      effective_from: mapped.effective_from ?? null,
      effective_to: mapped.effective_to ?? null,
      source: layer.source,
      source_url: serviceUrl(layer.service),
      source_crs: crs,
      footprint: { type: 'Polygon', coordinates: [ring] },
      license: OGL,
      confidentiality: 'public',
    };
    try {
      const response = await fetch(`${host}/api/land-areas`, {
        method: 'POST',
        headers: { 'X-Atlasio-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        failed += 1;
        if (failed <= 5) console.error(`  ${mapped.code}: ${response.status} ${JSON.stringify(result)}`);
      } else if (result.status === 'duplicate') {
        duplicates += 1;
      } else {
        created += 1;
        if (result.display_footprint === false) withoutDisplay += 1;
      }
    } catch (error) {
      failed += 1;
      if (failed <= 5) console.error(`  ${mapped.code}: ${error.message}`);
    }
    if ((created + duplicates + failed) % 250 === 0) {
      process.stdout.write(`\r  posted ${created + duplicates + failed}/${features.length}`);
    }
  }
  process.stdout.write('\n');
  console.log(
    `  created=${created} duplicates=${duplicates} failed=${failed}${withoutDisplay ? ` no-display=${withoutDisplay}` : ''}${dryRun ? ' (dry run)' : ''}`,
  );
  return { created, duplicates, failed };
}

const key = await resolveImporterKey();
let total = { created: 0, duplicates: 0, failed: 0 };
for (const name of only) {
  const result = await importLayer(key, name, LAYERS[name]);
  for (const field of Object.keys(total)) total[field] += result[field];
}
console.log(`\nDone: created=${total.created} duplicates=${total.duplicates} failed=${total.failed}`);
if (total.failed > 0) process.exitCode = 1;
assert.ok(total.created + total.duplicates > 0, 'no boundary records were imported');
