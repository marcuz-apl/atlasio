export const state = {
  key: (() => {
    try {
      return sessionStorage.getItem('atlasio-key') || '';
    } catch (error) {
      return '';
    }
  })(),
  role: null,
  wells: { type: 'FeatureCollection', features: [] },
  area: { mode: 'global', country: null, point: null, label: 'Global overview' },
  activeTab: 'explore',
  selectedWellId: null,
  theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  catalog: [],
};
