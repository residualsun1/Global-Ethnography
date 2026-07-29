import cities from './data/cities.json';
import { CityIndex } from './cityIndex';
import type { City, GeoRegion, GeographyLevel, RegionMatch } from './types';

interface GeographyData { countries: GeoRegion[]; admin1: GeoRegion[] }

export const cityList = cities as City[];
export const cityIndex = new CityIndex(cityList);
const countryLevelOnly = new Set(['SGP']);
const cityMap = new Map(cityList.map(city => [city.id, city]));
export const currentCity = (id: string) => cityMap.get(id);

export function isDistinctAdmin1SearchResult(region: GeoRegion, country: GeoRegion | undefined) {
  return !country || region.name !== country.name;
}

export function pointInRing(longitude: number, latitude: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersects = yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function representativePoint(region: GeoRegion) {
  const rings = region.polygons.map(polygon => polygon[0]).filter((ring): ring is number[][] => Boolean(ring?.length));
  const ring = rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
  if (!ring) return { latitude: (region.bbox[1] + region.bbox[3]) / 2, longitude: (region.bbox[0] + region.bbox[2]) / 2 };
  const area = ringArea(ring);
  if (Math.abs(area) < Number.EPSILON) return { latitude: (region.bbox[1] + region.bbox[3]) / 2, longitude: (region.bbox[0] + region.bbox[2]) / 2 };
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    longitude += (x1 + x2) * cross;
    latitude += (y1 + y2) * cross;
  }
  return { longitude: longitude / (6 * area), latitude: latitude / (6 * area) };
}

function ringArea(ring: number[][]) {
  return ring.slice(1).reduce((area, point, index) => area + ring[index][0] * point[1] - point[0] * ring[index][1], 0) / 2;
}

function contains(region: GeoRegion, latitude: number, longitude: number) {
  const [minX, minY, maxX, maxY] = region.bbox;
  if (longitude < minX || longitude > maxX || latitude < minY || latitude > maxY) return false;
  return region.polygons.some(polygon => {
    if (!polygon[0] || !pointInRing(longitude, latitude, polygon[0])) return false;
    return !polygon.slice(1).some(hole => pointInRing(longitude, latitude, hole));
  });
}

function inBbox(region: GeoRegion, latitude: number, longitude: number) {
  const [minX, minY, maxX, maxY] = region.bbox;
  return longitude >= minX && longitude <= maxX && latitude >= minY && latitude <= maxY;
}

function distanceToSegment(longitude: number, latitude: number, a: number[], b: number[]) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(longitude - x1, latitude - y1);
  const t = Math.max(0, Math.min(1, ((longitude - x1) * dx + (latitude - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(longitude - (x1 + t * dx), latitude - (y1 + t * dy));
}

function distanceToRegion(region: GeoRegion, latitude: number, longitude: number) {
  let best = Number.POSITIVE_INFINITY;
  for (const polygon of region.polygons) {
    for (const ring of polygon) {
      for (let index = 1; index < ring.length; index += 1) {
        best = Math.min(best, distanceToSegment(longitude, latitude, ring[index - 1], ring[index]));
      }
    }
  }
  return best;
}

export class GeographyIndex {
  private admin1ByCountry = new Map<string, GeoRegion[]>();
  constructor(private readonly data: GeographyData) {}

  countries() { return this.data.countries; }

  countryFeatures() {
    return this.data.countries.map(region => ({
      type: 'Feature',
      properties: { code: region.code, name: region.name },
      geometry: { type: 'MultiPolygon', coordinates: region.polygons }
    }));
  }

  setAdmin1(countryCode: string, admin1: GeoRegion[]) { this.admin1ByCountry.set(countryCode, admin1); }

  countryByCode(countryCode: string | undefined) {
    if (!countryCode) return undefined;
    return this.data.countries.find(region => region.code === countryCode);
  }

  countryAt(latitude: number, longitude: number) {
    const matches = this.data.countries.filter(region => contains(region, latitude, longitude));
    if (matches.length === 0) return undefined;
    // Small states can overlap a simplified neighbouring boundary. Prefer the most specific match.
    return matches.sort((a, b) => {
      const areaA = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]);
      const areaB = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]);
      return areaA - areaB;
    })[0];
  }

  admin1At(countryCode: string | undefined, latitude: number, longitude: number) {
    if (!countryCode || countryLevelOnly.has(countryCode)) return undefined;
    return this.admin1ByCountry.get(countryCode)?.find(region => contains(region, latitude, longitude));
  }

  admin1NearCoast(countryCode: string | undefined, latitude: number, longitude: number) {
    if (!countryCode || countryLevelOnly.has(countryCode)) return undefined;
    const candidates = this.admin1ByCountry.get(countryCode)?.filter(region => inBbox(region, latitude, longitude)) ?? [];
    let best: { region: GeoRegion; distance: number } | undefined;
    for (const region of candidates) {
      const distance = distanceToRegion(region, latitude, longitude);
      if (distance <= 0.35 && (!best || distance < best.distance)) best = { region, distance };
    }
    if (!best && countryCode === 'CHN') {
      const taiwanProvince = candidates.find(region => region.code === 'CN-TW');
      if (taiwanProvince) return taiwanProvince;
    }
    return best?.region;
  }

  lookup(latitude: number, longitude: number): RegionMatch {
    const country = this.countryAt(latitude, longitude);
    if (!country) return {};
    const admin1 = this.admin1At(country.code, latitude, longitude);
    return { country, admin1 };
  }
}

let geographyPromise: Promise<GeographyIndex> | undefined;
export function loadGeography() {
  geographyPromise ??= fetch('/assets/geography/countries.json')
    .then(response => {
      if (!response.ok) throw new Error(`Geography data failed: ${response.status}`);
      return response.json() as Promise<GeoRegion[]>;
    })
    .then(countries => new GeographyIndex({ countries, admin1: [] }));
  return geographyPromise;
}

const admin1Promises = new Map<string, Promise<GeoRegion[]>>();
export function loadAdmin1(index: GeographyIndex, countryCode: string) {
  let promise = admin1Promises.get(countryCode);
  if (promise) return promise;
  promise = fetch(`/assets/geography/admin1/${countryCode}.json`)
    .then(response => {
      if (!response.ok) throw new Error(`Admin-1 data failed: ${response.status}`);
      return response.json() as Promise<GeoRegion[]>;
    })
    .then(admin1 => { index.setAdmin1(countryCode, admin1); return admin1; });
  admin1Promises.set(countryCode, promise);
  return promise;
}

export function geographyLevel(distance: number): GeographyLevel {
  if (distance > 5.7) return 'continent';
  if (distance > 4.15) return 'country';
  if (distance > 2.72) return 'admin1';
  return 'city';
}

export const levelLabel: Record<GeographyLevel, string> = {
  continent: '大洲 / 地理区域',
  country: '国家 / 地区',
  admin1: '一级行政区',
  city: '地点'
};

export const nextDistance: Record<Exclude<GeographyLevel, 'city'>, number> = {
  continent: 5.15, country: 3.55, admin1: 2.42
};
