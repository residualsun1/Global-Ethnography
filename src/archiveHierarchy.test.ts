import { describe, expect, it } from 'vitest';
import { archivePlaceRoute } from './archiveHierarchy';
import type { PlaceSnapshot } from './types';

describe('archivePlaceRoute', () => {
  it('uses canonical geography rather than a legacy reversed text path', () => {
    const place: PlaceSnapshot = {
      id: 'agadir', name: '阿加迪尔', kind: 'city', countryCode: 'MAR', latitude: 30.42, longitude: -9.58,
      parents: ['非洲', '苏斯-马塞-德拉大区', '摩洛哥'], source: 'openstreetmap',
      hierarchy: {
        continent: '非洲',
        country: { code: 'MAR', name: '摩洛哥' },
        admin1: { code: 'MA-13', name: '苏斯-马塞-德拉大区' }
      }
    };

    expect(archivePlaceRoute(place)).toEqual(['非洲', '摩洛哥', '苏斯-马塞-德拉大区', '阿加迪尔']);
  });
});
