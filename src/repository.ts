import type { City, Place, PointRepository, SavedPoint } from './types';

const STORAGE_KEY = 'world-garden.points.v2';
const LEGACY_KEY = 'world-garden.points.v1';
const BACKUP_KEY = 'world-garden.points.corrupt';

interface StoreShape { schemaVersion: 2; points: SavedPoint[] }

function isSavedPoint(value: unknown): value is SavedPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<SavedPoint>;
  return typeof point.id === 'string' && typeof point.placeId === 'string' && !!point.place &&
    typeof point.place.latitude === 'number' && typeof point.place.longitude === 'number' && typeof point.place.kind === 'string';
}

function cityToPlace(city: City): Place {
  return { id: city.id, name: city.name, kind: 'city', countryCode: city.countryCode, latitude: city.latitude, longitude: city.longitude, parents: [], source: 'natural-earth' };
}

export class LocalPointRepository implements PointRepository {
  constructor(private readonly storage: Storage = window.localStorage) {}

  private migrateLegacy(): SavedPoint[] {
    const raw = this.storage.getItem(LEGACY_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as { schemaVersion: 1; points: Array<{ id: string; cityId: string; city: City; createdAt: string; updatedAt: string; syncStatus: SavedPoint['syncStatus'] }> };
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.points)) return [];
      const points = parsed.points.map(point => ({ id: point.id, placeId: point.cityId, place: cityToPlace(point.city), createdAt: point.createdAt, updatedAt: point.updatedAt, syncStatus: point.syncStatus }));
      this.write(points);
      this.storage.removeItem(LEGACY_KEY);
      return points;
    } catch { return []; }
  }

  private read(): SavedPoint[] {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return this.migrateLegacy();
    try {
      const parsed = JSON.parse(raw) as StoreShape;
      if (parsed.schemaVersion !== 2 || !Array.isArray(parsed.points) || !parsed.points.every(isSavedPoint)) throw new Error('Invalid point store');
      return parsed.points;
    } catch {
      this.storage.setItem(BACKUP_KEY, raw);
      this.storage.removeItem(STORAGE_KEY);
      return [];
    }
  }

  private write(points: SavedPoint[]) { this.storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, points } satisfies StoreShape)); }
  async list() { return this.read().sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async create(place: Place) {
    const points = this.read();
    const duplicate = points.find(point => point.placeId === place.id);
    if (duplicate) return duplicate;
    const now = new Date().toISOString();
    const point: SavedPoint = { id: crypto.randomUUID(), placeId: place.id, place, createdAt: now, updatedAt: now, syncStatus: 'local' };
    this.write([...points, point]);
    return point;
  }
  async remove(id: string) { this.write(this.read().filter(point => point.id !== id)); }
  async clear() { this.write([]); }
}

export { STORAGE_KEY };
