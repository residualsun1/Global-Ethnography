import { describe, expect, it } from 'vitest';
import { GeographyIndex, geographyLevel, isDistinctAdmin1SearchResult, pointInRing } from './geography';
import type { GeoRegion } from './types';

const square: GeoRegion = { id: 'a', name: '测试国', code: 'TST', continent: '亚洲', bbox: [0, 0, 10, 10], polygons: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]] };
const province: GeoRegion = { id: 'p', name: '测试省', code: 'TS-P', countryCode: 'TST', bbox: [0, 0, 10, 10], polygons: [[[[0, 0], [7.8, 0], [7.8, 7.8], [0, 7.8], [0, 0]]]] };

describe('geography hierarchy', () => {
  it('tests polygon containment', () => {
    expect(pointInRing(5, 5, square.polygons[0][0])).toBe(true);
    expect(pointInRing(15, 5, square.polygons[0][0])).toBe(false);
  });
  it('finds country matches', () => {
    expect(new GeographyIndex({ countries: [square], admin1: [] }).lookup(5, 5).country?.name).toBe('测试国');
  });
  it('prefers a more specific country when simplified borders overlap', () => {
    const compactState: GeoRegion = { ...square, id: 'micro', name: '微型国', code: 'MIC', bbox: [4, 4, 6, 6], polygons: [[[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]] };
    expect(new GeographyIndex({ countries: [square, compactState], admin1: [] }).lookup(5, 5).country?.code).toBe('MIC');
  });
  it('keeps Singapore as a country-level archive context', () => {
    const singapore: GeoRegion = { ...square, code: 'SGP', name: '新加坡' };
    const council: GeoRegion = { ...province, code: 'SG-01', countryCode: 'SGP', name: '中区社区发展理事会' };
    const index = new GeographyIndex({ countries: [singapore], admin1: [] });
    index.setAdmin1('SGP', [council]);
    expect(index.admin1At('SGP', 2, 2)).toBeUndefined();
  });
  it('can recover administrative context for coastal points outside simplified polygons', () => {
    const index = new GeographyIndex({ countries: [square], admin1: [] });
    index.setAdmin1('TST', [province]);
    expect(index.countryByCode('TST')?.name).toBe('测试国');
    expect(index.admin1At('TST', 2, 2)?.name).toBe('测试省');
    expect(index.admin1At('TST', 8, 8)).toBeUndefined();
    expect(index.admin1NearCoast('TST', 8, 8)?.name).toBe('测试省');
  });
  it('maps camera distance to information detail', () => {
    expect(geographyLevel(6.7)).toBe('continent');
    expect(geographyLevel(5)).toBe('country');
    expect(geographyLevel(3.2)).toBe('admin1');
    expect(geographyLevel(2.3)).toBe('city');
  });
  it('suppresses an admin-1 search duplicate when it repeats its country name', () => {
    expect(isDistinctAdmin1SearchResult({ ...province, name: square.name }, square)).toBe(false);
    expect(isDistinctAdmin1SearchResult(province, square)).toBe(true);
  });
});
