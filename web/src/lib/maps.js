import { Map, NavigationControl, ScaleControl, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { feature } from 'topojson-client';
import world from 'world-atlas/land-110m.json';
import { countryFeatures } from './geo.js';
import { formatCursor } from './format.js';

setWorkerUrl(workerUrl);

const land = feature(world, world.objects.land);
const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

// Public basemap tiles (Esri ArcGIS Online, free with attribution) plus a fully
// offline vector fallback. No third-party thematic data is consumed here.
export const BASEMAPS = {
  topo: {
    label: 'Topographic',
    tiles: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    maxzoom: 19,
    attribution: '© Esri — World Topo Map',
  },
  gray: {
    label: 'Light gray canvas',
    tiles: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxzoom: 16,
    attribution: '© Esri — Light Gray Canvas',
  },
  dark: {
    label: 'Dark gray canvas',
    tiles: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxzoom: 16,
    attribution: '© Esri — Dark Gray Canvas',
  },
  imagery: {
    label: 'Satellite imagery',
    tiles: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxzoom: 18,
    attribution: '© Esri — World Imagery',
  },
  natgeo: {
    label: 'NatGeo style',
    tiles: 'https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    maxzoom: 16,
    attribution: '© Esri — NatGeo World Map',
  },
  offline: {
    label: 'Offline vector',
    tiles: null,
    maxzoom: 11,
    attribution: 'Natural Earth (public domain)',
  },
};

const graticule = { type: 'FeatureCollection', features: [] };
for (let lon = -180; lon <= 180; lon += 30) {
  graticule.features.push({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 37 }, (_, index) => [lon, -90 + index * 5]),
    },
  });
}
for (let lat = -60; lat <= 60; lat += 30) {
  graticule.features.push({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 73 }, (_, index) => [-180 + index * 5, lat]),
    },
  });
}

function fineGraticule(step) {
  const features = [];
  for (let lon = -180; lon < 180; lon += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[lon, -85], [lon, 85]] },
    });
  }
  for (let lat = -80; lat <= 80; lat += step) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] },
    });
  }
  return { type: 'FeatureCollection', features };
}

const graticule5 = fineGraticule(5);
const graticule1 = fineGraticule(1);

const palette = {
  light: {
    sea: '#dfe5ef',
    land: '#f4f5f8',
    landLine: '#c9cedb',
    grid: '#d7dce7',
    border: '#b9c0cf',
    areaFill: '#e22850',
    well: '#2563eb',
    halo: '#ffffff',
    accent: '#e22850',
    label: '#8b93a5',
    labelHalo: '#f4f5f8',
  },
  dark: {
    sea: '#0e0d13',
    land: '#1b1a22',
    landLine: '#33323e',
    grid: '#26252f',
    border: '#3d3c49',
    areaFill: '#f53d63',
    well: '#60a5fa',
    halo: '#15141a',
    accent: '#f53d63',
    label: '#6d6c7a',
    labelHalo: '#1b1a22',
  },
};

const baseStyle = {
  version: 8,
  sources: {
    land: { type: 'geojson', data: land },
    grid: { type: 'geojson', data: graticule },
    'grid-5': { type: 'geojson', data: graticule5 },
    'grid-1': { type: 'geojson', data: graticule1 },
    countries: { type: 'geojson', data: { type: 'FeatureCollection', features: countryFeatures } },
    area: { type: 'geojson', data: emptyCollection() },
    wells: { type: 'geojson', data: emptyCollection() },
    selected: { type: 'geojson', data: emptyCollection() },
    location: { type: 'geojson', data: emptyCollection() },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#dfe5ef' } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f4f5f8', 'fill-outline-color': '#c9cedb' } },
    {
      id: 'land-line',
      type: 'line',
      source: 'land',
      paint: { 'line-color': '#c9cedb', 'line-width': 0.7 },
    },
    {
      id: 'country-labels',
      type: 'symbol',
      source: 'countries',
      minzoom: 1.4,
      maxzoom: 7,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1.4, 9, 5, 12],
        'text-letter-spacing': 0.14,
        'text-transform': 'uppercase',
        'text-max-width': 7,
        'text-padding': 6,
      },
      paint: {
        'text-color': '#8b93a5',
        'text-halo-color': '#f4f5f8',
        'text-halo-width': 1.1,
        'text-opacity': 0.85,
      },
    },
    {
      id: 'grid',
      type: 'line',
      source: 'grid',
      paint: { 'line-color': '#d7dce7', 'line-width': 0.8, 'line-opacity': 0.8 },
    },
    {
      id: 'grid-5',
      type: 'line',
      source: 'grid-5',
      minzoom: 3.2,
      paint: { 'line-color': '#d7dce7', 'line-width': 0.5, 'line-opacity': 0.5 },
    },
    {
      id: 'grid-1',
      type: 'line',
      source: 'grid-1',
      minzoom: 5.4,
      paint: { 'line-color': '#d7dce7', 'line-width': 0.4, 'line-opacity': 0.4 },
    },
    {
      id: 'borders',
      type: 'line',
      source: 'countries',
      paint: { 'line-color': '#b9c0cf', 'line-width': 0.55, 'line-opacity': 0.85 },
    },
    {
      id: 'area-fill',
      type: 'fill',
      source: 'area',
      paint: { 'fill-color': '#e22850', 'fill-opacity': 0.08 },
    },
    {
      id: 'area-line',
      type: 'line',
      source: 'area',
      paint: { 'line-color': '#e22850', 'line-width': 1.4, 'line-dasharray': [5, 4], 'line-opacity': 0.8 },
    },
    {
      id: 'location-ring',
      type: 'circle',
      source: 'location',
      paint: {
        'circle-radius': 16,
        'circle-color': '#e22850',
        'circle-opacity': 0.14,
        'circle-stroke-color': '#e22850',
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.5,
      },
    },
    {
      id: 'location-dot',
      type: 'circle',
      source: 'location',
      paint: {
        'circle-radius': 4.5,
        'circle-color': '#e22850',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.2,
      },
    },
    {
      id: 'wells-halo',
      type: 'circle',
      source: 'wells',
      paint: {
        'circle-radius': 8,
        'circle-color': '#ffffff',
        'circle-opacity': 0.85,
        'circle-stroke-color': '#2563eb',
        'circle-stroke-width': 1.4,
      },
    },
    {
      id: 'wells',
      type: 'circle',
      source: 'wells',
      paint: {
        'circle-radius': 4.2,
        'circle-color': '#2563eb',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    },
    {
      id: 'selected-ring',
      type: 'circle',
      source: 'selected',
      paint: {
        'circle-radius': 14,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': '#e22850',
        'circle-stroke-width': 1.6,
      },
    },
    {
      id: 'selected-dot',
      type: 'circle',
      source: 'selected',
      paint: {
        'circle-radius': 5.4,
        'circle-color': '#e22850',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.4,
      },
    },
  ],
};

const OVERLAY_GROUPS = {
  wells: ['wells', 'wells-halo'],
  graticule: ['grid', 'grid-5', 'grid-1'],
  borders: ['borders'],
  area: ['area-fill', 'area-line'],
};

export function createWellMap(
  container,
  { onSelect, onEmpty, onReady, onBasemapError, onMapClick, basemap = 'offline', labels = false } = {},
) {
  const mount = typeof container === 'string' ? document.querySelector(container) : container;
  if (!mount) return null;

  const map = new Map({
    container: mount,
    style: JSON.parse(JSON.stringify(baseStyle)),
    center: [14, 24],
    zoom: 1.15,
    minZoom: 1,
    maxZoom: 18,
    attributionControl: false,
    dragRotate: false,
    preserveDrawingBuffer: true,
  });

  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');
  map.addControl(
    new AttributionControl({ compact: true, customAttribution: 'Natural Earth · MapLibre' }),
    'bottom-right',
  );

  let wells = emptyCollection();
  let area = null;
  let location = null;
  let selectedId = null;
  let loaded = false;
  let frame = null;
  let currentBasemap = 'offline';
  let pendingBasemap = basemap;
  let symbolSize = 4.2;
  let wellOpacity = 1;
  const overlayState = { wells: true, graticule: true, borders: true, area: true };

  const setPaint = (layer, property, value) => {
    if (!loaded) return;
    try {
      map.setPaintProperty(layer, property, value);
    } catch (error) {
      /* Layer not ready yet; the next theme pass will catch it. */
    }
  };

  const setVisibility = (layer, on) => {
    if (!loaded) return;
    try {
      map.setLayoutProperty(layer, 'visibility', on ? 'visible' : 'none');
    } catch (error) {
      /* Layer not ready yet. */
    }
  };

  const applyBasemap = (key) => {
    const config = BASEMAPS[key] ? key : 'offline';
    currentBasemap = config;
    if (!loaded) {
      pendingBasemap = config;
      return;
    }
    const raster = config !== 'offline';
    if (map.getLayer('basemap-raster')) map.removeLayer('basemap-raster');
    if (map.getSource('basemap')) map.removeSource('basemap');
    if (raster) {
      const source = BASEMAPS[config];
      map.addSource('basemap', {
        type: 'raster',
        tiles: [source.tiles],
        tileSize: 256,
        maxzoom: source.maxzoom,
        attribution: source.attribution,
      });
      map.addLayer(
        { id: 'basemap-raster', type: 'raster', source: 'basemap', paint: { 'raster-fade-duration': 140 } },
        'grid',
      );
    }
    setVisibility('land', !raster);
    setVisibility('land-line', !raster);
    setVisibility('country-labels', !raster && labels);
  };

  const applySymbolStyle = () => {
    setPaint('wells', 'circle-radius', symbolSize);
    setPaint('wells', 'circle-opacity', wellOpacity);
    setPaint('wells-halo', 'circle-radius', symbolSize + 3.8);
    setPaint('wells-halo', 'circle-opacity', 0.85 * wellOpacity);
    setPaint('selected-dot', 'circle-radius', symbolSize + 1.2);
    setPaint('selected-ring', 'circle-radius', symbolSize + 9.8);
  };

  const applyTheme = () => {
    const colors = palette[document.documentElement.dataset.theme] || palette.light;
    setPaint('background', 'background-color', colors.sea);
    setPaint('land', 'fill-color', colors.land);
    setPaint('land', 'fill-outline-color', colors.landLine);
    setPaint('land-line', 'line-color', colors.landLine);
    setPaint('country-labels', 'text-color', colors.label);
    setPaint('country-labels', 'text-halo-color', colors.labelHalo);
    setPaint('grid', 'line-color', colors.grid);
    setPaint('grid-5', 'line-color', colors.grid);
    setPaint('grid-1', 'line-color', colors.grid);
    setPaint('borders', 'line-color', colors.border);
    setPaint('area-fill', 'fill-color', colors.areaFill);
    setPaint('area-line', 'line-color', colors.areaFill);
    setPaint('location-ring', 'circle-color', colors.accent);
    setPaint('location-ring', 'circle-stroke-color', colors.accent);
    setPaint('location-dot', 'circle-color', colors.accent);
    setPaint('location-dot', 'circle-stroke-color', colors.halo);
    setPaint('wells-halo', 'circle-color', colors.halo);
    setPaint('wells-halo', 'circle-stroke-color', colors.well);
    setPaint('wells', 'circle-color', colors.well);
    setPaint('wells', 'circle-stroke-color', colors.halo);
    setPaint('selected-ring', 'circle-stroke-color', colors.accent);
    setPaint('selected-dot', 'circle-color', colors.accent);
    setPaint('selected-dot', 'circle-stroke-color', colors.halo);
  };

  const selectedCollection = () => {
    const match = wells.features.find((item) => item.properties.well_id === selectedId);
    return {
      type: 'FeatureCollection',
      features: match ? [match] : [],
    };
  };

  const applySelected = () => {
    if (!loaded) return;
    map.getSource('selected')?.setData(selectedCollection());
  };

  map.on('load', () => {
    loaded = true;
    if (!labels) setVisibility('country-labels', false);
    applyTheme();
    applyBasemap(pendingBasemap);
    applySymbolStyle();
    for (const [group, on] of Object.entries(overlayState)) {
      OVERLAY_GROUPS[group].forEach((layer) => setVisibility(layer, on));
    }
    map.getSource('wells')?.setData(wells);
    map.getSource('area')?.setData(area || emptyCollection());
    map.getSource('location')?.setData(location || emptyCollection());
    applySelected();
    onReady?.();
  });

  map.on('error', (event) => {
    if (currentBasemap !== 'offline' && (event.sourceId === 'basemap' || event.source?.id === 'basemap')) {
      onBasemapError?.(currentBasemap);
    }
  });

  map.on('click', 'wells', (event) => {
    const item = event.features?.[0];
    if (!item) return;
    onSelect?.(item);
  });

  map.on('click', (event) => {
    onMapClick?.(event.lngLat);
    const hits = map.queryRenderedFeatures(event.point, { layers: ['wells'] });
    if (!hits.length) onEmpty?.();
  });

  map.on('mouseenter', 'wells', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', 'wells', () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('mousemove', (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const rail = mount.closest('.map-panel, .explore-stage')?.querySelector('.coord-cursor-value');
      if (rail) rail.textContent = formatCursor(event.lngLat);
    });
  });

  window.addEventListener('atlasio:theme', applyTheme);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(mount);
  }

  const fitBounds = (bounds, options = {}) => {
    if (!bounds) return;
    const [[west, south], [east, north]] = bounds;
    const safeWest = Math.max(-179.9, west);
    const safeEast = Math.min(179.9, east);
    if (safeWest >= safeEast) return;
    map.fitBounds(
      [
        [safeWest, Math.max(-84, south)],
        [safeEast, Math.min(84, north)],
      ],
      {
        padding: { top: 46, right: 46, bottom: 46, left: 46 },
        maxZoom: 5,
        duration: 800,
        ...options,
      },
    );
  };

  return {
    map,
    isLoaded: () => loaded,
    setWells(collection) {
      wells = collection || emptyCollection();
      if (loaded) map.getSource('wells')?.setData(wells);
      applySelected();
    },
    setArea(featureObject) {
      area = featureObject || null;
      if (loaded) map.getSource('area')?.setData(area || emptyCollection());
      if (area) fitBounds(boundsOf(area), { maxZoom: 4.6 });
    },
    setLocation(coordinates) {
      location = coordinates
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates },
          }
        : null;
      if (loaded) map.getSource('location')?.setData(location || emptyCollection());
    },
    setSelected(id) {
      selectedId = id;
      applySelected();
    },
    focusWell(id) {
      const match = wells.features.find((item) => item.properties.well_id === id);
      if (!match) return;
      map.easeTo({
        center: match.geometry.coordinates,
        zoom: Math.max(map.getZoom(), 6),
        duration: 800,
      });
    },
    fitWells(collection = wells) {
      const bounds = boundsOf(collection);
      if (!bounds) {
        map.easeTo({ center: [14, 24], zoom: 1.15, duration: 600 });
        return;
      }
      fitBounds(bounds, { maxZoom: 5.2 });
    },
    fitArea(featureObject) {
      if (featureObject) fitBounds(boundsOf(featureObject), { maxZoom: 4.6 });
    },
    setBasemap(key) {
      applyBasemap(key);
    },
    getBasemap: () => currentBasemap,
    setSymbolSize(value) {
      symbolSize = Number(value) || 4.2;
      applySymbolStyle();
    },
    setWellOpacity(percent) {
      wellOpacity = Math.min(1, Math.max(0.1, Number(percent) / 100 || 1));
      applySymbolStyle();
    },
    setOverlay(group, on) {
      if (!OVERLAY_GROUPS[group]) return;
      overlayState[group] = Boolean(on);
      OVERLAY_GROUPS[group].forEach((layer) => setVisibility(layer, on));
    },
    exportPNG(fileName = 'atlasio-map.png') {
      try {
        const url = map.getCanvas().toDataURL('image/png');
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        return true;
      } catch (error) {
        return false;
      }
    },
    resize() {
      map.resize();
    },
    refreshTheme: applyTheme,
  };
}

function boundsOf(geoObject) {
  const points = [];
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push(value);
      return;
    }
    value.forEach(walk);
  };
  if (geoObject?.geometry) walk(geoObject.geometry.coordinates);
  else if (geoObject?.features) geoObject.features.forEach((item) => walk(item.geometry.coordinates));
  if (!points.length) return null;
  return points.reduce(
    (box, [x, y]) => [
      [Math.min(box[0][0], x), Math.min(box[0][1], y)],
      [Math.max(box[1][0], x), Math.max(box[1][1], y)],
    ],
    [
      [180, 90],
      [-180, -90],
    ],
  );
}
