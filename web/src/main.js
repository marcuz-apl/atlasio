import '@fontsource-variable/archivo';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { api } from './lib/api.js';
import { state } from './lib/state.js';
import { $, $$, toast } from './lib/ui.js';
import { roleLabel } from './lib/format.js';
import * as dashboard from './views/dashboard.js';
import * as workspace from './views/workspace.js';
import * as admin from './views/admin.js';
import { initDocs } from './views/docs.js';
import { initIngest, loadQueue as loadIngestQueue } from './views/ingest.js';
import { initReview, loadReview as loadReviewQueue } from './views/review.js';

const THEME_KEY = 'atlasio-theme';
const THEME_MODES = new Set(['auto', 'light', 'dark']);
const THEME_CYCLE = { auto: 'light', light: 'dark', dark: 'auto' };
const THEME_NAMES = { auto: 'Automatic', light: 'Light', dark: 'Dark' };
const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const THEME_REFRESH_MS = 30000;
const NIGHT_START_HOUR = 19;
const NIGHT_END_HOUR = 7;
const TABS = new Set(['explore', 'records', 'ingest', 'review']);
const DEMO_DEFAULTS = { reader: 'reader-demo', importer: 'importer-demo', reviewer: 'reviewer-demo' };
const DEMO_NAMES = { reader: 'Viewer', importer: 'Importer', reviewer: 'Reviewer' };

let themeMode = 'auto';
let resolvedTheme = null;
let demoKeys = { ...DEMO_DEFAULTS };

initTheme();
initModules();
initChrome();
void refreshDemoProfiles();

if (!location.hash) {
  history.replaceState(null, '', '#/');
}

if (isDocsRoute()) {
  applyRoute().catch((error) => toast(error.message, 'error'));
} else if (state.key) {
  connect(state.key, { fromGate: true, announce: false });
} else {
  showGate();
}

function initModules() {
  dashboard.initDashboard({ onNavigate: navigate });
  workspace.initWorkspace({ onNavigate: navigate });
  admin.initAdmin();
  initDocs();
  initIngest();
  initReview({ onMutation: refreshData });
}

function isDocsRoute() {
  return parseRoute().view === 'docs';
}

function initTheme() {
  themeMode = storedThemeMode();
  applyTheme(themeMode);

  $('#theme-toggle')?.addEventListener('click', () => {
    applyTheme(THEME_CYCLE[themeMode] ?? 'auto', { persist: true });
  });

  darkScheme.addEventListener?.('change', () => {
    if (themeMode === 'auto') applyTheme('auto');
  });

  // Some browsers do not emit a change event when the OS palette switches; poll slowly as a fallback.
  setInterval(() => {
    if (themeMode === 'auto' && resolvedTheme !== autoTheme()) {
      applyTheme('auto');
    }
  }, THEME_REFRESH_MS);
}

// Automatic means the system palette, with a local-time night override so an
// evening workspace turns dark even when the OS itself stays in light mode.
function autoTheme() {
  const hour = new Date().getHours();
  const night = hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
  return night || darkScheme.matches ? 'dark' : 'light';
}

function storedThemeMode() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (THEME_MODES.has(stored)) return stored;
  } catch (error) {
    /* Private browsing can block storage; fall back to automatic. */
  }
  return 'auto';
}

function applyTheme(mode, { persist = false } = {}) {
  themeMode = THEME_MODES.has(mode) ? mode : 'auto';
  const theme = themeMode === 'auto' ? autoTheme() : themeMode;
  const automaticFlip = themeMode === 'auto' && resolvedTheme !== null && resolvedTheme !== theme;
  resolvedTheme = theme;
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, themeMode);
    } catch (error) {
      /* Private browsing can block storage; the theme still applies for this view. */
    }
  }

  const toggle = $('#theme-toggle');
  if (toggle) {
    const next = THEME_CYCLE[themeMode];
    toggle.dataset.mode = themeMode;
    toggle.setAttribute(
      'aria-label',
      themeMode === 'auto'
        ? `Color theme: automatic, ${theme} now. Switch to ${next} only.`
        : `Color theme: ${themeMode}. Switch to ${next === 'auto' ? 'automatic' : next}.`
    );
    toggle.title =
      themeMode === 'auto'
        ? `Automatic — ${theme} now · click for light only`
        : `${THEME_NAMES[themeMode]} · click for ${next === 'auto' ? 'automatic' : next}`;
    if (automaticFlip) {
      toggle.classList.remove('is-turning');
      void toggle.offsetWidth;
      toggle.classList.add('is-turning');
    }
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#15141a' : '#ffffff');
  window.dispatchEvent(new CustomEvent('atlasio:theme'));
}

function initChrome() {
  $$('[data-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.dialog);
      if (dialog && !dialog.open) dialog.showModal();
    });
  });

  $$('.dialog-close').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });

  $$('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });

  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  $('#access-button')?.addEventListener('click', () => {
    if (!state.role) {
      showGate();
      return;
    }
    const dialog = $('#access-dialog');
    const lede = $('#access-lede');
    if (lede) {
      lede.textContent = `You are connected as a ${roleLabel(state.role)}. Reconnect with another key to change what you can see and do.`;
    }
    if (dialog && !dialog.open) dialog.showModal();
  });

  $('#access-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = $('#access-key')?.value.trim() || '';
    if (!key) {
      toast('Enter an access key to reconnect.', 'error');
      return;
    }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    const ok = await connect(key, { announce: true });
    if (submit) submit.disabled = false;
    if (ok) {
      $('#access-key').value = '';
      $('#access-dialog')?.close();
    }
  });

  $('#disconnect-button')?.addEventListener('click', disconnect);

  $$('[data-demo-key]').forEach((button) => {
    button.addEventListener('click', async () => {
      gateError('');
      const roles = $$('.gate-role');
      roles.forEach((node) => {
        node.disabled = true;
      });
      await connect(button.dataset.demoKey, { fromGate: true, announce: true });
      roles.forEach((node) => {
        node.disabled = false;
      });
    });
  });

  $('#gate-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = $('#gate-key')?.value.trim() || '';
    if (!key) {
      gateError('Enter an access key to continue.');
      return;
    }
    gateError('');
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    await connect(key, { fromGate: true, announce: true });
    if (submit) submit.disabled = false;
  });

  window.addEventListener('hashchange', () => {
    applyRoute().catch((error) => toast(error.message, 'error'));
  });

  window.addEventListener('atlasio:demo-profiles', () => {
    void refreshDemoProfiles();
  });
}

async function refreshDemoProfiles() {
  let items = null;
  try {
    const response = await fetch('/api/demo-profiles', { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) items = data;
    }
  } catch (error) {
    /* The API may be offline; keep the published demo keys. */
  }
  if (items) {
    const next = {};
    for (const item of items) {
      if (item && DEMO_NAMES[item.role] && typeof item.key === 'string' && item.key) {
        next[item.role] = item.key;
      }
    }
    demoKeys = next;
  }
  applyDemoProfiles(items !== null);
}

function applyDemoProfiles(known) {
  $$('.gate-role[data-role]').forEach((button) => {
    const key = demoKeys[button.dataset.role];
    if (key) {
      button.dataset.demoKey = key;
      button.hidden = false;
    } else if (known) {
      button.hidden = true;
    }
  });
  const note = $('#demo-key-note');
  if (note) {
    const keys = Object.keys(DEMO_NAMES).filter((role) => demoKeys[role]).map((role) => demoKeys[role]);
    note.textContent = keys.length
      ? `Demo keys: ${keys.join(' · ')}`
      : 'Demo keys are disabled. Use an access key.';
  }
}

async function connect(key, { fromGate = false, announce = false } = {}) {
  const trimmed = String(key || '').trim();
  if (!trimmed) {
    gateError('Enter an access key to continue.');
    return false;
  }
  const previousKey = state.key;
  state.key = trimmed;
  try {
    const { role } = await api('/me');
    state.role = role;
    try {
      sessionStorage.setItem('atlasio-key', trimmed);
    } catch (error) {
      /* Session storage is optional. */
    }
    applyRole();
    hideGate();
    gateError('');
    workspace.resetWorkspace();
    await loadCore();
    await applyRoute();
    if (announce) toast(`Connected as ${roleLabel(role)}.`, 'success');
    return true;
  } catch (error) {
    state.key = previousKey;
    if (fromGate) {
      if (error.status === 401 && !previousKey) {
        state.key = '';
        try {
          sessionStorage.removeItem('atlasio-key');
        } catch (storageError) {
          /* ignore */
        }
      }
      showGate();
      gateError(
        error.status === 401 || error.status === 403
          ? 'That access key was not recognised. Try a demo role or another key.'
          : error.message,
      );
    } else {
      toast(error.message, 'error');
    }
    return false;
  }
}

async function loadCore() {
  try {
    const wells = await api('/map/wells');
    state.wells = wells;
    dashboard.setWells(wells);
    workspace.setWells(wells);
  } catch (error) {
    toast(error.message, 'error');
  }
  await dashboard.refreshCounts({ silent: true });
}

function applyRole() {
  const label = roleLabel(state.role);
  const access = $('#access-label');
  if (access) access.textContent = label;
  const badge = $('#workspace-role');
  if (badge) {
    badge.textContent = state.role ? `${label} access` : '—';
    badge.classList.toggle('role-importer', state.role === 'importer');
  }
  const adminLink = $('#admin-link');
  if (adminLink) adminLink.hidden = !admin.isAdminRole();
  const lede = $('#workspace-lede');
  if (lede) {
    lede.textContent = {
      reader: 'Search approved wells and inspect the evidence behind every record.',
      importer: 'Stage packages, correct metadata, and track them through review.',
      reviewer: 'Resolve identity, publish approved packages, and inspect the record.',
      admin: 'Inspect the catalog and govern access, backups, and recovery.',
      datamgr: 'Inspect the catalog and manage profiles, demo keys, and backups.',
    }[state.role] || 'Search approved wells and inspect the evidence behind every record.';
  }
  const accessButton = $('#access-button');
  if (accessButton) accessButton.title = state.role ? `Connected as ${label} · manage access` : 'Connect to the workspace';

  if (state.role) document.body.dataset.role = state.role;
  else delete document.body.dataset.role;

  const ingestTab = $('[data-tab="ingest"]');
  const reviewTab = $('[data-tab="review"]');
  if (ingestTab) ingestTab.hidden = state.role !== 'importer';
  if (reviewTab) reviewTab.hidden = state.role !== 'reviewer';
}

function navigate(path, { replace = false } = {}) {
  if (!path) return;
  if (replace) {
    history.replaceState(null, '', path);
    return;
  }
  if (location.hash === path) {
    applyRoute().catch((error) => toast(error.message, 'error'));
    return;
  }
  location.hash = path;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  if (segments[0] === 'workspace') {
    return {
      view: 'workspace',
      tab: TABS.has(segments[1]) ? segments[1] : 'explore',
      well: new URLSearchParams(queryPart).get('well'),
    };
  }
  if (segments[0] === 'docs') {
    return { view: 'docs', tab: 'explore', well: null };
  }
  if (segments[0] === 'admin') {
    return { view: 'admin', tab: 'explore', well: null };
  }
  return { view: 'landing', tab: 'explore', well: null };
}

async function applyRoute() {
  const route = parseRoute();

  // Reference material stays readable without a workspace key.
  if (route.view === 'docs') {
    showDocs();
    return;
  }

  if (!state.role) {
    showGate();
    return;
  }
  hideGate();

  if (route.view === 'admin') {
    if (!admin.isAdminRole()) {
      toast('Administration is available to Administrators and Data Managers.', 'error');
      navigate('#/', { replace: true });
      return;
    }
    await showAdminView();
    return;
  }

  if (route.view === 'landing') {
    showLanding();
    return;
  }

  if (route.tab === 'ingest' && state.role !== 'importer') {
    toast('Ingest is available to importers.', 'error');
    navigate('#/workspace/explore', { replace: true });
    return;
  }
  if (route.tab === 'review' && state.role !== 'reviewer') {
    toast('Review is available to reviewers.', 'error');
    navigate('#/workspace/explore', { replace: true });
    return;
  }

  showWorkspaceView(route.tab);
  await workspace.showTab(route.tab);

  if (route.tab === 'ingest') await loadIngestQueue();
  if (route.tab === 'review') await loadReviewQueue();

  if (route.tab === 'explore') {
    if (route.well) {
      await workspace.selectWell(route.well, { fly: true, updateHash: false });
    } else {
      workspace.closeInspector({ updateHash: false });
    }
  }
}

function showLanding() {
  const landing = $('#view-landing');
  const workspaceView = $('#view-workspace');
  const docsView = $('#view-docs');
  const adminView = $('#view-admin');
  if (landing) landing.hidden = false;
  if (workspaceView) workspaceView.hidden = true;
  if (docsView) docsView.hidden = true;
  if (adminView) adminView.hidden = true;
  dashboard.hidePreview();
  setNav('dashboard');
  document.title = 'Atlasio · Subsurface workspace';
}

function showWorkspaceView(tab) {
  const landing = $('#view-landing');
  const workspaceView = $('#view-workspace');
  const docsView = $('#view-docs');
  const adminView = $('#view-admin');
  if (landing) landing.hidden = true;
  if (workspaceView) workspaceView.hidden = false;
  if (docsView) docsView.hidden = true;
  if (adminView) adminView.hidden = true;
  dashboard.hidePreview();
  setNav('workspace');
  document.title = `Atlasio · Workspace · ${tab.charAt(0).toUpperCase()}${tab.slice(1)}`;
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
}

function showDocs() {
  const landing = $('#view-landing');
  const workspaceView = $('#view-workspace');
  const docsView = $('#view-docs');
  const adminView = $('#view-admin');
  if (landing) landing.hidden = true;
  if (workspaceView) workspaceView.hidden = true;
  if (docsView) docsView.hidden = false;
  if (adminView) adminView.hidden = true;
  hideGate();
  dashboard.hidePreview();
  setNav('docs');
  document.title = 'Atlasio · Build notes & decisions';
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
}

async function showAdminView() {
  const landing = $('#view-landing');
  const workspaceView = $('#view-workspace');
  const docsView = $('#view-docs');
  const adminView = $('#view-admin');
  if (landing) landing.hidden = true;
  if (workspaceView) workspaceView.hidden = true;
  if (docsView) docsView.hidden = true;
  if (adminView) adminView.hidden = false;
  dashboard.hidePreview();
  setNav('admin');
  document.title = 'Atlasio · Administration';
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
  await admin.showAdmin();
}

function setNav(name) {
  $$('[data-nav]').forEach((link) => {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function showGate() {
  const gate = $('#access-gate');
  if (gate) gate.hidden = false;
  document.body.classList.add('gate-open');
  void refreshDemoProfiles();
}

function hideGate() {
  const gate = $('#access-gate');
  if (gate) gate.hidden = true;
  document.body.classList.remove('gate-open');
}

function gateError(message) {
  const node = $('#gate-error');
  if (!node) return;
  node.textContent = message || '';
  node.hidden = !message;
}

function disconnect() {
  state.key = '';
  state.role = null;
  try {
    sessionStorage.removeItem('atlasio-key');
  } catch (error) {
    /* ignore */
  }
  applyRole();
  workspace.resetWorkspace();
  $('#view-admin').hidden = true;
  $('#access-dialog')?.close();
  showGate();
  gateError('');
  toast('Disconnected from the workspace.', 'info');
}

async function refreshData() {
  try {
    const wells = await api('/map/wells');
    state.wells = wells;
    dashboard.setWells(wells);
    workspace.setWells(wells);
    await Promise.allSettled([
      dashboard.refreshCounts({ silent: true }),
      workspace.refreshAfterPublish(),
    ]);
  } catch (error) {
    toast(error.message, 'error');
  }
}
