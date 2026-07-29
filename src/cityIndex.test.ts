import { describe, expect, it } from 'vitest';
import { CityIndex } from './cityIndex';
import { latLonToVector3 } from './geo';
import type { City } from './types';

const cities: City[] = [
  { id: 'shanghai', name: 'Shanghai', countryCode: 'CN', latitude: 31.23, longitude: 121.47 },
  { id: 'london', name: 'London', countryCode: 'GB', latitude: 51.5, longitude: -0.12 },
  { id: 'quito', name: 'Quito', countryCode: 'EC', latitude: -0.18, longitude: -78.47 }
];

describe('CityIndex', () => {
  it('returns nearest cities in distance order', () => {
    const result = new CityIndex(cities).nearest(latLonToVector3(30.9, 121.2), 2);
    expect(result[0].id).toBe('shanghai');
    expect(result).toHaveLength(2);
  });
});
