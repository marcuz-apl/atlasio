import { Map, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { feature } from 'topojson-client';
import world from 'world-atlas/land-110m.json';
import './style.css';

setWorkerUrl(workerUrl);

const $ = (selector) => document.querySelector(selector);
const keyInput = $('#api-key');
let currentRole = null;
keyInput.value = sessionStorage.getItem('atlasio-key') || '';
const notice = (message, error = false) => {
  const element = $('#notice');
  element.textContent = message;
  element.className = error ? 'error' : 'success';
};

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'X-Atlasio-Key': keyInput.value, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || JSON.stringify(data.detail || data));
  return data;
}

function textNode(tag, value, className = '') {
  const node = document.createElement(tag);
  node.textContent = value ?? 'Unknown';
  node.className = className;
  return node;
}

const graticule = { type: 'FeatureCollection', features: [] };
for (let lon = -180; lon <= 180; lon += 30) {
  graticule.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: Array.from({ length: 37 }, (_, i) => [lon, -90 + i * 5]) }, properties: {} });
}
for (let lat = -60; lat <= 60; lat += 30) {
  graticule.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) }, properties: {} });
}

const map = new Map({
  container: 'map',
  style: { version: 8, sources: { land: { type: 'geojson', data: feature(world, world.objects.land) }, grid: { type: 'geojson', data: graticule }, wells: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#eaf1f1' } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#d5e3db', 'fill-outline-color': '#afc4bb' } },
    { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#c9d9d8', 'line-width': 1 } },
    { id: 'wells-halo', type: 'circle', source: 'wells', paint: { 'circle-radius': 10, 'circle-color': '#fff', 'circle-stroke-color': '#176873', 'circle-stroke-width': 2 } },
    { id: 'wells', type: 'circle', source: 'wells', paint: { 'circle-radius': 5, 'circle-color': '#176873' } },
  ] },
  center: [0, 12], zoom: 1.1,
});
map.addControl(new NavigationControl(), 'top-right');
map.on('click', 'wells', (event) => openWell(event.features[0].properties.well_id));
map.on('mouseenter', 'wells', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'wells', () => { map.getCanvas().style.cursor = ''; });

async function refreshMap() {
  const features = await api('/map/wells');
  if (!map.isStyleLoaded()) await new Promise(resolve => map.once('load', resolve));
  map.getSource('wells').setData(features);
}

async function search() {
  const q = $('#search').value;
  const wells = await api(`/wells/search?q=${encodeURIComponent(q)}`);
  const container = $('#results');
  container.replaceChildren();
  if (!wells.length) container.append(textNode('p', 'No approved wells found.', 'muted'));
  for (const well of wells) {
    const button = textNode('button', `${well.name} · v${well.version_no} · ${well.external_id || 'No external ID'}`, 'result');
    button.onclick = () => {
      map.flyTo({ center: [well.longitude, well.latitude], zoom: 6 });
      openWell(well.id);
    };
    container.append(button);
  }
}

async function openWell(id) {
  const well = await api(`/wells/${id}`);
  const container = $('#record');
  container.replaceChildren();
  container.append(textNode('h3', well.versions[0].name));
  for (const version of well.versions) {
    const card = document.createElement('div');
    card.className = 'version';
    card.append(textNode('strong', `Version ${version.version_no}${version.id === well.current_version_id ? ' · Current' : ''}`));
    card.append(textNode('p', `Aliases: ${version.aliases.join(', ') || 'None'} · External ID: ${version.external_id || 'Unknown'}`));
    card.append(textNode('p', `Source: ${version.source} · CRS: ${version.source_crs} · Source (${version.source_x}, ${version.source_y})`));
    card.append(textNode('p', `Display (${version.longitude}, ${version.latitude}) · Operation: ${version.transform_operation}`));
    card.append(textNode('p', `Original: ${version.original_name} · SHA-256: ${version.sha256}`));
    card.append(textNode('p', `License: ${version.license} · Confidentiality: ${version.confidentiality}`));
    card.append(textNode('p', `Reviewed by ${version.reviewer} · ${new Date(version.published_at).toLocaleString()}`));
    for (const finding of version.qc) card.append(textNode('p', `${finding.severity.toUpperCase()}: ${finding.message}`, `finding ${finding.severity}`));
    const file = textNode('button', 'Download original', 'secondary');
    file.onclick = async () => {
      try {
        const response = await fetch(`/api/files/${version.file_id}`, { headers: { 'X-Atlasio-Key': keyInput.value } });
        if (!response.ok) throw new Error((await response.json()).detail);
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a'); link.href = url; link.download = version.original_name; link.click(); URL.revokeObjectURL(url);
      } catch (error) { notice(error.message, true); }
    };
    if (version.download_allowed) card.append(file);
    container.append(card);
  }
}

async function refreshImports() {
  const items = await api('/imports');
  const container = $('#imports');
  container.replaceChildren();
  const active = items.filter(item => item.status === 'staged' || item.status === 'submitted');
  if (!active.length) container.append(textNode('p', 'No imports awaiting action.', 'muted'));
  for (const item of active) {
    const card = document.createElement('div'); card.className = 'import-card';
    card.append(textNode('strong', item.manifest.name || 'Unnamed well'));
    card.append(textNode('span', item.status, 'pill'));
    for (const finding of item.qc) card.append(textNode('p', `${finding.severity.toUpperCase()}: ${finding.message}`, `finding ${finding.severity}`));
    if (item.status === 'staged' && currentRole === 'importer') {
      const correction = document.createElement('textarea'); correction.placeholder = 'Correct metadata as JSON, e.g. {"source_crs":"EPSG:4326"}';
      card.append(correction);
      const fix = textNode('button', 'Save correction', 'secondary');
      fix.onclick = () => act(async () => api(`/imports/${item.id}`, { method: 'PATCH', body: correction.value }), 'Correction saved');
      const submit = textNode('button', 'Submit for review');
      submit.onclick = () => act(async () => api(`/imports/${item.id}/submit`, { method: 'POST' }), 'Submitted for review');
      card.append(fix, submit);
    }
    if (item.status === 'submitted' && currentRole === 'reviewer') {
      const resolution = document.createElement('select');
      resolution.append(new Option('Publish as new well', 'new'));
      for (const finding of item.qc.filter(finding => finding.code === 'possible_duplicate' && finding.well_id)) {
        resolution.append(new Option(`New version of ${finding.well_id}`, finding.well_id));
      }
      const reason = document.createElement('input'); reason.placeholder = 'Review reason';
      const approve = textNode('button', 'Approve and publish');
      approve.onclick = () => act(async () => api(`/imports/${item.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve', identity_resolution: resolution.value, reason: reason.value }) }), 'Published');
      const reject = textNode('button', 'Reject', 'secondary');
      reject.onclick = () => act(async () => api(`/imports/${item.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'reject', reason: reason.value }) }), 'Rejected');
      card.append(resolution, reason, approve, reject);
    }
    container.append(card);
  }
}

async function act(action, success) {
  try { await action(); notice(success); await Promise.allSettled([...(currentRole === 'reader' ? [] : [refreshImports()]), search(), refreshMap()]); }
  catch (error) { notice(error.message, true); }
}

async function connect() {
  try {
    const { role } = await api('/me');
    currentRole = role;
    sessionStorage.setItem('atlasio-key', keyInput.value);
    $('#stage-panel').hidden = role !== 'importer';
    $('#review-panel').hidden = role === 'reader';
    $('#refresh-imports').disabled = role === 'reader';
    notice(`Connected as ${role}`);
    await Promise.all([search(), refreshMap(), ...(role === 'reader' ? [] : [refreshImports()])]);
  } catch (error) { notice(error.message, true); }
}

$('#stage-form').onsubmit = async (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const file = data.get('file');
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
  });
  const manifest = {
    name: data.get('name'), external_id: data.get('external_id'), aliases: data.get('aliases').split(',').map(x => x.trim()).filter(Boolean),
    source: data.get('source'), license: data.get('license'), confidentiality: data.get('confidentiality'), download_allowed: data.has('download_allowed'),
    source_crs: data.get('source_crs'), x: Number(data.get('x')), y: Number(data.get('y')),
  };
  await act(async () => api('/imports', { method: 'POST', body: JSON.stringify({ manifest, file_name: file.name, file_base64: base64 }) }), 'Package staged');
};

$('#connect').onclick = connect;
$('#refresh-imports').onclick = () => act(async () => {}, 'Queue refreshed');
$('#search-button').onclick = () => search().catch(error => notice(error.message, true));
$('#search').onkeydown = (event) => { if (event.key === 'Enter') search().catch(error => notice(error.message, true)); };
if (keyInput.value) connect();
