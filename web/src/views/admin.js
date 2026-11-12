import { api, authHeaders } from '../lib/api.js';
import { state } from '../lib/state.js';
import { $, $$, el, icon, toast, copyText, setButtonBusy, emptyState } from '../lib/ui.js';
import { formatBytes, formatCount, formatDate, formatDateTime, roleLabel } from '../lib/format.js';

const ADMIN_ROLES = new Set(['admin', 'datamgr']);
const KIND_LABEL = { demo: 'Demo', custom: 'Custom' };

let initialized = false;
let system = null;
let profiles = [];
let backups = [];
let audit = [];
const verification = new Map();
let pendingRestore = null;
let confirmResolve = null;
let changelog = null;

export function initAdmin() {
  if (initialized) return;
  const host = $('#view-admin');
  if (!host) return;
  initialized = true;

  $('#admin-refresh')?.addEventListener('click', () => refreshAdmin({ announce: true }));
  $('#admin-backup-create')?.addEventListener('click', createBackup);
  $('#admin-profile-new')?.addEventListener('click', () => toggleCreate(true));
  $('#admin-create-cancel')?.addEventListener('click', () => toggleCreate(false));
  $('#admin-create-form')?.addEventListener('submit', createProfile);

  $$('[data-admin-collapse]').forEach((button) => {
    button.addEventListener('click', () => {
      const body = document.getElementById(button.dataset.adminCollapse);
      if (!body) return;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
      const label = button.querySelector('[data-collapse-label]');
      if (label) label.textContent = expanded ? 'Show' : 'Hide';
    });
  });

  const input = $('#restore-confirm');
  input?.addEventListener('input', () => {
    const submit = $('#restore-submit');
    if (submit && pendingRestore) {
      submit.disabled = input.value.trim() !== `RESTORE ${pendingRestore.id}`;
    }
  });
  $('#restore-submit')?.addEventListener('click', submitRestore);

  $('#confirm-accept')?.addEventListener('click', () => {
    const resolve = confirmResolve;
    confirmResolve = null;
    $('#confirm-dialog')?.close();
    if (resolve) resolve(true);
  });
  $('#confirm-dialog')?.addEventListener('close', () => {
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(false);
  });

  window.addEventListener('atlasio:demo-profiles', () => {
    renderProfiles();
  });
}

export function isAdminRole(role = state.role) {
  return ADMIN_ROLES.has(role);
}

export async function showAdmin() {
  if (!isAdminRole()) return;
  const badge = $('#admin-role');
  if (badge) {
    badge.textContent = roleLabel(state.role);
    badge.classList.toggle('role-importer', state.role !== 'admin');
  }
  const scope = $('#admin-scope');
  if (scope) {
    scope.hidden = state.role === 'admin';
    scope.textContent =
      state.role === 'admin'
        ? ''
        : 'Data Managers manage profiles and backups. Restoring or deleting a database backup is reserved for Administrators.';
  }
  await refreshAdmin();
}

export async function refreshAdmin({ announce = false } = {}) {
  if (!isAdminRole()) return;
  const button = $('#admin-refresh');
  setButtonBusy(button, true, 'Refreshing…');
  try {
    const results = await Promise.allSettled([
      api('/admin/status'),
      api('/admin/profiles'),
      api('/admin/backups'),
      api('/admin/audit'),
      api('/admin/changelog'),
    ]);
    const [statusResult, profilesResult, backupsResult, auditResult, changelogResult] = results;
    if (statusResult.status === 'fulfilled') system = statusResult.value;
    if (profilesResult.status === 'fulfilled') profiles = profilesResult.value;
    if (backupsResult.status === 'fulfilled') backups = backupsResult.value;
    if (auditResult.status === 'fulfilled') audit = auditResult.value;
    if (changelogResult.status === 'fulfilled') changelog = changelogResult.value;

    const failure = results.find((result) => result.status === 'rejected')?.reason;
    if (failure) reportError(failure);
    renderAll();
    if (announce && !failure) toast('Admin data refreshed.', 'success');
  } finally {
    setButtonBusy(button, false);
  }
}

function renderAll() {
  renderStats();
  renderProfiles();
  renderBackups();
  renderChangelog();
  renderAudit();
  const banner = $('#maintenance-banner');
  if (banner) banner.hidden = !system?.maintenance;
}

function renderStats() {
  const host = $('#admin-stats');
  if (!host) return;
  host.replaceChildren();
  if (!system) {
    host.append(el('p', 'admin-empty', 'System status is unavailable. Try refreshing.'));
    return;
  }
  const tiles = [
    ['Application', system.app_version, 'Server build'],
    ['Uptime', formatUptime(system.uptime_seconds), `Since ${formatDateTime(new Date(Date.now() - system.uptime_seconds * 1000))}`],
    ['Database', formatBytes(system.database.size_bytes), system.database.version.split(',')[0]],
    ['Sessions', formatCount(system.database.connections), 'Open connections'],
    ['Originals', formatCount(system.storage.object_count), `${formatBytes(system.storage.object_bytes)} · ${system.storage.mode.toUpperCase()}`],
    ['Profiles', formatCount(system.profiles), 'Managed keys'],
    ['Accounts', formatCount(system.security?.accounts), `${formatCount(system.security?.accounts_awaiting_password_change)} awaiting password change`],
    ['MFA', formatCount(system.security?.mfa_enabled), 'Accounts with MFA on'],
  ];
  for (const [label, value, note] of tiles) {
    const tile = el('div', 'admin-stat');
    tile.append(el('span', 'admin-stat-label', label));
    tile.append(el('strong', 'admin-stat-value', value));
    tile.append(el('span', 'admin-stat-note', note));
    host.append(tile);
  }
}

function renderProfiles() {
  const host = $('#admin-profiles-table');
  if (!host) return;
  host.replaceChildren();
  const count = $('#admin-profile-count');
  if (count) count.textContent = formatCount(profiles.length);

  if (!profiles.length) {
    host.append(emptyState({
      title: 'No managed profiles',
      message: 'Create a viewer, importer, or reviewer key to share access without an environment key.',
      iconName: 'key',
    }));
    return;
  }

  const table = el('table', 'records-table admin-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const label of ['Label', 'Role', 'Type', 'Key', 'Status', 'Last used', 'Actions']) {
    headRow.append(el('th', label === 'Actions' ? 'admin-cell-actions' : '', label));
  }
  head.append(headRow);
  table.append(head);

  const body = el('tbody');
  for (const profile of profiles) {
    const row = el('tr');
    row.append(el('td', 'cell-name', profile.label));
    row.append(el('td', '', roleLabel(profile.role)));

    const kind = el('td');
    kind.append(el('span', 'admin-pill', KIND_LABEL[profile.kind] || profile.kind));
    row.append(kind);

    const key = el('td', 'admin-key-cell');
    const keyRow = el('div', 'admin-key-row');
    if (profile.demo_key) {
      keyRow.append(el('code', 'admin-key', profile.demo_key));
      keyRow.append(iconButton('copy', 'Copy demo key', () => copyKey(profile.demo_key)));
    } else {
      keyRow.append(el('code', 'admin-key', `${profile.key_prefix || ''}…`));
      keyRow.append(el('span', 'admin-key-note', 'hashed · shown once'));
    }
    key.append(keyRow);
    row.append(key);

    const status = el('td');
    status.append(el('span', `admin-pill ${profile.active ? 'is-good' : 'is-bad'}`, profile.active ? 'Active' : 'Revoked'));
    row.append(status);

    const used = el('td', 'cell-mono');
    used.textContent = profile.last_used_at ? formatDateTime(profile.last_used_at) : 'Never';
    if (profile.rotated_at) used.title = `Rotated ${formatDateTime(profile.rotated_at)}`;
    row.append(used);

    const actions = el('td', 'admin-cell-actions');
    actions.append(actionButton('Rotate', () => rotateProfile(profile)));
    actions.append(actionButton(profile.active ? 'Revoke' : 'Enable', () => toggleProfile(profile)));
    row.append(actions);

    body.append(row);
  }
  table.append(body);
  host.append(table);
}

function renderBackups() {
  const host = $('#admin-backups-table');
  if (!host) return;
  host.replaceChildren();
  const count = $('#admin-backup-count');
  if (count) count.textContent = formatCount(backups.length);
  renderStorageNote();

  if (!backups.length) {
    host.append(emptyState({
      title: 'No backups yet',
      message: 'Create a backup before changing access or restoring anything. It captures the database and, on local storage, the original files.',
      iconName: 'database',
    }));
    return;
  }

  const table = el('table', 'records-table admin-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const label of ['Created', 'Dump', 'Records', 'Originals', 'Status', 'Actions']) {
    headRow.append(el('th', label === 'Actions' ? 'admin-cell-actions' : '', label));
  }
  head.append(headRow);
  table.append(head);

  const body = el('tbody');
  for (const backup of backups) {
    const row = el('tr');

    const created = el('td', 'cell-mono');
    created.textContent = formatDateTime(backup.created_at);
    created.title = backup.id;
    row.append(created);

    const dump = el('td', 'cell-mono');
    dump.textContent = formatBytes(backup.dump.size_bytes);
    dump.title = `SHA-256 ${backup.dump.sha256}`;
    row.append(dump);

    const records = el('td', 'admin-records-cell');
    records.append(el('span', '', `${formatCount(backup.database.wells)} wells · ${formatCount(backup.database.well_versions)} versions`));
    records.append(el('span', 'admin-key-note', `${formatCount(backup.database.file_assets)} files · ${formatCount(backup.database.import_batches)} batches`));
    row.append(records);

    const originals = el('td', 'admin-records-cell');
    if (backup.objects.copied) {
      originals.append(el('span', '', `${formatCount(backup.objects.count)} copied`));
      originals.append(el('span', 'admin-key-note', formatBytes(backup.objects.bytes)));
    } else {
      originals.append(el('span', '', 'S3 snapshot'));
      originals.append(el('span', 'admin-key-note', 'not in archive'));
    }
    row.append(originals);

    const verified = verification.get(backup.id);
    const status = el('td');
    const pill = el('span', `admin-pill ${verified === true ? 'is-good' : verified === false ? 'is-bad' : ''}`,
      verified === true ? 'Verified' : verified === false ? 'Mismatch' : 'Ready');
    status.append(pill);
    row.append(status);

    const actions = el('td', 'admin-cell-actions');
    actions.append(actionButton('Download', () => downloadBackup(backup)));
    actions.append(actionButton('Verify', (button) => verifyBackup(backup, button)));
    if (state.role === 'admin') {
      actions.append(actionButton('Restore', () => openRestore(backup)));
      actions.append(actionButton('Delete', () => deleteBackup(backup), 'is-danger'));
    }
    row.append(actions);

    body.append(row);
  }
  table.append(body);
  host.append(table);
}

function renderStorageNote() {
  const host = $('#admin-storage-note');
  if (!host) return;
  host.replaceChildren();
  host.classList.toggle('is-warn', system?.storage.mode === 's3');
  if (!system) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  host.append(icon(system.storage.mode === 's3' ? 'alert' : 'check'));
  host.append(el('span', '',
    system.storage.mode === 's3'
      ? 'Originals live in S3. Each archive holds the database dump only — take a provider snapshot or bucket copy alongside it.'
      : `Originals are stored locally and copied into each archive. Backup directory: ${system.backup_dir}`));
}

function renderChangelog() {
  const host = $('#admin-changelog');
  if (!host) return;
  host.replaceChildren();
  const entries = changelog?.entries || [];
  const count = $('#admin-changelog-count');
  if (count) count.textContent = formatCount(entries.length);
  const foot = $('#admin-changelog-foot');
  if (foot) {
    foot.textContent = changelog
      ? `Source: ${changelog.source} · latest ${changelog.latest || '—'} · server ${changelog.app_version}`
      : 'Source: CHANGELOG.md';
  }
  if (!entries.length) {
    host.append(emptyState({
      title: 'No build history found',
      message: 'Add CHANGELOG.md beside VERSION, or point ATLASIO_CHANGELOG at the file the server should read.',
      iconName: 'file',
    }));
    return;
  }

  entries.forEach((entry, index) => {
    const article = el('article', 'changelog-entry');

    const head = el('div', 'changelog-head');
    head.append(el('span', 'changelog-version', entry.version));
    if (entry.kind) {
      head.append(el('span', `admin-pill changelog-kind is-${entry.kind}`, entry.kind));
    }
    if (index === 0) head.append(el('span', 'admin-pill is-good', 'Latest'));
    head.append(el('time', 'changelog-date', formatReleaseDate(entry.date)));
    article.append(head);

    if (entry.build || (entry.commit && entry.commit !== 'pending')) {
      const meta = el('div', 'changelog-meta');
      if (entry.build) meta.append(el('code', 'changelog-build', entry.build));
      if (entry.commit && entry.commit !== 'pending') {
        meta.append(el('span', 'changelog-commit', `commit ${entry.commit}`));
      }
      article.append(meta);
    }

    if (entry.summary) article.append(el('p', 'changelog-summary', entry.summary));

    if (Array.isArray(entry.highlights) && entry.highlights.length) {
      const list = el('ul', 'changelog-items');
      for (const highlight of entry.highlights) list.append(el('li', '', highlight));
      article.append(list);
    }

    host.append(article);
  });
}

function formatReleaseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return value || '—';
  return formatDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function renderAudit() {
  const host = $('#admin-audit-list');
  if (!host) return;
  host.replaceChildren();
  if (!audit.length) {
    host.append(emptyState({
      title: 'No admin actions yet',
      message: 'Backups, profile changes, and restores are recorded here as they happen.',
      iconName: 'clock',
    }));
    return;
  }
  for (const entry of audit) {
    const row = el('div', 'admin-audit-row');
    row.append(el('time', 'admin-audit-time', formatDateTime(entry.occurred_at)));
    row.append(el('span', 'admin-audit-actor', roleLabel(entry.actor) === 'Not connected' ? entry.actor : roleLabel(entry.actor)));
    const action = el('code', 'admin-audit-action', entry.action.replace(/^admin\./, ''));
    row.append(action);
    row.append(el('span', 'admin-audit-detail', summarize(entry.details)));
    host.append(row);
  }
}

function summarize(details) {
  if (!details || typeof details !== 'object') return '';
  const keys = ['role', 'label', 'id', 'kind', 'objects_restored', 'pre_restore'];
  const parts = [];
  for (const key of keys) {
    if (details[key] === undefined || details[key] === null) continue;
    parts.push(`${key}: ${details[key]}`);
  }
  return parts.join(' · ');
}

function toggleCreate(open) {
  const form = $('#admin-create-form');
  if (!form) return;
  form.hidden = !open;
  if (open) $('#admin-create-label')?.focus();
}

async function createProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const role = form.querySelector('[name="role"]')?.value || 'reader';
  const label = form.querySelector('[name="label"]')?.value.trim() || '';
  const submit = form.querySelector('button[type="submit"]');
  setButtonBusy(submit, true, 'Creating…');
  try {
    const result = await api('/admin/profiles', {
      method: 'POST',
      body: JSON.stringify({ role, label: label || undefined }),
    });
    form.reset();
    toggleCreate(false);
    showOnce(result.key, result.profile);
    toast(`${roleLabel(role)} key created. Copy it now — it is shown once.`, 'success');
    await refreshAdmin();
  } catch (error) {
    reportError(error);
  } finally {
    setButtonBusy(submit, false);
  }
}

async function rotateProfile(profile) {
  if (profile.kind === 'custom') {
    const ok = await confirmAction({
      eyebrow: 'ROTATE KEY',
      title: `Rotate the key for ${profile.label}?`,
      message: 'The current custom key stops working immediately. You will see the replacement once.',
      accept: 'Rotate key',
    });
    if (!ok) return;
  }
  try {
    const result = await api(`/admin/profiles/${profile.id}/rotate`, { method: 'POST' });
    showOnce(result.key, result.profile);
    toast(`${profile.kind === 'demo' ? 'Demo' : 'Custom'} key rotated. The old key no longer works.`, 'success');
    if (result.profile.kind === 'demo') window.dispatchEvent(new CustomEvent('atlasio:demo-profiles'));
    await refreshAdmin();
  } catch (error) {
    reportError(error);
  }
}

async function toggleProfile(profile) {
  const revoking = profile.active;
  const ok = await confirmAction({
    eyebrow: revoking ? 'REVOKE KEY' : 'ENABLE KEY',
    title: revoking ? `Revoke ${profile.label}?` : `Enable ${profile.label}?`,
    message: revoking
      ? 'Anyone using this key loses access on their next request. A revoked demo key also leaves the sign-in gate.'
      : 'The key starts working again with its existing value.',
    accept: revoking ? 'Revoke key' : 'Enable key',
    danger: revoking,
  });
  if (!ok) return;
  try {
    await api(`/admin/profiles/${profile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !profile.active }),
    });
    toast(revoking ? 'Key revoked.' : 'Key enabled.', 'success');
    if (profile.kind === 'demo') window.dispatchEvent(new CustomEvent('atlasio:demo-profiles'));
    await refreshAdmin();
  } catch (error) {
    reportError(error);
  }
}

function showOnce(key, profile) {
  const host = $('#show-once');
  if (!host) return;
  host.replaceChildren();
  host.hidden = false;

  const head = el('div', 'show-once-head');
  head.append(el('span', 'eyebrow', 'NEW KEY · SHOWN ONCE'));
  head.append(el('strong', '', `${roleLabel(profile.role)} · ${profile.label}`));
  const dismiss = actionButton('Dismiss', () => {
    host.hidden = true;
    host.replaceChildren();
  });
  head.append(dismiss);
  host.append(head);

  const row = el('div', 'show-once-row');
  row.append(el('code', 'show-once-key', key));
  const copy = el('button', 'btn btn-secondary btn-small');
  copy.type = 'button';
  copy.append(icon('copy'), document.createTextNode('Copy key'));
  copy.addEventListener('click', () => copyKey(key));
  row.append(copy);
  host.append(row);
  host.append(el('p', 'show-once-note', 'Copy it now. The server keeps only a hash and cannot show it again.'));
}

async function copyKey(value) {
  if (await copyText(value)) toast('Key copied to the clipboard.', 'success');
  else toast('Copy failed. Select the key and copy it manually.', 'error');
}

async function createBackup() {
  const button = $('#admin-backup-create');
  setButtonBusy(button, true, 'Backing up…');
  try {
    const manifest = await api('/admin/backups', { method: 'POST' });
    toast(`Backup ${manifest.id} created (${formatBytes(manifest.dump.size_bytes)}).`, 'success');
    await refreshAdmin();
  } catch (error) {
    reportError(error);
  } finally {
    setButtonBusy(button, false);
  }
}

async function verifyBackup(backup, button) {
  setButtonBusy(button, true, 'Verifying…');
  try {
    const result = await api(`/admin/backups/${backup.id}/verify`, { method: 'POST' });
    verification.set(backup.id, result.valid);
    if (result.valid) {
      toast('Backup verified: the archive restores into a scratch database with matching counts.', 'success');
    } else {
      toast('Backup mismatch. Compare the expected and actual counts before restoring.', 'error');
    }
    renderBackups();
  } catch (error) {
    verification.set(backup.id, false);
    renderBackups();
    reportError(error);
  } finally {
    setButtonBusy(button, false);
  }
}

async function downloadBackup(backup) {
  try {
    const response = await fetch(`/api/admin/backups/${backup.id}/download`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || `Download failed (${response.status})`);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `atlasio-${backup.id}.dump`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (error) {
    reportError(error);
  }
}

function openRestore(backup) {
  pendingRestore = backup;
  const lede = $('#restore-lede');
  if (lede) {
    lede.textContent = `${backup.id} · created ${formatDateTime(backup.created_at)} · ${formatBytes(backup.dump.size_bytes)} · ${formatCount(backup.database.wells)} wells. Current data is replaced by this archive.`;
  }
  const phrase = $('#restore-phrase');
  if (phrase) phrase.textContent = `RESTORE ${backup.id}`;
  const input = $('#restore-confirm');
  if (input) input.value = '';
  const submit = $('#restore-submit');
  if (submit) {
    submit.disabled = true;
    submit.classList.remove('is-busy');
    submit.textContent = 'Restore database';
    delete submit.dataset.idleLabel;
  }
  const error = $('#restore-error');
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
  const dialog = $('#restore-dialog');
  if (dialog && !dialog.open) dialog.showModal();
  input?.focus();
}

async function submitRestore() {
  if (!pendingRestore) return;
  const backup = pendingRestore;
  const submit = $('#restore-submit');
  const input = $('#restore-confirm');
  const error = $('#restore-error');
  if (!input || input.value.trim() !== `RESTORE ${backup.id}`) return;
  setButtonBusy(submit, true, 'Restoring…');
  try {
    const result = await api(`/admin/backups/${backup.id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ confirm: input.value.trim() }),
    });
    $('#restore-dialog')?.close();
    pendingRestore = null;
    toast(
      result.objects_restored
        ? `Database restored from ${backup.id}; original files were restored too.`
        : `Database restored from ${backup.id}. ${result.note}`,
      'success',
      { timeout: 10000 },
    );
    await refreshAdmin();
  } catch (failure) {
    if (error) {
      error.hidden = false;
      error.textContent = failure.message || 'The restore failed.';
    }
    toast('Restore failed. Review the message in the dialog.', 'error');
  } finally {
    setButtonBusy(submit, false);
  }
}

async function deleteBackup(backup) {
  const ok = await confirmAction({
    eyebrow: 'DELETE BACKUP',
    title: `Delete backup ${backup.id}?`,
    message: 'The dump, manifest, and any copied originals are removed from disk. This cannot be undone.',
    accept: 'Delete backup',
  });
  if (!ok) return;
  try {
    await api(`/admin/backups/${backup.id}`, { method: 'DELETE' });
    verification.delete(backup.id);
    toast(`Backup ${backup.id} deleted.`, 'success');
    await refreshAdmin();
  } catch (error) {
    reportError(error);
  }
}

function confirmAction({ eyebrow, title, message, accept, danger = true }) {
  const dialog = $('#confirm-dialog');
  if (!dialog) return Promise.resolve(false);
  $('#confirm-eyebrow').textContent = eyebrow || 'CONFIRM';
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  const button = $('#confirm-accept');
  button.textContent = accept || 'Confirm';
  button.classList.toggle('btn-danger', danger);
  button.classList.toggle('btn-primary', !danger);
  if (!dialog.open) dialog.showModal();
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function actionButton(label, onClick, className = '') {
  const button = el('button', `admin-row-btn ${className}`.trim(), label);
  button.type = 'button';
  button.addEventListener('click', (event) => onClick(button, event));
  return button;
}

function iconButton(name, label, onClick) {
  const button = el('button', 'admin-icon-btn');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(name));
  button.addEventListener('click', () => onClick());
  return button;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function reportError(error) {
  if (error?.status === 503) {
    const banner = $('#maintenance-banner');
    if (banner) banner.hidden = false;
  }
  toast(error?.message || 'The admin request failed.', 'error');
}
