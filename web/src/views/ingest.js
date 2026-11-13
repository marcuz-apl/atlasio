import { api } from '../lib/api.js';
import { state } from '../lib/state.js';
import { createWellMap } from '../lib/maps.js';
import { formatBytes, formatDateTime } from '../lib/format.js';
import { $, el, icon, toast, emptyState, skeletonRows, setButtonBusy } from '../lib/ui.js';

let initialized = false;
let items = [];
let pickMap = null;
let picked = null;

// CRS the domain engine can verify and transform to EPSG:4326. Axis order and
// numeric domain depend on the CRS; ED50 variants use the EPSG:1311 operation.
const CRS_OPTIONS = [
  { code: 'EPSG:4326', label: 'EPSG:4326 — WGS 84 (lon, lat)', xLabel: 'Source X (longitude)', yLabel: 'Source Y (latitude)', hint: 'WGS 84 longitude/latitude in degrees. No transformation is applied.', geo: true },
  { code: 'EPSG:4230', label: 'EPSG:4230 — ED50 geographic (lon, lat)', xLabel: 'Source X (longitude)', yLabel: 'Source Y (latitude)', hint: 'ED50 longitude/latitude in degrees. Transformed to WGS 84 with EPSG:1311 (±1 m, southern North Sea).', geo: true },
  { code: 'EPSG:23031', label: 'EPSG:23031 — ED50 / UTM 31N (E, N)', xLabel: 'Source X (easting, m)', yLabel: 'Source Y (northing, m)', hint: 'ED50 / UTM zone 31N easting/northing in metres. Transformed to WGS 84 with EPSG:1311 (±1 m).', geo: false },
  { code: 'EPSG:23032', label: 'EPSG:23032 — ED50 / UTM 32N (E, N)', xLabel: 'Source X (easting, m)', yLabel: 'Source Y (northing, m)', hint: 'ED50 / UTM zone 32N easting/northing in metres. Transformed to WGS 84 with EPSG:1311 (±1 m).', geo: false },
];
const CRS_BY_CODE = Object.fromEntries(CRS_OPTIONS.map((option) => [option.code, option]));

const requiredFields = [
  ['name', 'Well name'],
  ['source', 'Source package'],
  ['license', 'License'],
  ['position', 'Valid source position'],
  ['crs', 'Supported source CRS'],
  ['file', 'Original file'],
];

export function initIngest() {
  if (initialized) return;
  initialized = true;

  const form = $('#stage-form');
  const dropzone = $('#stage-dropzone');
  const fileInput = form?.elements.file;

  form?.addEventListener('input', updateReadiness);
  form?.addEventListener('change', updateReadiness);
  form?.addEventListener('submit', stagePackage);

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!dropzone) return;
    const title = dropzone.querySelector('.dropzone-title');
    const hint = dropzone.querySelector('.dropzone-hint');
    if (file) {
      dropzone.classList.add('has-file');
      if (title) title.textContent = file.name;
      if (hint) hint.textContent = `${formatBytes(file.size)} · checksum recorded on staging`;
    } else {
      dropzone.classList.remove('has-file');
      if (title) title.textContent = 'Choose or drop the original file';
      if (hint) hint.textContent = 'Up to 5 MiB · stored with a SHA-256 checksum';
    }
    updateReadiness();
  });

  if (dropzone && fileInput) {
    for (const eventName of ['dragenter', 'dragover']) {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragging');
      });
    }
    for (const eventName of ['dragleave', 'dragend', 'drop']) {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragging');
      });
    }
    dropzone.addEventListener('drop', (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  $('#ingest-refresh')?.addEventListener('click', () => {
    loadQueue({ announce: true });
  });

  $('#pick-on-map')?.addEventListener('click', openPickDialog);
  $('#pick-apply')?.addEventListener('click', applyPick);

  $('#ingest-queue')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-submit-import]');
    if (!button) return;
    setButtonBusy(button, true, 'Submitting…');
    try {
      await api(`/imports/${button.dataset.submitImport}/submit`, { method: 'POST' });
      toast('Submitted for review.', 'success');
      await loadQueue();
    } catch (error) {
      toast(error.message, 'error');
      await loadQueue();
    }
  });

  updateReadiness();
}

function openPickDialog() {
  const dialog = $('#pick-dialog');
  if (!dialog) return;
  picked = null;
  const readout = $('#pick-readout');
  if (readout) readout.textContent = 'No position picked yet.';
  const apply = $('#pick-apply');
  if (apply) apply.disabled = true;
  if (!dialog.open) dialog.showModal();
  if (!pickMap) {
    pickMap = createWellMap('#pick-map-mount', {
      basemap: 'offline',
      labels: true,
      onMapClick: (lngLat) => {
        picked = [Number(lngLat.lng.toFixed(6)), Number(lngLat.lat.toFixed(6))];
        pickMap?.setLocation(picked);
        const node = $('#pick-readout');
        if (node) node.textContent = `Picked ${picked[0].toFixed(6)}, ${picked[1].toFixed(6)} · EPSG:4326`;
        const button = $('#pick-apply');
        if (button) button.disabled = false;
      },
    });
  }
  requestAnimationFrame(() => pickMap?.resize());
}

function applyPick() {
  if (!picked) return;
  const form = $('#stage-form');
  if (!form) return;
  form.elements.x.value = String(picked[0]);
  form.elements.y.value = String(picked[1]);
  form.elements.source_crs.value = 'EPSG:4326';
  const hint = $('#pick-hint');
  if (hint) hint.textContent = `Position picked from the display map · ${picked[0]}, ${picked[1]} · EPSG:4326.`;
  form.dispatchEvent(new Event('input', { bubbles: true }));
  $('#pick-dialog')?.close();
  toast('Position picked. Source CRS set to EPSG:4326.', 'success');
}

function updateReadiness() {
  const form = $('#stage-form');
  const host = $('#stage-readiness');
  const submit = $('#stage-submit');
  if (!form || !host || !submit) return;

  const data = form.elements;
  const name = (data.name?.value || '').trim();
  const source = (data.source?.value || '').trim();
  const license = (data.license?.value || '').trim();
  const crs = (data.source_crs?.value || '').trim().toUpperCase();
  const meta = CRS_BY_CODE[crs];
  const x = Number(data.x?.value);
  const y = Number(data.y?.value);
  const inDomain = meta
    ? meta.geo
      ? x >= -180 && x <= 180 && y >= -90 && y <= 90
      : x >= 0 && x <= 1000000 && y >= 0 && y <= 10000000
    : false;
  const positionOk = Number.isFinite(x) && Number.isFinite(y) && inDomain;
  const hasFile = Boolean(data.file?.files?.length);

  syncCrsLabels(meta);

  const results = {
    name: Boolean(name),
    source: Boolean(source),
    license: Boolean(license),
    position: positionOk,
    crs: Boolean(meta),
    file: hasFile,
  };

  host.replaceChildren();
  for (const [key, label] of requiredFields) {
    const done = results[key];
    const item = el('span', `readiness-item${done ? ' is-done' : ''}`);
    item.append(icon(done ? 'check' : 'plus'));
    item.append(document.createTextNode(label));
    host.append(item);
  }

  const ready = Object.values(results).every(Boolean);
  submit.disabled = !ready;
  submit.title = ready ? '' : 'Complete the required fields to stage this package.';
}

function syncCrsLabels(meta) {
  if (!meta) return;
  const xLabel = $('#x-label');
  const yLabel = $('#y-label');
  const hint = $('#crs-hint');
  if (xLabel?.firstChild) xLabel.firstChild.textContent = `${meta.xLabel} `;
  if (yLabel?.firstChild) yLabel.firstChild.textContent = `${meta.yLabel} `;
  if (hint) hint.textContent = meta.hint;
}

async function stagePackage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $('#stage-submit');
  const data = form.elements;
  const file = data.file?.files?.[0];
  if (!file) {
    toast('Choose an original file before staging.', 'error');
    return;
  }

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  }).catch((error) => {
    toast(error.message, 'error');
    return null;
  });
  if (base64 === null) return;

  const manifest = {
    name: (data.name.value || '').trim(),
    external_id: (data.external_id.value || '').trim() || null,
    aliases: (data.aliases.value || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    source: (data.source.value || '').trim(),
    license: (data.license.value || '').trim(),
    confidentiality: data.confidentiality.value,
    download_allowed: data.download_allowed.checked,
    source_crs: (data.source_crs.value || '').trim().toUpperCase(),
    x: Number(data.x.value),
    y: Number(data.y.value),
  };

  setButtonBusy(submit, true, 'Staging package…');
  try {
    const result = await api('/imports', {
      method: 'POST',
      body: JSON.stringify({ manifest, file_name: file.name, file_base64: base64 }),
    });
    const warnings = (result.qc || []).filter((finding) => finding.severity === 'warning').length;
    toast(
      warnings
        ? 'Package staged with warnings. Review the queue before submitting.'
        : 'Package staged. Submit it for review when the metadata is ready.',
      'success',
    );
    form.reset();
    const dropzone = $('#stage-dropzone');
    dropzone?.classList.remove('has-file');
    const title = dropzone?.querySelector('.dropzone-title');
    const hint = dropzone?.querySelector('.dropzone-hint');
    if (title) title.textContent = 'Choose or drop the original file';
    if (hint) hint.textContent = 'Up to 5 MiB · stored with a SHA-256 checksum';
    updateReadiness();
    await loadQueue();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonBusy(submit, false);
    updateReadiness();
  }
}

export async function loadQueue({ announce = false } = {}) {
  if (state.role !== 'importer') return;
  const list = $('#ingest-queue');
  if (list) list.replaceChildren(skeletonRows(3));
  try {
    const data = await api('/imports');
    items = data
      .filter((item) => ['staged', 'submitted', 'rejected'].includes(item.status))
      .sort((a, b) => {
        const order = { staged: 0, submitted: 1, rejected: 2 };
        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      });
    renderQueue();
    if (announce) toast(`Queue refreshed · ${items.length} packages in progress.`, 'success');
  } catch (error) {
    if (list) {
      list.replaceChildren(emptyState({ title: 'Queue unavailable', message: error.message, iconName: 'alert' }));
    }
    if (announce) toast(error.message, 'error');
  }
}

function renderQueue() {
  const list = $('#ingest-queue');
  if (!list) return;
  list.replaceChildren();
  if (!items.length) {
    list.append(
      emptyState({
        title: 'No packages in progress',
        message: 'Stage a well package to start the governed import workflow.',
        iconName: 'upload',
      }),
    );
    return;
  }

  for (const item of items) {
    list.append(renderQueueCard(item));
  }
}

function renderQueueCard(item) {
  const manifest = item.manifest || {};
  const card = el('article', 'queue-card');

  const head = el('div', 'queue-card-head');
  head.append(el('strong', '', manifest.name || 'Unnamed well'));
  head.append(el('span', `status-pill is-${item.status}`, item.status));
  card.append(head);

  const meta = el('p', 'queue-meta');
  meta.textContent = [
    `CREATED ${formatDateTime(item.created_at).toUpperCase()}`,
    manifest.external_id ? `ID ${manifest.external_id}` : 'NO EXTERNAL ID',
    manifest.source || 'NO SOURCE',
  ].join(' · ');
  card.append(meta);

  const findings = (item.qc || []).filter((finding) => finding.severity !== 'info');
  if (findings.length) {
    const wrap = el('div', 'review-findings');
    for (const finding of findings) {
      const node = el('div', `finding ${finding.severity}`);
      node.append(icon(finding.severity === 'error' ? 'alert' : 'info'));
      node.append(document.createTextNode(finding.message));
      wrap.append(node);
    }
    card.append(wrap);
  }

  if (item.status === 'staged') {
    const details = document.createElement('details');
    details.className = 'correction-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Correct metadata';
    details.append(summary);
    details.append(buildCorrectionForm(item));
    card.append(details);

    const actions = el('div', 'queue-actions');
    const blocked = (item.qc || []).some((finding) => finding.severity === 'error');
    const submit = el('button', 'btn btn-primary btn-small', 'Submit for review');
    submit.type = 'button';
    submit.dataset.submitImport = item.id;
    submit.disabled = blocked;
    if (blocked) submit.title = 'Resolve blocking findings before submitting.';
    actions.append(submit);
    if (blocked) actions.append(el('span', 'field-hint', 'Resolve blocking findings first.'));
    card.append(actions);
  } else if (item.status === 'submitted') {
    card.append(el('p', 'field-hint', 'Awaiting reviewer identity resolution and approval.'));
  } else if (item.status === 'rejected') {
    if (item.review_reason) {
      const reason = el('p', 'review-reason');
      reason.textContent = `Rejected by ${item.reviewer || 'reviewer'}: ${item.review_reason}`;
      card.append(reason);
    }
    card.append(
      el('p', 'field-hint', 'Rejected packages stay on record. Stage a corrected package to try again.'),
    );
  }

  return card;
}

function buildCorrectionForm(item) {
  const manifest = item.manifest || {};
  const form = el('form', 'correction-form');
  form.dataset.correction = item.id;

  const field = (label, name, value, type = 'text', step = null) => {
    const wrap = el('label', 'field');
    const span = el('span', '', label);
    const input = el('input');
    input.type = type;
    input.name = name;
    input.value = value ?? '';
    input.autocomplete = 'off';
    if (step) input.step = step;
    wrap.append(span, input);
    return wrap;
  };

  form.append(field('Well name', 'name', manifest.name));
  const idRow = el('div', 'field-row');
  idRow.append(field('External ID', 'external_id', manifest.external_id));
  idRow.append(field('Aliases', 'aliases', (manifest.aliases || []).join(', ')));
  form.append(idRow);

  const provenance = el('div', 'field-row');
  provenance.append(field('Source package', 'source', manifest.source));
  provenance.append(field('License', 'license', manifest.license));
  form.append(provenance);

  const position = el('div', 'field-row');
  const crsField = el('label', 'field field-wide');
  crsField.append(el('span', '', 'Source CRS'));
  const crsSelect = el('select');
  crsSelect.name = 'source_crs';
  for (const option of CRS_OPTIONS) {
    crsSelect.append(new Option(option.label, option.code, false, (manifest.source_crs || 'EPSG:4326') === option.code));
  }
  crsField.append(crsSelect);
  position.append(crsField);
  position.append(field('Source X', 'x', manifest.x, 'number', 'any'));
  position.append(field('Source Y', 'y', manifest.y, 'number', 'any'));
  form.append(position);

  const confidentiality = el('label', 'field');
  confidentiality.append(el('span', '', 'Confidentiality'));
  const select = el('select');
  select.name = 'confidentiality';
  for (const option of ['restricted', 'public']) {
    const node = new Option(option, option, false, (manifest.confidentiality || 'restricted') === option);
    select.append(node);
  }
  confidentiality.append(select);
  form.append(confidentiality);

  const check = el('label', 'check');
  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.name = 'download_allowed';
  checkbox.checked = Boolean(manifest.download_allowed);
  check.append(checkbox, el('span', '', 'License permits download of the original file'));
  form.append(check);

  const save = el('button', 'btn btn-secondary btn-small', 'Save correction');
  save.type = 'submit';
  form.append(save);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveCorrection(item, form, save);
  });

  return form;
}

async function saveCorrection(item, form, button) {
  const manifest = item.manifest || {};
  const data = form.elements;
  const next = {
    name: (data.name.value || '').trim(),
    external_id: (data.external_id.value || '').trim(),
    aliases: (data.aliases.value || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    source: (data.source.value || '').trim(),
    license: (data.license.value || '').trim(),
    source_crs: (data.source_crs.value || '').trim().toUpperCase(),
    x: data.x.value === '' ? null : Number(data.x.value),
    y: data.y.value === '' ? null : Number(data.y.value),
    confidentiality: data.confidentiality.value,
    download_allowed: data.download_allowed.checked,
  };
  const current = {
    name: manifest.name || '',
    external_id: manifest.external_id || '',
    aliases: manifest.aliases || [],
    source: manifest.source || '',
    license: manifest.license || '',
    source_crs: manifest.source_crs || '',
    x: manifest.x ?? null,
    y: manifest.y ?? null,
    confidentiality: manifest.confidentiality || 'restricted',
    download_allowed: Boolean(manifest.download_allowed),
  };

  const changes = {};
  for (const key of Object.keys(next)) {
    if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) changes[key] = next[key];
  }
  if (!Object.keys(changes).length) {
    toast('No metadata changes to save.', 'info');
    return;
  }

  setButtonBusy(button, true, 'Saving…');
  try {
    await api(`/imports/${item.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    toast('Correction saved. QC findings were re-evaluated.', 'success');
    await loadQueue();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setButtonBusy(button, false);
  }
}
