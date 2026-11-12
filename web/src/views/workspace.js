import { api, downloadFile } from '../lib/api.js';
import { state } from '../lib/state.js';
import { createWellMap, BASEMAPS } from '../lib/maps.js';
import {
  formatCount,
  formatDateTime,
  formatBytes,
  formatPoint,
  shortId,
  joinList,
} from '../lib/format.js';
import { $, $$, el, icon, toast, copyText, emptyState, skeletonRows } from '../lib/ui.js';

let map = null;
let navigate = () => {};
let catalogQuery = '';
let recordsQuery = '';
let catalogLoaded = false;
let recordsLoaded = false;
let inspectorId = null;
let fitDone = false;
let initialized = false;
let basemapFellBack = false;

const EXPLORE_KEY = 'atlasio-explore';

function defaultSettings() {
  return {
    basemap: null,
    symbol: 4.2,
    opacity: 100,
    overlays: { wells: true, graticule: true, borders: true, area: true },
    catalog: null,
    display: null,
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(EXPLORE_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch (error) {
    /* Storage can be blocked; defaults are fine. */
  }
  return defaultSettings();
}

let settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(EXPLORE_KEY, JSON.stringify(settings));
  } catch (error) {
    /* Optional persistence. */
  }
}

function initialBasemap() {
  return settings.basemap || (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'topo');
}

export function initWorkspace({ onNavigate } = {}) {
  if (initialized) return;
  initialized = true;
  navigate = onNavigate || navigate;

  $('#catalog-search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadCatalog($('#catalog-search')?.value.trim() || '');
  });

  $('#catalog-refresh')?.addEventListener('click', () => {
    loadCatalog(catalogQuery, { announce: true });
  });

  $('#records-search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadRecords($('#records-search')?.value.trim() || '');
  });

  initExploreControls();

  const inspector = $('#inspector');
  inspector?.addEventListener('click', async (event) => {
    const close = event.target.closest('[data-close-inspector]');
    if (close) {
      closeInspector();
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      const ok = await copyText(copy.dataset.copy);
      toast(ok ? 'Copied to clipboard.' : 'Copy was blocked by the browser.', ok ? 'success' : 'error');
      return;
    }
    const download = event.target.closest('[data-download]');
    if (download) {
      download.disabled = true;
      try {
        await downloadFile(download.dataset.download, download.dataset.fileName);
        toast('Download started.', 'success');
      } catch (error) {
        toast(error.message, 'error');
      } finally {
        download.disabled = false;
      }
      return;
    }
    const retry = event.target.closest('[data-retry-well]');
    if (retry) {
      openInspector(retry.dataset.retryWell);
      return;
    }
    const openRecords = event.target.closest('[data-open-records]');
    if (openRecords) {
      const name = openRecords.dataset.openRecords || '';
      recordsQuery = name;
      const input = $('#records-search');
      if (input) input.value = name;
      navigate('#/workspace/records');
    }
  });
}

function initExploreControls() {
  const stage = $('#explore-stage');
  stage?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-action]');
    if (!button) return;
    const action = button.dataset.mapAction;
    if (action === 'zoom-in') map?.map.zoomIn();
    else if (action === 'zoom-out') map?.map.zoomOut();
    else if (action === 'fit') map?.fitWells(state.wells);
    else if (action === 'catalog') toggleDrawer('catalog');
    else if (action === 'display') toggleDrawer('display');
    else if (action === 'export') exportMap();
    else if (action === 'fullscreen') toggleFullscreen();
  });

  $('#basemap-select')?.addEventListener('change', (event) => {
    settings.basemap = event.target.value;
    saveSettings();
    basemapFellBack = false;
    map?.setBasemap(settings.basemap);
    syncBasemapNote();
  });

  for (const group of ['wells', 'graticule', 'borders', 'area']) {
    $(`#toggle-${group}`)?.addEventListener('change', (event) => {
      settings.overlays[group] = event.target.checked;
      saveSettings();
      map?.setOverlay(group, event.target.checked);
    });
  }

  $('#symbol-size')?.addEventListener('input', (event) => {
    settings.symbol = Number(event.target.value);
    const output = $('#symbol-size-value');
    if (output) output.textContent = `${settings.symbol.toFixed(1)} px`;
    saveSettings();
    map?.setSymbolSize(settings.symbol);
  });

  $('#well-opacity')?.addEventListener('input', (event) => {
    settings.opacity = Number(event.target.value);
    const output = $('#well-opacity-value');
    if (output) output.textContent = `${settings.opacity}%`;
    saveSettings();
    map?.setWellOpacity(settings.opacity);
  });

  const searchInput = $('#explore-search');
  searchInput?.addEventListener('input', () => renderSearchResults(searchInput.value.trim()));
  searchInput?.addEventListener('focus', () => renderSearchResults(searchInput.value.trim()));
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideSearchResults();
  });
  $('#explore-search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = searchInput?.value.trim() || '';
    const first = $('#explore-results')?.querySelector('[data-well-id]');
    if (first) {
      selectWell(first.dataset.wellId);
      hideSearchResults();
      if (searchInput) searchInput.value = '';
      return;
    }
    if (query) {
      loadCatalog(query);
      setDrawer('catalog', 'open');
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#explore-search-form')) hideSearchResults();
  });

  document.addEventListener('fullscreenchange', () => {
    const button = $('#fullscreen-toggle');
    const on = Boolean(document.fullscreenElement);
    button?.querySelector('use')?.setAttribute('href', on ? '#i-shrink' : '#i-expand');
    button?.setAttribute('aria-label', on ? 'Exit full screen' : 'Enter full screen');
    button?.setAttribute('title', on ? 'Exit full screen' : 'Full screen');
    requestAnimationFrame(() => map?.resize());
  });

  window.addEventListener('atlasio:theme', () => {
    if (!settings.basemap && map) {
      map.setBasemap(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'topo');
      syncBasemapNote();
    }
  });
}

function setDrawer(kind, value) {
  const stage = $('#explore-stage');
  if (!stage) return;
  stage.dataset[kind] = value;
  settings[kind] = value;
  saveSettings();
  const button = kind === 'catalog' ? $('#catalog-toggle') : $('#display-toggle');
  button?.setAttribute('aria-expanded', String(value === 'open'));
}

function toggleDrawer(kind) {
  const stage = $('#explore-stage');
  setDrawer(kind, stage?.dataset[kind] === 'open' ? 'closed' : 'open');
}

function applyExploreDefaults() {
  const stage = $('#explore-stage');
  if (!stage) return;
  const catalog = settings.catalog || (window.innerWidth >= 1240 ? 'open' : 'closed');
  const display = settings.display || (window.innerWidth >= 980 ? 'open' : 'closed');
  stage.dataset.catalog = catalog;
  stage.dataset.display = display;
  $('#catalog-toggle')?.setAttribute('aria-expanded', String(catalog === 'open'));
  $('#display-toggle')?.setAttribute('aria-expanded', String(display === 'open'));
}

function syncBasemapNote() {
  const note = $('#basemap-note');
  const select = $('#basemap-select');
  const key = map?.getBasemap() || initialBasemap();
  if (select && select.value !== key) select.value = key;
  if (note) {
    note.textContent = key === 'offline' ? 'Offline vector · Natural Earth' : `${BASEMAPS[key].label} · © Esri`;
  }
}

function syncDisplayControls() {
  const select = $('#basemap-select');
  if (select) select.value = settings.basemap || initialBasemap();
  for (const group of ['wells', 'graticule', 'borders', 'area']) {
    const box = $(`#toggle-${group}`);
    if (box) box.checked = Boolean(settings.overlays[group]);
  }
  const size = $('#symbol-size');
  if (size) size.value = String(settings.symbol);
  const sizeOut = $('#symbol-size-value');
  if (sizeOut) sizeOut.textContent = `${Number(settings.symbol).toFixed(1)} px`;
  const opacity = $('#well-opacity');
  if (opacity) opacity.value = String(settings.opacity);
  const opacityOut = $('#well-opacity-value');
  if (opacityOut) opacityOut.textContent = `${settings.opacity}%`;
  syncBasemapNote();
}

function exportMap() {
  const stamp = new Date().toISOString().slice(0, 10);
  const ok = map?.exportPNG(`atlasio-explore-${stamp}.png`);
  toast(ok ? 'Map exported as PNG.' : 'Export was blocked by the browser.', ok ? 'success' : 'error');
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
    return;
  }
  $('#explore-stage')?.requestFullscreen?.();
}

function updateRailZoom() {
  const node = $('#rail-zoom');
  if (node && map) node.textContent = map.map.getZoom().toFixed(1);
}

function renderSearchResults(query) {
  const host = $('#explore-results');
  if (!host) return;
  if (!query) {
    hideSearchResults();
    return;
  }
  const needle = query.toLowerCase();
  const source = state.catalog.length
    ? state.catalog.map((well) => ({ id: well.id, name: well.name, meta: well.external_id || well.source || '' }))
    : state.wells.features.map((item) => ({
        id: item.properties.well_id,
        name: item.properties.name,
        meta: '',
      }));
  const matches = source
    .filter((item) => item.name?.toLowerCase().includes(needle) || item.id?.toLowerCase().includes(needle) || item.meta?.toLowerCase().includes(needle))
    .slice(0, 8);
  host.replaceChildren();
  if (!matches.length) {
    host.append(el('p', 'explore-results-empty', `No wells match “${query}”.`));
  }
  for (const item of matches) {
    const button = el('button', 'explore-result');
    button.type = 'button';
    button.dataset.wellId = item.id;
    button.append(el('strong', '', item.name || 'Unnamed well'));
    if (item.meta) button.append(el('small', '', item.meta));
    button.addEventListener('click', () => {
      selectWell(item.id);
      hideSearchResults();
      const input = $('#explore-search');
      if (input) input.value = '';
    });
    host.append(button);
  }
  host.hidden = false;
}

function hideSearchResults() {
  const host = $('#explore-results');
  if (host) host.hidden = true;
}

export function ensureMap() {
  if (map) return map;
  map = createWellMap('#workspace-map-mount', {
    basemap: initialBasemap(),
    labels: true,
    onSelect: (featureObject) => {
      selectWell(featureObject.properties.well_id, { fly: false });
    },
    onEmpty: () => closeInspector(),
    onBasemapError: () => {
      if (basemapFellBack) return;
      basemapFellBack = true;
      settings.basemap = 'offline';
      saveSettings();
      map?.setBasemap('offline');
      syncBasemapNote();
      toast('Basemap tiles unreachable — switched to the offline vector map.', 'info');
    },
  });
  if (map) {
    map.setWells(state.wells);
    if (state.selectedWellId) map.setSelected(state.selectedWellId);
    map.setSymbolSize(settings.symbol);
    map.setWellOpacity(settings.opacity);
    for (const [group, on] of Object.entries(settings.overlays)) map.setOverlay(group, on);
    map.map.on('move', updateRailZoom);
    updateRailZoom();
    if (!fitDone && state.wells.features.length) {
      fitDone = true;
      requestAnimationFrame(() => map?.fitWells(state.wells));
    }
  }
  updateWellCount();
  return map;
}

export async function showTab(tab) {
  state.activeTab = tab;
  $$('.ws-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });

  $$('#workspace-tabs a').forEach((link) => {
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const view = $('#view-workspace');
  view?.classList.toggle('is-explore', tab === 'explore');
  document.body.classList.toggle('explore-active', tab === 'explore');

  if (tab !== 'explore') closeInspector({ updateHash: false });

  if (tab === 'explore') {
    applyExploreDefaults();
    syncDisplayControls();
    ensureMap();
    requestAnimationFrame(() => {
      map?.resize();
      updateRailZoom();
    });
    if (!catalogLoaded) await loadCatalog(catalogQuery);
    else renderCatalog();
  } else if (tab === 'records') {
    if (!recordsLoaded) await loadRecords(recordsQuery);
    else renderRecords();
  }
}

export async function loadCatalog(query = catalogQuery, { announce = false } = {}) {
  catalogQuery = query;
  const list = $('#catalog-list');
  if (list && !catalogLoaded) {
    list.replaceChildren(skeletonRows(5));
  }
  try {
    const results = await api(`/wells/search?q=${encodeURIComponent(query)}`);
    state.catalog = results;
    catalogLoaded = true;
    renderCatalog();
    if (!$('#workspace-well-count') || state.wells.features.length === 0) updateWellCount();
    if (announce) toast(`Catalog refreshed · ${formatCount(results.length)} wells.`, 'success');
    return results;
  } catch (error) {
    catalogLoaded = false;
    if (list) {
      list.replaceChildren(
        emptyState({
          title: 'Catalog unavailable',
          message: error.message,
          iconName: 'alert',
        }),
      );
    }
    if (announce) toast(error.message, 'error');
    return [];
  }
}

export function renderCatalog() {
  const list = $('#catalog-list');
  if (!list) return;
  list.replaceChildren();
  const count = $('#catalog-count');
  if (count) count.textContent = formatCount(state.catalog.length);

  if (!state.catalog.length) {
    list.append(
      emptyState({
        title: catalogQuery ? 'No wells match' : 'No approved wells yet',
        message: catalogQuery
          ? 'Try a different name, alias, or external ID.'
          : 'Publish a package from the review queue to see it here.',
        iconName: 'well',
      }),
    );
    return;
  }

  for (const well of state.catalog) {
    const button = el('button', 'well-item');
    button.type = 'button';
    button.dataset.wellId = well.id;
    if (well.id === state.selectedWellId) button.classList.add('is-active');

    const main = el('span', 'well-item-main');
    main.append(el('strong', '', well.name));
    const meta = el('small', '', `${well.external_id || 'No external ID'} · ${well.source || 'Source unknown'}`);
    meta.title = `${well.external_id || 'No external ID'} · ${well.source || 'Source unknown'}`;
    main.append(meta);

    const version = el('span', 'well-item-version', `v${well.version_no}`);
    button.append(main, version, icon('arrow-right'));
    button.title = `${well.name} · ${well.source || 'Source unknown'}`;
    button.addEventListener('click', () => {
      selectWell(well.id, { updateHash: true });
    });
    list.append(button);
  }
  if (state.selectedWellId) {
    list.querySelector('.well-item.is-active')?.scrollIntoView({ block: 'nearest' });
  }
}

export async function loadRecords(query = recordsQuery) {
  recordsQuery = query;
  const wrap = $('#records-table-wrap');
  if (wrap && !recordsLoaded) wrap.replaceChildren(skeletonRows(6));
  try {
    const results = await api(`/wells/search?q=${encodeURIComponent(query)}`);
    recordsLoaded = true;
    renderRecords(results);
    return results;
  } catch (error) {
    if (wrap) {
      wrap.replaceChildren(
        emptyState({ title: 'Records unavailable', message: error.message, iconName: 'alert' }),
      );
    }
    return [];
  }
}

function renderRecords(results) {
  const wrap = $('#records-table-wrap');
  if (!wrap) return;
  wrap.replaceChildren();
  if (!results.length) {
    wrap.append(
      emptyState({
        title: recordsQuery ? 'No records match' : 'No approved records yet',
        message: recordsQuery
          ? 'Try a different name, alias, or external ID.'
          : 'Approved wells appear here after review.',
        iconName: 'doc',
      }),
    );
    return;
  }

  const table = el('table', 'records-table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Well', 'Version', 'External ID', 'Display position', 'Source', 'CRS']) {
    headRow.append(el('th', '', label));
  }
  thead.append(headRow);

  const tbody = document.createElement('tbody');
  for (const record of results) {
    const row = document.createElement('tr');
    const nameCell = el('td');
    const open = el('button', 'link-btn');
    open.type = 'button';
    open.append(document.createTextNode(record.name), icon('arrow-right'));
    open.addEventListener('click', () => {
      navigate(`#/workspace/explore?well=${record.id}`);
    });
    nameCell.append(open);
    row.append(nameCell);
    row.append(el('td', 'cell-mono', `v${record.version_no}`));
    row.append(el('td', '', record.external_id || '—'));
    row.append(el('td', 'cell-mono', formatPoint(record.longitude, record.latitude)));
    const sourceCell = el('td', '', record.source || '—');
    sourceCell.title = record.source || '';
    row.append(sourceCell);
    row.append(el('td', 'cell-mono', record.source_crs || '—'));
    tbody.append(row);
  }
  table.append(thead, tbody);

  const foot = el('div', 'records-foot');
  foot.append(el('span', '', `${formatCount(results.length)} approved records`));
  foot.append(el('span', '', 'Positions shown in EPSG:4326 · source values preserved'));

  wrap.append(table, foot);
}

export function setWells(collection) {
  state.wells = collection || { type: 'FeatureCollection', features: [] };
  updateWellCount();
  if (map) {
    map.setWells(state.wells);
    if (state.selectedWellId) map.setSelected(state.selectedWellId);
    if (!fitDone) {
      fitDone = true;
      requestAnimationFrame(() => map?.fitWells(state.wells));
    }
  }
}

function updateWellCount() {
  const target = $('#workspace-well-count');
  if (target) target.textContent = formatCount(state.wells.features.length);
}

export async function selectWell(id, { fly = true, updateHash = true } = {}) {
  if (!id) return;
  ensureMap();
  state.selectedWellId = id;
  map?.setSelected(id);
  $$('.well-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.wellId === id);
  });
  $('#catalog-list')
    ?.querySelector('.well-item.is-active')
    ?.scrollIntoView({ block: 'nearest' });
  if (fly) map?.focusWell(id);
  if (updateHash) {
    navigate(`#/workspace/explore?well=${id}`, { replace: true });
  }
  await openInspector(id);
}

export function closeInspector({ updateHash = true } = {}) {
  const aside = $('#inspector');
  if (aside) {
    aside.hidden = true;
    aside.replaceChildren();
  }
  $('#explore-stage')?.classList.remove('has-inspector');
  inspectorId = null;
  state.selectedWellId = null;
  map?.setSelected(null);
  $$('.well-item').forEach((item) => item.classList.remove('is-active'));
  if (updateHash && location.hash.includes('well=')) {
    navigate('#/workspace/explore', { replace: true });
  }
}

export async function openInspector(id) {
  const aside = $('#inspector');
  if (!aside) return;
  inspectorId = id;
  aside.hidden = false;
  $('#explore-stage')?.classList.add('has-inspector');
  aside.replaceChildren();

  const head = el('header', 'inspector-head');
  const heading = el('div');
  heading.append(el('p', 'eyebrow', 'SELECTED RECORD'));
  heading.append(el('h2', '', 'Loading record…'));
  const close = el('button', 'icon-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close record details');
  close.dataset.closeInspector = '';
  close.append(icon('close'));
  head.append(heading, close);
  const body = el('div', 'inspector-body');
  body.append(skeletonRows(4));
  aside.append(head, body);

  try {
    const well = await api(`/wells/${id}`);
    if (inspectorId !== id) return;
    renderInspector(well);
  } catch (error) {
    if (inspectorId !== id) return;
    aside.replaceChildren();
    const failHead = el('header', 'inspector-head');
    const failHeading = el('div');
    failHeading.append(el('p', 'eyebrow', 'SELECTED RECORD'));
    failHeading.append(el('h2', '', 'Record unavailable'));
    const failClose = el('button', 'icon-btn');
    failClose.type = 'button';
    failClose.setAttribute('aria-label', 'Close record details');
    failClose.dataset.closeInspector = '';
    failClose.append(icon('close'));
    failHead.append(failHeading, failClose);
    const failBody = el('div', 'inspector-body');
    failBody.append(emptyState({ title: 'Could not load this record', message: error.message, iconName: 'alert' }));
    const retry = el('button', 'btn btn-secondary', 'Try again');
    retry.type = 'button';
    retry.dataset.retryWell = id;
    failBody.append(retry);
    aside.append(failHead, failBody);
  }
}

function renderInspector(well) {
  const aside = $('#inspector');
  if (!aside) return;
  const versions = well.versions || [];
  const current = versions.find((version) => version.id === well.current_version_id) || versions[0];
  if (!current) return;
  aside.replaceChildren();

  const head = el('header', 'inspector-head');
  const heading = el('div');
  heading.append(el('p', 'eyebrow', 'SELECTED RECORD'));
  heading.append(el('h2', '', current.name || 'Unnamed well'));
  heading.append(
    el(
      'p',
      'inspector-sub',
      `WELL ${shortId(well.id)} · ${versions.length} ${versions.length === 1 ? 'VERSION' : 'VERSIONS'}`,
    ),
  );
  const close = el('button', 'icon-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close record details');
  close.dataset.closeInspector = '';
  close.append(icon('close'));
  head.append(heading, close);

  const body = el('div', 'inspector-body');
  for (const version of versions) {
    const section = el('section', 'inspector-section');
    section.append(el('h3', '', `Version ${version.version_no}`));

    const card = el('div', 'version-card');
    const cardHead = el('div', 'version-card-head');
    cardHead.append(el('strong', '', version.name || 'Unnamed well'));
    const isCurrent = version.id === well.current_version_id;
    cardHead.append(el('span', `tag${isCurrent ? ' accent' : ''}`, isCurrent ? 'Current' : 'Superseded'));
    card.append(cardHead);

    const list = el('dl');
    addRow(list, 'Aliases', joinList(version.aliases));
    addRow(list, 'External ID', version.external_id || '—');
    addRow(list, 'Source', version.source || '—', { mono: false });
    addRow(list, 'Source CRS', version.source_crs || '—');
    addRow(list, 'Source position', `${version.source_x}, ${version.source_y}`);
    addRow(list, 'Display position', formatPoint(version.longitude, version.latitude));
    addRow(list, 'Operation', version.transform_operation);
    addRow(list, 'Reviewer', version.reviewer);
    addRow(list, 'Published', formatDateTime(version.published_at));
    addRow(list, 'License', version.license || '—', { mono: false });
    addRow(list, 'Confidentiality', version.confidentiality);
    addRow(list, 'Original file', `${version.original_name} · ${formatBytes(version.size_bytes)}`, {
      mono: false,
    });

    const dt = el('dt', '', 'SHA-256');
    const dd = el('dd');
    const hashRow = el('span', 'hash-row');
    hashRow.append(el('code', '', version.sha256));
    const copy = el('button', 'copy-btn');
    copy.type = 'button';
    copy.title = 'Copy SHA-256 checksum';
    copy.setAttribute('aria-label', 'Copy SHA-256 checksum');
    copy.dataset.copy = version.sha256;
    copy.append(icon('copy'));
    hashRow.append(copy);
    dd.append(hashRow);
    list.append(dt, dd);
    card.append(list);

    if (version.qc?.length) {
      const findings = el('div', 'version-findings');
      for (const finding of version.qc) {
        const node = el('div', `finding ${finding.severity}`);
        node.append(icon(finding.severity === 'error' ? 'alert' : 'info'));
        node.append(document.createTextNode(finding.message));
        findings.append(node);
      }
      card.append(findings);
    }

    if (version.download_allowed) {
      const actions = el('div', 'version-actions');
      const button = el('button', 'btn btn-secondary');
      button.type = 'button';
      button.dataset.download = version.file_id;
      button.dataset.fileName = version.original_name;
      button.append(icon('download'), document.createTextNode('Download original'));
      actions.append(button);
      card.append(actions);
    } else {
      card.append(el('p', 'field-hint', 'Original download is not permitted by this license.'));
    }

    section.append(card);
    body.append(section);
  }

  const actions = el('div', 'inspector-actions');
  const records = el('button', 'btn btn-secondary btn-small');
  records.type = 'button';
  records.dataset.openRecords = current.name || '';
  records.append(icon('doc'), document.createTextNode('Open in Records'));
  const copyId = el('button', 'btn btn-secondary btn-small');
  copyId.type = 'button';
  copyId.dataset.copy = well.id;
  copyId.append(icon('copy'), document.createTextNode('Copy well ID'));
  actions.append(records, copyId);

  aside.append(head, actions, body);
}

function addRow(list, term, value, { mono = true } = {}) {
  list.append(el('dt', '', term));
  list.append(el('dd', mono ? '' : 'ui', value));
}

export function refreshAfterPublish() {
  const tasks = [loadCatalog(catalogQuery)];
  if (recordsLoaded) tasks.push(loadRecords(recordsQuery));
  if (state.selectedWellId) tasks.push(openInspector(state.selectedWellId));
  return Promise.allSettled(tasks);
}

export function resetWorkspace() {
  closeInspector({ updateHash: false });
  catalogLoaded = false;
  recordsLoaded = false;
  fitDone = false;
  state.catalog = [];
  const list = $('#catalog-list');
  if (list) list.replaceChildren();
  const wrap = $('#records-table-wrap');
  if (wrap) wrap.replaceChildren();
  const count = $('#catalog-count');
  if (count) count.textContent = '—';
}
