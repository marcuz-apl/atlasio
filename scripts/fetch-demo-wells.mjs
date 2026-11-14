import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = path.join(root, 'demo-data');
const host = process.env.ATLASIO_URL || 'http://localhost:3040';
const flags = new Set(process.argv.slice(2));
const shouldStage = flags.has('--stage');
const requestedLimit = Number(readFlag('--limit') || 12);
const limitPerSource = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : 12;

const SODIR_QUERY = 'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/FeatureServer/201/query';
const SODIR_FIELDS = [
  'wlbWellboreName',
  'wlbNpdidWellbore',
  'wlbWell',
  'wlbDrillingOperator',
  'wlbPurpose',
  'wlbStatus',
  'wlbContent',
  'wlbWellType',
  'wlbEntryDate',
  'wlbCompletionDate',
  'wlbField',
  'wlbDiscovery',
  'wlbMaxInclation',
  'wlbKellyBushElevation',
  'wlbFinalVerticalDepth',
  'wlbTotalDepth',
  'wlbWaterDepth',
];
const SODIR_FIELDS_FILTER = "wlbField IN ('TROLL','JOHAN SVERDRUP','GULLFAKS','OSEBERG','EKOFISK','VALHALL','SNORRE','NORNE')";

const NSTA_QUERY = 'https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS_offshore_wellbore_top_holes_(WGS84)/FeatureServer/0/query';
const NSTA_FIELDS = [
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

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function slug(value) {
  return String(value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isoDate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : null;
}

async function fetchJson(url, params) {
  const query = new URLSearchParams({ ...params, f: 'geojson' });
  const response = await fetch(`${url}?${query}`, { headers: { Accept: 'application/geo+json, application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  const value = await response.json().catch(() => null);
  if (!value || !Array.isArray(value.features)) throw new Error(`No GeoJSON features from ${url}`);
  return value.features;
}

function coordinates(feature, source) {
  const point = feature?.geometry?.coordinates;
  if (!Array.isArray(point) || point.length < 2) throw new Error(`${source}: missing point geometry`);
  const [x, y] = point;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -180 || x > 180 || y < -90 || y > 90) {
    throw new Error(`${source}: coordinates outside EPSG:4326 bounds`);
  }
  return { x, y };
}

function pickSodir(features, limit) {
  const valid = features.filter((feature) => feature?.properties?.wlbWellboreName);
  const picked = [];
  const seen = new Set();
  const add = (feature) => {
    const name = feature.properties.wlbWellboreName;
    if (seen.has(name) || picked.length >= limit) return;
    seen.add(name);
    picked.push(feature);
  };
  const byField = new Map();
  for (const feature of valid) {
    const field = feature.properties.wlbField || 'OTHER';
    if (!byField.has(field)) byField.set(field, []);
    byField.get(field).push(feature);
  }
  for (const field of [...byField.keys()].sort()) add(byField.get(field)[0]);
  const inclined = [...valid].sort((a, b) => (b.properties.wlbMaxInclation || 0) - (a.properties.wlbMaxInclation || 0));
  for (const feature of inclined) add(feature);
  const development = valid.filter((feature) => feature.properties.wlbWellType === 'DEVELOPMENT');
  for (const feature of development) add(feature);
  for (const feature of valid) add(feature);
  return picked;
}

async function sodirItems(limit) {
  const features = await fetchJson(SODIR_QUERY, {
    where: SODIR_FIELDS_FILTER,
    outFields: SODIR_FIELDS.join(','),
    returnGeometry: 'true',
    resultRecordCount: '500',
  });
  return pickSodir(features, limit).map((feature) => {
    const values = feature.properties;
    const { x, y } = coordinates(feature, `Sodir ${values.wlbWellboreName}`);
    const name = String(values.wlbWellboreName).trim();
    const aliases = [values.wlbWell, values.wlbDiscovery]
      .map((value) => (value ? String(value).trim() : ''))
      .filter((value) => value && value !== name);
    return {
      sourceKey: 'sodir',
      manifest: {
        name,
        aliases: [...new Set(aliases)],
        external_id: `SODIR:${values.wlbNpdidWellbore}`,
        source: 'Norwegian Offshore Directorate (Sodir) FactPages',
        license: 'NLOD 2.0 — https://data.norge.no/nlod/en/2.0',
        confidentiality: 'public',
        download_allowed: true,
        source_crs: 'EPSG:4326',
        x,
        y,
      },
      fileName: `${slug(name)}.sodir.json`,
      record: {
        retrieved_at: new Date().toISOString(),
        source: 'Sodir FactMaps WGS84 wellbores (layer 201)',
        source_url: 'https://factpages.sodir.no/en/wellbore',
        license: 'NLOD 2.0',
        feature,
        summary: {
          field: values.wlbField ?? null,
          operator: values.wlbDrillingOperator ?? null,
          purpose: values.wlbPurpose ?? null,
          status: values.wlbStatus ?? null,
          content: values.wlbContent ?? null,
          type: values.wlbWellType ?? null,
          entry_date: isoDate(values.wlbEntryDate),
          completion_date: isoDate(values.wlbCompletionDate),
          max_inclination_deg: values.wlbMaxInclation ?? null,
          kelly_bush_elevation_m: values.wlbKellyBushElevation ?? null,
          total_depth_m: values.wlbTotalDepth ?? null,
          final_vertical_depth_m: values.wlbFinalVerticalDepth ?? null,
          water_depth_m: values.wlbWaterDepth ?? null,
        },
      },
    };
  });
}

async function nstaItems(limit) {
  const features = await fetchJson(NSTA_QUERY, {
    where: "OPEN_DATA='Y' AND WELLREGNO IS NOT NULL",
    outFields: NSTA_FIELDS.join(','),
    returnGeometry: 'true',
    resultRecordCount: String(Math.max(limit * 3, 30)),
  });
  const items = [];
  const seen = new Set();
  for (const feature of features) {
    if (items.length >= limit) break;
    const values = feature.properties;
    const name = String(values.WELLREGNO || '').replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const { x, y } = coordinates(feature, `NSTA ${name}`);
    const alias = values.NAME ? String(values.NAME).trim() : '';
    items.push({
      sourceKey: 'nsta',
      manifest: {
        name,
        aliases: alias && alias !== name ? [alias] : [],
        external_id: `NSTA:${name.replace(/\s+/g, '')}`,
        source: 'North Sea Transition Authority (NSTA) Open Data',
        license: 'Open Government Licence v3.0 — https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        confidentiality: 'public',
        download_allowed: true,
        source_crs: 'EPSG:4326',
        x,
        y,
      },
      fileName: `${slug(name)}.nsta.json`,
      record: {
        retrieved_at: new Date().toISOString(),
        source: 'NSTA UKCS offshore wellbores top holes (WGS84)',
        source_url: 'https://open-data-ukcs-transition.hub.arcgis.com/',
        license: 'Open Government Licence v3.0',
        feature,
        summary: {
          name: values.NAME ?? null,
          intent: values.ORIGINTENT ?? null,
          deviation: values.DEVIATTYP ?? null,
          status: values.WELLOPSTAT ?? null,
          operator: values.SUBAREAOP ?? null,
          target_field: values.TARGETFLD ?? null,
          spud_date: isoDate(values.SPUDDATE),
          completion_date: isoDate(values.COMPLEDATE),
          total_depth_m: values.TDMDDEPM ?? null,
          tvd_ss_m: values.TDTVDSSM ?? null,
        },
      },
    });
  }
  return items;
}

async function demoKeys() {
  const response = await fetch(`${host}/api/demo-profiles`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Cannot load demo profiles: ${response.status}`);
  const items = await response.json();
  const keys = Object.fromEntries(items.map((item) => [item.role, item.key]));
  if (!keys.importer || !keys.reviewer) throw new Error('Importer or reviewer demo key missing');
  return keys;
}

async function api(pathname, key, method = 'GET', body) {
  const response = await fetch(`${host}/api${pathname}`, {
    method,
    headers: { 'X-Atlasio-Key': key, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  return { status: response.status, value };
}

async function stageOne(item, keys) {
  const search = await api(`/wells/search?q=${encodeURIComponent(item.manifest.external_id)}`, keys.importer);
  if (search.status === 200 && Array.isArray(search.value)) {
    const found = search.value.some((well) => well.external_id === item.manifest.external_id);
    if (found) return 'skipped';
  }
  const staged = await api('/imports', keys.importer, 'POST', {
    manifest: item.manifest,
    file_name: item.fileName,
    file_base64: Buffer.from(JSON.stringify(item.record, null, 2)).toString('base64'),
  });
  if (staged.status !== 200 || !staged.value?.id) {
    throw new Error(`stage failed (${staged.status}): ${JSON.stringify(staged.value)}`);
  }
  const submitted = await api(`/imports/${staged.value.id}/submit`, keys.importer, 'POST');
  if (submitted.status !== 200) {
    throw new Error(`submit failed (${submitted.status}): ${JSON.stringify(submitted.value)}`);
  }
  const reviewed = await api(`/imports/${staged.value.id}/review`, keys.reviewer, 'POST', {
    decision: 'approve',
    identity_resolution: 'new',
  });
  if (reviewed.status !== 200) {
    throw new Error(`review failed (${reviewed.status}): ${JSON.stringify(reviewed.value)}`);
  }
  return 'published';
}

async function main() {
  console.log(`Fetching up to ${limitPerSource} Sodir and ${limitPerSource} NSTA well headers…`);
  const items = [...(await sodirItems(limitPerSource)), ...(await nstaItems(limitPerSource))];
  for (const item of items) {
    const directory = path.join(outputRoot, item.sourceKey);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, item.fileName), JSON.stringify(item.record, null, 2));
  }
  console.log(`Wrote ${items.length} source records under ${path.relative(root, outputRoot)}/`);

  if (!shouldStage) {
    console.log('Fetched only. Re-run with --stage to submit and publish these wells.');
    return;
  }

  const keys = await demoKeys();
  let published = 0;
  let skipped = 0;
  const failures = [];
  for (const item of items) {
    try {
      const result = await stageOne(item, keys);
      if (result === 'published') published += 1;
      else skipped += 1;
      console.log(`${result.padEnd(9)} ${item.manifest.name}`);
    } catch (error) {
      failures.push({ name: item.manifest.name, message: error.message });
      console.error(`failed    ${item.manifest.name}: ${error.message}`);
    }
  }
  console.log(`Published ${published}, skipped ${skipped}, failed ${failures.length}.`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
