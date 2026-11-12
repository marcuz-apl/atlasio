import '@fontsource-variable/archivo';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { api, changePassword, disableMfa, enableMfa, login, logout, startMfa } from './lib/api.js';
import { state, setSession, updateAccount } from './lib/state.js';
import { $, $$, copyText, setButtonBusy, toast } from './lib/ui.js';
import { roleLabel } from './lib/format.js';
import * as dashboard from './views/dashboard.js';
import * as workspace from './views/workspace.js';
import * as admin from './views/admin.js';
import { initDocs, renderDocs } from './views/docs.js';
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
const DEMO_DEFAULTS = { reader: 'viewer-demo', importer: 'importer-demo', reviewer: 'reviewer-demo' };
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

if (state.session) {
  void restoreSession();
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
    if (state.session) {
      toggleAccountMenu();
      return;
    }
    const dialog = $('#access-dialog');
    const lede = $('#access-lede');
    const account = $('#access-account');
    const keyField = $('#access-key-field');
    const reconnect = $('#access-reconnect');
    const change = $('#change-password-button');
    const mfaButton = $('#mfa-button');
    const disconnectButton = $('#disconnect-button');
    const note = $('#demo-key-note');
    const staff = Boolean(state.session);
    if (staff) {
      if (lede) lede.textContent = 'You are signed in with a staff account.';
      if (account) {
        account.hidden = false;
        account.textContent = `${state.account?.username || 'account'} · ${roleLabel(state.role)}${state.account?.mfa_enabled ? ' · MFA on' : ''}`;
      }
      if (keyField) keyField.hidden = true;
      if (reconnect) reconnect.hidden = true;
      if (change) change.hidden = false;
      if (mfaButton) {
        mfaButton.hidden = false;
        mfaButton.textContent = state.account?.mfa_enabled ? 'Manage MFA' : 'Set up MFA';
      }
      if (disconnectButton) disconnectButton.textContent = 'Sign out';
      if (note) note.hidden = true;
    } else {
      if (lede) lede.textContent = `You are connected as a ${roleLabel(state.role)}. Reconnect with another key to change what you can see and do.`;
      if (account) account.hidden = true;
      if (keyField) keyField.hidden = false;
      if (reconnect) reconnect.hidden = false;
      if (change) change.hidden = true;
      if (mfaButton) mfaButton.hidden = true;
      if (disconnectButton) disconnectButton.textContent = 'Disconnect';
      if (note) note.hidden = false;
    }
    if (dialog && !dialog.open) dialog.showModal();
  });

  $('#menu-profile')?.addEventListener('click', () => {
    closeAccountMenu();
    openProfileDialog();
  });
  $('#menu-password')?.addEventListener('click', () => {
    closeAccountMenu();
    openPasswordDialog();
  });
  $('#menu-mfa')?.addEventListener('click', () => {
    closeAccountMenu();
    openMfaDialog();
  });
  $('#menu-logout')?.addEventListener('click', () => {
    closeAccountMenu();
    void disconnect();
  });
  document.addEventListener('click', (event) => {
    if (!$('#account-menu') || $('#account-menu').hidden) return;
    if (!event.target.closest('.account-wrap')) closeAccountMenu();
  });
  document.addEventListener('keydown', (event) => {
    const menu = $('#account-menu');
    if (!menu || menu.hidden) return;
    if (event.key === 'Escape') {
      closeAccountMenu();
      $('#access-button')?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const items = [...menu.querySelectorAll('[role="menuitem"]')];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (index < 0) {
        items[step > 0 ? 0 : items.length - 1]?.focus();
        return;
      }
      const next = (index + step + items.length) % items.length;
      items[next]?.focus();
    }
  });

  $('#access-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.session) return;
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
  $('#change-password-button')?.addEventListener('click', () => {
    $('#access-dialog')?.close();
    openPasswordDialog();
  });
  $('#mfa-button')?.addEventListener('click', () => {
    $('#access-dialog')?.close();
    openMfaDialog();
  });
  $('#security-banner-action')?.addEventListener('click', () => {
    if (state.account?.must_change_password) openPasswordDialog({ forced: true });
    else openMfaDialog();
  });

  $('#staff-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#staff-username')?.value.trim() || '';
    const password = $('#staff-password')?.value || '';
    const code = $('#staff-code')?.value.trim() || '';
    if (!username || !password) {
      gateError('Enter the account username and password.');
      return;
    }
    await signInStaff(username, password, code);
  });

  for (const selector of ['#staff-username', '#staff-password']) {
    const field = $(selector);
    if (!field) continue;
    const unlock = () => field.removeAttribute('readonly');
    field.addEventListener('focus', unlock);
    field.addEventListener('pointerdown', unlock);
  }

  window.addEventListener('pageshow', () => {
    if (!state.session && !state.key) clearStaffFields();
  });

  $('#password-form')?.addEventListener('submit', submitPassword);
  $('#password-signout')?.addEventListener('click', async () => {
    $('#password-dialog')?.close();
    await disconnect();
  });

  $('#mfa-start')?.addEventListener('click', startEnrollment);
  $('#mfa-enable')?.addEventListener('click', confirmEnrollment);
  $('#mfa-disable')?.addEventListener('click', disableEnrollment);
  $('#mfa-copy-recovery')?.addEventListener('click', async () => {
    const codes = [...document.querySelectorAll('#mfa-recovery li')].map((node) => node.textContent);
    if (await copyText(codes.join('\n'))) toast('Recovery codes copied.', 'success');
    else toast('Copy failed. Select the codes and copy them manually.', 'error');
  });

  window.addEventListener('atlasio:session-expired', () => {
    state.role = null;
    applyRole();
    applyAccountChrome();
    workspace.resetWorkspace();
    $('#access-dialog')?.close();
    $('#password-dialog')?.close();
    $('#mfa-dialog')?.close();
    showGate();
    clearStaffFields();
    gateError('Your session expired. Sign in again.');
  });

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
    closeAccountMenu();
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
  const previousSession = state.session;
  const previousAccount = state.account;
  if (previousSession) setSession('', null);
  state.key = trimmed;
  try {
    const { role, account } = await api('/me');
    state.role = role;
    if (account) updateAccount(account);
    try {
      sessionStorage.setItem('atlasio-key', trimmed);
    } catch (error) {
      /* Session storage is optional. */
    }
    applyRole();
    applyAccountChrome();
    hideGate();
    gateError('');
    workspace.resetWorkspace();
    await loadCore();
    await applyRoute();
    if (announce) toast(`Connected as ${roleLabel(role)}.`, 'success');
    return true;
  } catch (error) {
    state.key = previousKey;
    if (previousSession) setSession(previousSession, previousAccount);
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

async function restoreSession() {
  try {
    const { role, account } = await api('/me');
    state.role = role;
    if (account) updateAccount(account);
    applyRole();
    applyAccountChrome();
    hideGate();
    workspace.resetWorkspace();
    await loadCore();
    await applyRoute();
    if (state.account?.must_change_password) {
      openPasswordDialog({ forced: true });
      toast('This account still uses its initial password. Set your own to unlock administrative changes.', 'info', { timeout: 8000 });
    } else if (state.account?.must_enroll_mfa) {
      openMfaDialog();
      toast('Multi-factor authentication is required. Add an authenticator to unlock administrative changes.', 'info', { timeout: 8000 });
    }
    return true;
  } catch (error) {
    state.role = null;
    applyRole();
    applyAccountChrome();
    showGate();
    clearStaffFields();
    gateError(error.status === 401 ? 'Your session expired. Sign in again.' : error.message);
    return false;
  }
}

async function signInStaff(username, password, code = '') {
  gateError('');
  const submit = $('#staff-form button[type="submit"]');
  setButtonBusy(submit, true, 'Signing in…');
  try {
    const result = await login(username, password, code);
    // A staff session replaces any access key held in this tab.
    state.key = '';
    try {
      sessionStorage.removeItem('atlasio-key');
    } catch (error) {
      /* ignore */
    }
    state.role = result.account.role;
    applyRole();
    applyAccountChrome();
    hideGate();
    gateError('');
    const codeField = $('#staff-code');
    if (codeField) {
      codeField.hidden = true;
      codeField.value = '';
    }
    $('#staff-form')?.reset();
    workspace.resetWorkspace();
    await loadCore();
    await applyRoute();
    if (result.account.must_change_password) {
      openPasswordDialog({ forced: true });
      toast('Set your own password to unlock administrative changes.', 'info', { timeout: 8000 });
    } else if (result.account.must_enroll_mfa) {
      openMfaDialog();
      toast('Multi-factor authentication is required. Add an authenticator to unlock administrative changes.', 'info', { timeout: 8000 });
    } else {
      toast(`Signed in as ${result.account.username}.`, 'success');
    }
    return true;
  } catch (error) {
    if (error.status === 428) {
      const field = $('#staff-code');
      if (field) {
        field.hidden = false;
        field.focus();
      }
      gateError('Enter the 6-digit authenticator code, or one of your recovery codes.');
      return false;
    }
    showGate();
    gateError(
      error.status === 401
        ? code
          ? 'That authenticator or recovery code was not accepted.'
          : 'Incorrect username or password.'
        : error.message || 'Sign-in failed. Try again.',
    );
    return false;
  } finally {
    setButtonBusy(submit, false);
  }
}

function toggleAccountMenu() {
  const menu = $('#account-menu');
  if (!menu) return;
  if (menu.hidden) {
    menu.hidden = false;
    $('#access-button')?.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="menuitem"]')?.focus();
  } else {
    closeAccountMenu();
  }
}

function closeAccountMenu() {
  const menu = $('#account-menu');
  if (menu) menu.hidden = true;
  $('#access-button')?.setAttribute('aria-expanded', 'false');
}

function openProfileDialog() {
  if (!state.session) return;
  const account = state.account || {};
  const username = $('#profile-username');
  const role = $('#profile-role');
  const password = $('#profile-password');
  const mfa = $('#profile-mfa');
  if (username) username.textContent = account.username || '—';
  if (role) role.textContent = roleLabel(state.role);
  if (password) {
    password.textContent = account.must_change_password ? 'Initial password — change required' : 'Changed';
  }
  if (mfa) {
    mfa.textContent = account.mfa_enabled
      ? 'On'
      : account.must_enroll_mfa
        ? 'Off — required'
        : 'Off';
  }
  const dialog = $('#profile-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function openPasswordDialog({ forced = false } = {}) {
  if (!state.session) return;
  closeAccountMenu();
  const lede = $('#password-lede');
  if (lede) {
    lede.textContent = forced
      ? 'This account still uses its initial password. Choose your own password now to unlock administrative changes. Other signed-in sessions will be revoked.'
      : 'Choose a new password for this account. Other signed-in sessions will be revoked.';
  }
  const form = $('#password-form');
  form?.reset();
  const error = $('#password-error');
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
  const dialog = $('#password-dialog');
  if (dialog && !dialog.open) dialog.showModal();
  $('#password-current')?.focus();
}

async function submitPassword(event) {
  event.preventDefault();
  const current = $('#password-current')?.value || '';
  const next = $('#password-new')?.value || '';
  const repeat = $('#password-repeat')?.value || '';
  const error = $('#password-error');
  const fail = (message) => {
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  };
  if (error) error.hidden = true;
  if (next !== repeat) {
    fail('The new passwords do not match.');
    return;
  }
  if (next.length < 8) {
    fail('Use at least 8 characters.');
    return;
  }
  const submit = $('#password-submit');
  setButtonBusy(submit, true, 'Saving…');
  try {
    await changePassword(current, next);
    applyAccountChrome();
    $('#password-dialog')?.close();
    toast('Password changed. Administrative changes are unlocked.', 'success');
  } catch (failure) {
    fail(failure.message || 'The password could not be changed.');
  } finally {
    setButtonBusy(submit, false);
  }
}

function applyAccountChrome() {
  const menuMfa = $('#menu-mfa');
  if (menuMfa) menuMfa.textContent = state.account?.mfa_enabled ? 'Manage MFA' : 'Set up MFA';
  const passwordPending = Boolean(state.session && state.account?.must_change_password);
  const mfaPending = Boolean(state.session && state.account?.must_enroll_mfa);
  const pending = passwordPending || mfaPending;
  const banner = $('#security-banner');
  if (banner) banner.hidden = !pending;
  const title = $('#security-banner-title');
  const text = $('#security-banner-text');
  const action = $('#security-banner-action');
  if (passwordPending) {
    if (title) title.textContent = 'Initial password still in use.';
    if (text) text.textContent = 'Set your own password to unlock administrative changes.';
    if (action) action.textContent = 'Change password';
  } else if (mfaPending) {
    if (title) title.textContent = 'Multi-factor authentication is required.';
    if (text) text.textContent = 'Add an authenticator app to unlock administrative changes.';
    if (action) action.textContent = 'Set up MFA';
  }
  document.body.classList.toggle('has-security-banner', pending);
}

function showMfaStep(step) {
  for (const name of ['password', 'enroll', 'done', 'disable']) {
    const node = $(`#mfa-step-${name}`);
    if (node) node.hidden = name !== step;
  }
}

function clearMfaErrors() {
  for (const id of ['#mfa-error', '#mfa-enroll-error', '#mfa-done-error', '#mfa-disable-error']) {
    const node = $(id);
    if (node) {
      node.hidden = true;
      node.textContent = '';
    }
  }
}

function openMfaDialog() {
  if (!state.session) return;
  clearMfaErrors();
  const form = $('#mfa-current');
  if (form) form.value = '';
  const disablePassword = $('#mfa-disable-password');
  if (disablePassword) disablePassword.value = '';
  const disableCode = $('#mfa-disable-code');
  if (disableCode) disableCode.value = '';
  const code = $('#mfa-code');
  if (code) code.value = '';
  const title = $('#mfa-title');
  if (state.account?.mfa_enabled) {
    if (title) title.textContent = 'Authenticator enabled';
    showMfaStep('disable');
    disablePassword?.focus();
  } else {
    if (title) title.textContent = 'Add an authenticator';
    showMfaStep('password');
    form?.focus();
  }
  const dialog = $('#mfa-dialog');
  if (dialog && !dialog.open) dialog.showModal();
}

async function startEnrollment() {
  const password = $('#mfa-current')?.value || '';
  const error = $('#mfa-error');
  if (error) error.hidden = true;
  if (!password) {
    if (error) {
      error.textContent = 'Enter your current password.';
      error.hidden = false;
    }
    return;
  }
  const button = $('#mfa-start');
  setButtonBusy(button, true, 'Preparing…');
  try {
    const result = await startMfa(password);
    const secret = $('#mfa-secret');
    if (secret) secret.textContent = result.secret;
    const host = $('#mfa-qr');
    if (host) {
      host.replaceChildren();
      const parsed = new DOMParser().parseFromString(result.qr_svg, 'image/svg+xml');
      const svg = parsed.documentElement;
      if (svg && svg.nodeName.toLowerCase() === 'svg') host.append(document.importNode(svg, true));
    }
    showMfaStep('enroll');
    $('#mfa-code')?.focus();
  } catch (failure) {
    if (error) {
      error.textContent = failure.message || 'The authenticator setup could not start.';
      error.hidden = false;
    }
  } finally {
    setButtonBusy(button, false);
  }
}

async function confirmEnrollment() {
  const code = $('#mfa-code')?.value.trim() || '';
  const error = $('#mfa-enroll-error');
  if (error) error.hidden = true;
  if (!code) {
    if (error) {
      error.textContent = 'Enter the code from your authenticator app.';
      error.hidden = false;
    }
    return;
  }
  const button = $('#mfa-enable');
  setButtonBusy(button, true, 'Turning on…');
  try {
    const result = await enableMfa(code);
    const list = $('#mfa-recovery');
    if (list) {
      list.replaceChildren();
      for (const value of result.recovery_codes) {
        const item = document.createElement('li');
        item.textContent = value;
        list.append(item);
      }
    }
    showMfaStep('done');
    const title = $('#mfa-title');
    if (title) title.textContent = 'Authenticator enabled';
    applyAccountChrome();
    toast('MFA is on. Store the recovery codes somewhere safe.', 'success', { timeout: 9000 });
  } catch (failure) {
    if (error) {
      error.textContent = failure.message || 'That code was not accepted.';
      error.hidden = false;
    }
  } finally {
    setButtonBusy(button, false);
  }
}

async function disableEnrollment() {
  const password = $('#mfa-disable-password')?.value || '';
  const code = $('#mfa-disable-code')?.value.trim() || '';
  const error = $('#mfa-disable-error');
  if (error) error.hidden = true;
  if (!password) {
    if (error) {
      error.textContent = 'Enter your current password.';
      error.hidden = false;
    }
    return;
  }
  const button = $('#mfa-disable');
  setButtonBusy(button, true, 'Turning off…');
  try {
    await disableMfa(password, code);
    $('#mfa-dialog')?.close();
    applyAccountChrome();
    toast('MFA is off for this account. Sessions other than this one were signed out.', 'success');
  } catch (failure) {
    if (error) {
      error.textContent = failure.message || 'MFA could not be turned off.';
      error.hidden = false;
    }
  } finally {
    setButtonBusy(button, false);
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
  const docsLink = $('.docs-link[data-nav="docs"]');
  if (docsLink) docsLink.hidden = !state.role;
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
  if (accessButton) {
    accessButton.title = state.role ? `Connected as ${label} · manage access` : 'Connect to the workspace';
    accessButton.setAttribute('aria-haspopup', state.session ? 'menu' : 'dialog');
    accessButton.setAttribute('aria-expanded', 'false');
  }
  if (!state.session) closeAccountMenu();

  if (state.role) document.body.dataset.role = state.role;
  else delete document.body.dataset.role;

  const ingestTab = $('[data-tab="ingest"]');
  const reviewTab = $('[data-tab="review"]');
  if (ingestTab) ingestTab.hidden = state.role !== 'importer';
  if (reviewTab) reviewTab.hidden = state.role !== 'reviewer';
  applyAccountChrome();
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
    return {
      view: segments[1] === 'docs' ? 'admin-docs' : 'admin',
      tab: 'explore',
      well: null,
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

  if (route.view === 'docs') {
    showDocs('user');
    return;
  }

  if (route.view === 'admin-docs') {
    if (!admin.isAdminRole()) {
      toast('Build notes are available to Administrators and Data Managers.', 'error');
      navigate('#/docs', { replace: true });
      return;
    }
    showDocs('build');
    return;
  }

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

function showDocs(kind = 'user') {
  const landing = $('#view-landing');
  const workspaceView = $('#view-workspace');
  const docsView = $('#view-docs');
  const adminView = $('#view-admin');
  renderDocs(kind);
  if (landing) landing.hidden = true;
  if (workspaceView) workspaceView.hidden = true;
  if (docsView) docsView.hidden = false;
  if (adminView) adminView.hidden = true;
  hideGate();
  dashboard.hidePreview();
  setNav(kind === 'build' ? 'admin' : 'docs');
  document.title = kind === 'build' ? 'Atlasio · Build notes & decisions' : 'Atlasio · User guide';
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
  closeAccountMenu();
  const gate = $('#access-gate');
  if (gate) gate.hidden = false;
  document.body.classList.add('gate-open');
  void refreshDemoProfiles();
}

function clearStaffFields() {
  for (const id of ['#staff-username', '#staff-password', '#staff-code']) {
    const field = $(id);
    if (field) field.value = '';
  }
  const code = $('#staff-code');
  if (code) code.hidden = true;
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

async function disconnect() {
  const wasStaff = Boolean(state.session);
  if (wasStaff) {
    try {
      await logout();
    } catch (error) {
      /* Signing out locally is enough if the server is unreachable. */
    }
  }
  setSession('', null);
  state.key = '';
  state.role = null;
  try {
    sessionStorage.removeItem('atlasio-key');
  } catch (error) {
    /* ignore */
  }
  applyRole();
  applyAccountChrome();
  workspace.resetWorkspace();
  $('#view-admin').hidden = true;
  $('#access-dialog')?.close();
  $('#password-dialog')?.close();
  showGate();
  clearStaffFields();
  gateError('');
  toast(wasStaff ? 'Signed out.' : 'Disconnected from the workspace.', 'info');
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
