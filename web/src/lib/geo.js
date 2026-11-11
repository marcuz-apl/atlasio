import { feature } from 'topojson-client';
import world from 'world-atlas/land-110m.json';
import countriesTopo from 'world-atlas/countries-110m.json';

export const landFeature = feature(world, world.objects.land);
export const countryFeatures = feature(countriesTopo, countriesTopo.objects.countries).features;

export const namedCountries = countryFeatures
  .filter((country) => country.properties && country.properties.name)
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name));

export function countryByName(name) {
  return namedCountries.find((country) => country.properties.name === name) || null;
}

export function coordinatePairs(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    output.push(value);
  } else {
    for (const child of value) coordinatePairs(child, output);
  }
  return output;
}

export function ringContains([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInCountry([x, y], country) {
  const polygons =
    country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
  return polygons.some(
    (rings) => ringContains([x, y], rings[0]) && !rings.slice(1).some((ring) => ringContains([x, y], ring)),
  );
}

export function findCountryAt(longitude, latitude) {
  return namedCountries.find((country) => pointInCountry([longitude, latitude], country)) || null;
}

export function wellsWithin(wells, country) {
  const features = wells?.features || [];
  return {
    type: 'FeatureCollection',
    features: features.filter((well) => pointInCountry(well.geometry.coordinates, country)),
  };
}

export function countryBounds(country) {
  const points = coordinatePairs(country.geometry.coordinates);
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

export function boundsOfFeatures(collection) {
  const points = (collection?.features || []).map((item) => item.geometry.coordinates);
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

export function countryAreaFeature(country) {
  return {
    type: 'Feature',
    properties: { name: country.properties.name },
    geometry: country.geometry,
  };
}

export function haversineKm(lon1, lat1, lon2, lat2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearbyWells(wells, longitude, latitude, radiusKm) {
  const features = wells?.features || [];
  return {
    type: 'FeatureCollection',
    features: features.filter((well) => {
      const [lon, lat] = well.geometry.coordinates;
      return haversineKm(longitude, latitude, lon, lat) <= radiusKm;
    }),
  };
}

export function circlePolygon(longitude, latitude, radiusKm, steps = 96) {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.15));
  const ring = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    ring.push([
      Math.max(-180, Math.min(180, longitude + Math.cos(angle) * lonDelta)),
      Math.max(-85, Math.min(85, latitude + Math.sin(angle) * latDelta)),
    ]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

export function geoBounds(featureObject) {
  const points = coordinatePairs(featureObject.geometry.coordinates);
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
