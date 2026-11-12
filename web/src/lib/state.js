function stored(key, fallback = '') {
  try {
    return sessionStorage.getItem(key) || fallback;
  } catch (error) {
    return fallback;
  }
}

function storedAccount() {
  try {
    const value = sessionStorage.getItem('atlasio-account');
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

export const state = {
  key: stored('atlasio-key'),
  session: stored('atlasio-session'),
  account: storedAccount(),
  role: null,
  wells: { type: 'FeatureCollection', features: [] },
  area: { mode: 'global', country: null, point: null, label: 'Global overview' },
  activeTab: 'explore',
  selectedWellId: null,
  theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  catalog: [],
};

export function setSession(token, account) {
  state.session = token || '';
  state.account = account || null;
  try {
    if (token) sessionStorage.setItem('atlasio-session', token);
    else sessionStorage.removeItem('atlasio-session');
    if (account) sessionStorage.setItem('atlasio-account', JSON.stringify(account));
    else sessionStorage.removeItem('atlasio-account');
  } catch (error) {
    /* Session storage is optional; the tab still works until it reloads. */
  }
}

export function updateAccount(account) {
  if (!account) return;
  state.account = { ...state.account, ...account };
  try {
    sessionStorage.setItem('atlasio-account', JSON.stringify(state.account));
  } catch (error) {
    /* ignore */
  }
}
