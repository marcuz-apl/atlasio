import { api, downloadFile } from '../lib/api.js';
import { state } from '../lib/state.js';
import { createWellMap } from '../lib/maps.js';
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

  $('#fit-all')?.addEventListener('click', () => {
    map?.fitWells(state.wells);
  });

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
    }
  });
}

export function ensureMap() {
  if (map) return map;
  map = createWellMap('#workspace-map-mount', {
    onSelect: (featureObject) => {
      selectWell(featureObject.properties.well_id, { fly: false });
    },
    onEmpty: () => closeInspector(),
  });
  if (map) {
    map.setWells(state.wells);
    if (state.selectedWellId) map.setSelected(state.selectedWellId);
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

  if (tab !== 'explore') closeInspector({ updateHash: false });

  if (tab === 'explore') {
    ensureMap();
    requestAnimationFrame(() => map?.resize());
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

  aside.append(head, body);
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
