import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { createWellMap } from '../lib/maps.js';
import {
  namedCountries,
  countryByName,
  findCountryAt,
  wellsWithin,
  nearbyWells,
  circlePolygon,
  countryAreaFeature,
} from '../lib/geo.js';
import { formatCount, formatPoint } from '../lib/format.js';
import { $, el, icon, toast } from '../lib/ui.js';

const groups = [
  {
    title: 'Wells & operations',
    icon: 'ops',
    items: [
      ['ep_projects', 'E&P projects'],
      ['wells', 'Wells'],
      ['well_versions', 'Well versions'],
      ['drilling_records', 'Drilling records'],
      ['horizontal_wells', 'Horizontal wells'],
      ['production_records', 'Production records'],
    ],
  },
  {
    title: 'Well data',
    icon: 'well',
    items: [
      ['logs', 'Well logs'],
      ['formation_tops', 'Formation tops'],
      ['interpretations', 'Well interpretations'],
    ],
  },
  {
    title: 'Seismic',
    icon: 'seismic',
    items: [
      ['seismic_surveys', 'Seismic surveys'],
      ['seismic_2d_lines', '2D seismic lines'],
      ['seismic_3d_cubes', '3D seismic cubes'],
      ['seismic_interpretations', 'Seismic interpretations'],
    ],
  },
  {
    title: 'Documents & deals',
    icon: 'doc',
    items: [
      ['reports', 'Reports'],
      ['ma_reports', 'M&A reports'],
      ['concession_maps', 'Concession maps'],
      ['original_files', 'Original files'],
    ],
  },
];

const totalMetrics = groups.reduce((sum, group) => sum + group.items.length, 0);

let map = null;
let navigate = () => {};
let visibleWells = { type: 'FeatureCollection', features: [] };
let firstWells = true;
let loadingFallback = null;

export function initDashboard({ onNavigate } = {}) {
  navigate = onNavigate || navigate;

  map = createWellMap('#map', {
    onSelect: (featureObject) => showPreview(featureObject),
    onEmpty: () => hidePreview(),
    onReady: () => {
      $('#map-loading')?.setAttribute('hidden', '');
      if (loadingFallback) clearTimeout(loadingFallback);
    },
  });
  loadingFallback = setTimeout(() => {
    $('#map-loading')?.setAttribute('hidden', '');
  }, 7000);

  const select = $('#area-select');
  for (const country of namedCountries) {
    select.append(new Option(country.properties.name, country.properties.name));
  }

  select.addEventListener('change', () => {
    const value = select.value;
    if (value === 'global') {
      applyGlobal();
    } else if (value === 'current') {
      locate();
    } else {
      const country = countryByName(value);
      if (country) applyCountry(country);
      else applyGlobal();
    }
  });

  $('#locate-button').addEventListener('click', locate);

  renderCoverage(null);
  if (map) map.setWells(state.wells);
}

export function setWells(collection) {
  state.wells = collection || { type: 'FeatureCollection', features: [] };
  if (!map) return;

  if (state.area.mode === 'country' && state.area.country) {
    visibleWells = wellsWithin(state.wells, state.area.country);
    map.setWells(visibleWells);
    updateVisibleCount();
    updateAreaSource();
  } else if (state.area.mode === 'nearby' && state.area.point) {
    visibleWells = nearbyWells(state.wells, state.area.point[0], state.area.point[1], 150);
    map.setWells(visibleWells);
    updateVisibleCount();
    updateAreaSource();
  } else {
    visibleWells = state.wells;
    map.setWells(state.wells);
    updateVisibleCount();
    if (firstWells) map.fitWells(state.wells);
  }
  firstWells = false;
}

export async function refreshCounts({ silent = false } = {}) {
  try {
    const query =
      state.area.mode === 'global'
        ? ''
        : `?area=true&well_ids=${visibleWells.features.map((item) => item.properties.well_id).join(',')}`;
    const data = await api(`/dashboard${query}`);
    renderCoverage(data);
    return data;
  } catch (error) {
    renderCoverage(null, { failed: true });
    if (!silent) toast(error.message, 'error');
    return null;
  }
}

function applyGlobal() {
  state.area = { mode: 'global', country: null, point: null, label: 'Global overview' };
  visibleWells = state.wells;
  hidePreview();
  map?.setArea(null);
  map?.setLocation(null);
  map?.setWells(state.wells);
  map?.fitWells(state.wells);
  const select = $('#area-select');
  if (select) select.value = 'global';
  const scope = $('#coverage-scope');
  if (scope) scope.textContent = 'GLOBAL';
  const source = $('#area-source');
  if (source) source.textContent = 'Global catalog · all records visible to your role';
  const title = $('#map-area-title');
  if (title) title.textContent = 'Published wells';
  updateVisibleCount();
  refreshCounts();
}

function applyCountry(country, { point = null, origin = 'select' } = {}) {
  const visible = wellsWithin(state.wells, country);
  visibleWells = visible;
  state.area = {
    mode: 'country',
    country,
    point,
    label: country.properties.name,
  };
  hidePreview();
  const areaFeature = countryAreaFeature(country);
  map?.setArea(areaFeature);
  map?.setWells(visible);
  map?.setSelected(null);
  map?.setLocation(point);

  const select = $('#area-select');
  if (select) select.value = country.properties.name;
  const scope = $('#coverage-scope');
  if (scope) scope.textContent = country.properties.name.toUpperCase();
  const title = $('#map-area-title');
  if (title) title.textContent = country.properties.name;
  updateVisibleCount();
  updateAreaSource(origin);
  refreshCounts();
}

function applyNearby(longitude, latitude) {
  const radiusKm = 150;
  const areaFeature = circlePolygon(longitude, latitude, radiusKm);
  const visible = nearbyWells(state.wells, longitude, latitude, radiusKm);
  visibleWells = visible;
  state.area = {
    mode: 'nearby',
    country: null,
    point: [longitude, latitude],
    label: 'Near your location',
  };
  hidePreview();
  map?.setArea(areaFeature);
  map?.setWells(visible);
  map?.setSelected(null);
  map?.setLocation([longitude, latitude]);
  const select = $('#area-select');
  if (select) select.value = 'current';
  const scope = $('#coverage-scope');
  if (scope) scope.textContent = 'NEARBY';
  const title = $('#map-area-title');
  if (title) title.textContent = 'Near your location';
  updateVisibleCount();
  updateAreaSource('location');
  refreshCounts();
}

function updateVisibleCount() {
  const count = visibleWells.features.length;
  const target = $('#landing-well-count');
  if (target) target.textContent = formatCount(count);
}

function updateAreaSource(origin = 'select') {
  const source = $('#area-source');
  if (!source) return;
  const count = visibleWells.features.length;
  if (state.area.mode === 'country') {
    source.textContent =
      origin === 'location'
        ? `${state.area.country.properties.name} · area detected from your current location`
        : `${state.area.country.properties.name} · country boundary · ${formatCount(count)} wells inside`;
  } else if (state.area.mode === 'nearby') {
    source.textContent = `Within 150 km of your location · ${formatCount(count)} wells nearby`;
  } else {
    source.textContent = 'Global catalog · all records visible to your role';
  }
}

async function locate() {
  const button = $('#locate-button');
  const label = button?.querySelector('span');
  if (!navigator.geolocation) {
    toast('This browser does not provide location access. Choose a country instead.', 'error');
    return resetSelect();
  }
  if (button) button.disabled = true;
  if (label) label.textContent = 'Locating…';
  const select = $('#area-select');
  if (select) select.value = 'current';

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const country = findCountryAt(coords.longitude, coords.latitude);
      if (country) {
        applyCountry(country, { point: [coords.longitude, coords.latitude], origin: 'location' });
        map?.map.easeTo({
          center: [coords.longitude, coords.latitude],
          zoom: Math.max(map?.map.getZoom() || 0, 3.6),
          duration: 900,
        });
        toast(`Area set to ${country.properties.name}.`, 'success');
      } else {
        applyNearby(coords.longitude, coords.latitude);
        toast('No country boundary detected; showing wells within 150 km.', 'info');
      }
      finish();
    },
    () => {
      toast('Location was unavailable. Choose a country or allow access.', 'error');
      resetSelect();
      finish();
    },
    { timeout: 10000, maximumAge: 120000 },
  );

  function finish() {
    if (button) button.disabled = false;
    if (label) label.textContent = 'Locate';
  }
}

function resetSelect() {
  const select = $('#area-select');
  if (!select) return;
  select.value = state.area.mode === 'country' ? state.area.country.properties.name : 'global';
}

function renderCoverage(data, { failed = false } = {}) {
  const host = $('#coverage-groups');
  const summary = $('#coverage-summary');
  if (!host) return;
  host.replaceChildren();

  let available = 0;
  for (const group of groups) {
    const section = el('section', 'coverage-group');
    const head = el('div', 'coverage-group-head');
    head.append(icon(group.icon));
    head.append(el('h3', '', group.title));
    section.append(head);

    const items = el('div', 'coverage-items');
    for (const [key, label] of group.items) {
      const entry = data?.counts?.[key];
      const isAvailable = entry?.state === 'available';
      if (isAvailable) available += 1;
      const metric = el('div', `metric ${isAvailable ? 'available' : 'planned'}`);
      const labelNode = el('span', 'metric-label', label);
      labelNode.title = isAvailable ? `${label} in the catalog` : `${label} is not cataloged yet`;
      const value = el(
        'span',
        'metric-value',
        isAvailable ? formatCount(entry.value) : '—',
      );
      metric.append(labelNode, value);
      items.append(metric);
    }
    section.append(items);
    host.append(section);
  }

  if (!summary) return;
  summary.replaceChildren();
  if (failed) {
    summary.textContent = 'Counts unavailable. Check the API connection and try again.';
    return;
  }
  if (!data) {
    summary.textContent = 'Reading the catalog…';
    return;
  }
  const strong = el('strong', '', `${available}`);
  summary.append(strong, document.createTextNode(` of ${totalMetrics} categories cataloged`));
}

export function showPreview(featureObject) {
  const card = $('#map-preview');
  if (!card) return;
  const { name, well_id: wellId, version_no: versionNo } = featureObject.properties;
  const [longitude, latitude] = featureObject.geometry.coordinates;

  map?.setSelected(wellId);
  card.replaceChildren();

  const head = el('div', 'preview-head');
  const title = el('strong', '', name);
  const close = el('button', 'copy-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close record preview');
  close.append(icon('close'));
  close.addEventListener('click', hidePreview);
  head.append(title, close);

  const list = el('dl');
  const rows = [
    ['VERSION', `v${versionNo}`],
    ['POSITION', formatPoint(longitude, latitude)],
    ['DISPLAY CRS', 'EPSG:4326'],
  ];
  for (const [term, value] of rows) {
    list.append(el('dt', '', term), el('dd', '', value));
  }

  const link = document.createElement('a');
  link.className = 'btn btn-primary';
  link.href = `#/workspace/explore?well=${wellId}`;
  link.append(document.createTextNode('Inspect in Workspace'), icon('arrow-right'));
  link.addEventListener('click', () => {
    hidePreview();
    navigate(link.getAttribute('href'));
  });

  card.append(head, list, link);
  card.hidden = false;
}

export function hidePreview() {
  const card = $('#map-preview');
  if (card) {
    card.hidden = true;
    card.replaceChildren();
  }
  map?.setSelected(null);
}
