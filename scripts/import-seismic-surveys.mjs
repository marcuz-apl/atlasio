import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Import the extracted NSTA/UKOGL seismic shapefiles as governed surveys.
//
// Both packages are OSGB 1936 / British National Grid (EPSG:27700) according
// to their .prj and README. Source geometry is stored unchanged in that CRS;
// the server derives the WGS 84 display geometry through the verified
// EPSG:1314 operation (PROJ-checked control points in fixtures/).
//
// Usage:
//   node scripts/import-seismic-surveys.mjs             # both packages
//   node scripts/import-seismic-surveys.mjs --only 2d
//   node scripts/import-seismic-surveys.mjs --limit 50 --dry-run

const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const root = fileURLToPath(new URL('../', import.meta.url));
const OGL = 'Open Government Licence v3.0 — https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/';

const PACKAGES = {
  '2d': {
    shp: `${root}demo-data/nsta/seismic-2d/2D_seimic_2023_06_01/ukogl_2d_2023-06-01.shp`,
    dbf: `${root}demo-data/nsta/seismic-2d/2D_seimic_2023_06_01/ukogl_2d_2023-06-01.dbf`,
    cpg: `${root}demo-data/nsta/seismic-2d/2D_seimic_2023_06_01/ukogl_2d_2023-06-01.cpg`,
    kind: '2d',
    source: 'NSTA / UKOGL 2D seismic line index (OSGB 1936 / British National Grid)',
    name(record, existing) {
      const line = record.LINE_NAME || record.UKOGL_LINE;
      const id = record.UKOGL_LINE;
      return existing.has(line) && id ? `${line} [${id}]` : line;
    },
    operator: (record) => record.OPERATOR_N || null,
  },
  '3d': {
    shp: `${root}demo-data/nsta/seismic-3d/3D_seismic_2019_01_02/3d-master-released.shp`,
    dbf: `${root}demo-data/nsta/seismic-3d/3D_seismic_2019_01_02/3d-master-released.dbf`,
    cpg: null,
    kind: '3d',
    source: 'NSTA / UKOGL 3D seismic survey outlines (OSGB 1936 / British National Grid)',
    name(record, existing) {
      const name = record.LINENAME || record.LINE_NAME;
      return existing.has(name) ? `${name} (outline)` : name;
    },
    operator: () => null,
  },
};

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const limit = Number(readFlag('--limit') || Infinity);
const only = (readFlag('--only') || '2d,3d').split(',').map((value) => value.trim()).filter(Boolean);
for (const key of only) if (!PACKAGES[key]) throw new Error(`Unknown package '${key}'. Choose 2d or 3d.`);

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed && trimmed !== ' ' ? trimmed : null;
}

async function readShapes(path) {
  const buffer = await readFile(path);
  const shapeType = buffer.readInt32LE(32);
  const polyline = [3, 13, 23].includes(shapeType);
  const polygon = [5, 15, 25].includes(shapeType);
  if (!polyline && !polygon) throw new Error(`${path}: unsupported shape type ${shapeType}`);
  const shapes = [];
  let offset = 100;
  while (offset + 8 <= buffer.length) {
    const words = buffer.readInt32BE(offset + 4);
    const body = offset + 8;
    const type = buffer.readInt32LE(body);
    if (type !== 0 && (polyline || polygon)) {
      const numParts = buffer.readInt32LE(body + 36);
      const numPoints = buffer.readInt32LE(body + 40);
      const partsAt = body + 44;
      const pointsAt = partsAt + 4 * numParts;
      const parts = [];
      for (let index = 0; index < numParts; index += 1) parts.push(buffer.readInt32LE(partsAt + 4 * index));
      parts.push(numPoints);
      const paths = [];
      for (let index = 0; index < parts.length - 1; index += 1) {
        const from = parts[index];
        const to = parts[index + 1];
        const points = [];
        for (let p = from; p < to; p += 1) {
          points.push([buffer.readDoubleLE(pointsAt + 16 * p), buffer.readDoubleLE(pointsAt + 16 * p + 8)]);
        }
        if (points.length >= 2) paths.push(points);
      }
      shapes.push({ polygon, paths });
    }
    offset = body + words * 2;
  }
  return shapes;
}

async function readAttributes(path, cpg) {
  let encoding = 'windows-1252';
  if (cpg) {
    try {
      const label = (await readFile(cpg, 'utf8')).trim().toLowerCase();
      if (label.includes('utf')) encoding = 'utf-8';
    } catch {
      // default encoding stands
    }
  }
  const decoder = new TextDecoder(encoding);
  const buffer = await readFile(path);
  const count = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let offset = 32; offset < headerLength - 1; offset += 32) {
    if (buffer[offset] === 0x0d) break;
    const name = decoder.decode(buffer.subarray(offset, offset + 11)).split('\u0000')[0].trim();
    const length = buffer[offset + 16];
    fields.push({ name, length });
  }
  const records = [];
  for (let index = 0; index < count; index += 1) {
    const start = headerLength + index * recordLength + 1;
    if (start >= buffer.length) break;
    if (buffer[start - 1] === 0x2a) continue;
    let cursor = start;
    const record = {};
    for (const field of fields) {
      const raw = decoder.decode(buffer.subarray(cursor, cursor + field.length));
      cursor += field.length;
      const value = raw.replace(/\u0000/g, '').trim();
      record[field.name] = value === '' ? null : value;
    }
    records.push(record);
  }
  return records;
}

function largestPath(paths) {
  let best = null;
  let bestLength = -1;
  for (const path of paths) {
    let length = 0;
    for (let index = 1; index < path.length; index += 1) {
      length += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]);
    }
    if (length > bestLength) {
      bestLength = length;
      best = path;
    }
  }
  return best;
}

function largestRing(rings) {
  let best = null;
  let bestArea = 0;
  for (const ring of rings) {
    let area = 0;
    for (let index = 1; index < ring.length; index += 1) {
      area += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
    }
    area = Math.abs(area) / 2;
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

function closeRing(ring) {
  if (!ring || ring.length < 4) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
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

async function existingSurveys(key) {
  const response = await fetch(`${host}/api/seismic-surveys?names=true`, { headers: { 'X-Atlasio-Key': key } });
  const body = await response.json();
  const items = Array.isArray(body) ? body : body.names || [];
  return {
    names: new Set(items.map((item) => item.name)),
    identities: new Set(items.map((item) => item.identity).filter(Boolean)),
  };
}

const key = await resolveImporterKey();
const existing = await existingSurveys(key);
const names = existing.names;
const identities = existing.identities;
let total = { created: 0, skipped: 0, failed: 0 };
const seen = new Set();

for (const keyName of only) {
  const pack = PACKAGES[keyName];
  console.log(`\n${keyName}: reading ${pack.shp.split('/').pop()}`);
  const shapes = await readShapes(pack.shp);
  const records = await readAttributes(pack.dbf, pack.cpg);
  console.log(`  ${shapes.length} shapes, ${records.length} attribute rows`);
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (let index = 0; index < Math.min(shapes.length, limit); index += 1) {
    const shape = shapes[index];
    const record = records[index] || {};
    const geometry = pack.kind === '2d'
      ? largestPath(shape.paths)
      : closeRing(largestRing(shape.paths));
    const name = pack.name(record, names);
    if (!geometry || !name) {
      skipped += 1;
      continue;
    }
    // The source index repeats a few line rows verbatim; collapse them by
    // the source identity rather than importing the same geometry twice.
    const identity = record.UKOGL_LINE || record.LINENAME || record.LINE_NAME || name;
    if (names.has(name) || identities.has(identity) || seen.has(identity)) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      created += 1;
      continue;
    }
    const payload = {
      name,
      kind: pack.kind,
      source_crs: 'EPSG:27700',
      footprint: pack.kind === '2d'
        ? { type: 'LineString', coordinates: geometry }
        : { type: 'Polygon', coordinates: [geometry] },
      license: OGL,
      confidentiality: 'public',
      operator: pack.operator(record),
      attributes: record,
    };
    try {
      const response = await fetch(`${host}/api/seismic-surveys`, {
        method: 'POST',
        headers: { 'X-Atlasio-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        failed += 1;
        if (failed <= 5) console.error(`  ${name}: ${response.status} ${await response.text().catch(() => '')}`);
        continue;
      }
      names.add(name);
      identities.add(identity);
      seen.add(identity);
      created += 1;
    } catch (error) {
      failed += 1;
      if (failed <= 5) console.error(`  ${name}: ${error.message}`);
    }
    if ((created + skipped + failed) % 250 === 0) {
      process.stdout.write(`\r  posted ${created}/${Math.min(shapes.length, limit)}`);
    }
  }
  process.stdout.write('\n');
  console.log(`  created=${created} skipped=${skipped} failed=${failed}${dryRun ? ' (dry run)' : ''}`);
  total = { created: total.created + created, skipped: total.skipped + skipped, failed: total.failed + failed };
}

console.log(`\nDone: created=${total.created} skipped=${total.skipped} failed=${total.failed}`);
if (total.failed > 0) process.exitCode = 1;
