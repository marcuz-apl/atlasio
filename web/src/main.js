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
import { initIngest, loadQueue as loadIngestQueue } from './views/ingest.js';
import { initReview, loadReview as loadReviewQueue } from './views/review.js';

const THEME_KEY = 'atlasio-theme';
const TABS = new Set(['explore', 'records', 'ingest', 'review']);

initTheme();
initModules();
initChrome();

if (!location.hash) {
  history.replaceState(null, '', '#/');
}

if (state.key) {
  connect(state.key, { fromGate: true, announce: false });
} else {
  showGate();
}

function initModules() {
  dashboard.initDashboard({ onNavigate: navigate });
  workspace.initWorkspace({ onNavigate: navigate });
  initIngest();
  initReview({ onMutation: refreshData });
}

function initTheme() {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyTheme(theme, { persist: false });
  $('#theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, { persist: true });
  });
}

function applyTheme(theme, { persist = false } = {}) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* Private browsing can block storage; the theme still applies for this view. */
    }
  }
  const button = $('#theme-toggle');
  if (button) {
    button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1310' : '#143b2e');
  window.dispatchEvent(new CustomEvent('atlasio:theme'));
}

function initChrome() {
  const menuButton = $('#info-button');
  const menu = $('#info-menu');

  const closeMenu = () => {
    if (!menu) return;
    menu.hidden = true;
    menuButton?.setAttribute('aria-expanded', 'false');
  };

  menuButton?.addEventListener('click', () => {
    if (!menu) return;
    menu.hidden = !menu.hidden;
    menuButton.setAttribute('aria-expanded', String(!menu.hidden));
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap')) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  $$('[data-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.dialog);
      closeMenu();
      if (dialog && !dialog.open) dialog.showModal();
    });
  });

  $$('.dialog-close').forEach((button) => {
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
  const footer = $('#footer-role');
  if (footer) footer.textContent = state.role ? label : 'Not connected';
  const badge = $('#workspace-role');
  if (badge) {
    badge.textContent = state.role ? `${label} access` : '—';
    badge.classList.toggle('role-importer', state.role === 'importer');
  }
  const lede = $('#workspace-lede');
  if (lede) {
    lede.textContent = {
      reader: 'Search approved wells and inspect the evidence behind every record.',
      importer: 'Stage packages, correct metadata, and track them through review.',
      reviewer: 'Resolve identity, publish approved packages, and inspect the record.',
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
  return { view: 'landing', tab: 'explore', well: null };
}

async function applyRoute() {
  const route = parseRoute();
  if (!state.role) {
    showGate();
    return;
  }
  hideGate();

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
  if (landing) landing.hidden = false;
  if (workspaceView) workspaceView.hidden = true;
  dashboard.hidePreview();
  setNav('dashboard');
  document.title = 'Atlasio · Subsurface workspace';
}

function showWorkspaceView(tab) {
  const landing = $('#view-landing');
  const workspaceView = $('#view-workspace');
  if (landing) landing.hidden = true;
  if (workspaceView) workspaceView.hidden = false;
  dashboard.hidePreview();
  setNav('workspace');
  document.title = `Atlasio · Workspace · ${tab.charAt(0).toUpperCase()}${tab.slice(1)}`;
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
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
