import { beforeEach, describe, expect, it } from 'vitest';
import { LocalPointRepository, STORAGE_KEY } from './repository';
import type { Place } from './types';

const place: Place = {
  id: 'osm-city-shanghai',
  name: '上海市',
  originalName: 'Shanghai',
  kind: 'city',
  countryCode: 'CHN',
  latitude: 31.23,
  longitude: 121.47,
  parents: ['亚洲', '中国', '上海市'],
  source: 'openstreetmap'
};

describe('LocalPointRepository', () => {
  beforeEach(() => localStorage.clear());
  it('creates, de-duplicates and removes points', async () => {
    const repository = new LocalPointRepository();
    const first = await repository.create(place);
    expect((await repository.create(place)).id).toBe(first.id);
    expect(await repository.list()).toHaveLength(1);
    await repository.remove(first.id);
    expect(await repository.list()).toHaveLength(0);
  });
  it('backs up malformed data and recovers', async () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(await new LocalPointRepository().list()).toEqual([]);
    expect(localStorage.getItem('world-garden.points.corrupt')).toBe('{broken');
  });
  it('migrates version 1 city points without losing them', async () => {
    localStorage.setItem('world-garden.points.v1', JSON.stringify({
      schemaVersion: 1,
      points: [{
        id: 'old-point', cityId: 'shanghai', city: { id: 'shanghai', name: '上海', countryCode: 'CHN', latitude: 31.23, longitude: 121.47 },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', syncStatus: 'local'
      }]
    }));
    const points = await new LocalPointRepository().list();
    expect(points[0]).toMatchObject({ placeId: 'shanghai', place: { kind: 'city', name: '上海' } });
    expect(localStorage.getItem('world-garden.points.v1')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});
