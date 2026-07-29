import { describe, expect, it } from 'vitest';
import { administrativeTerm, geographyLevelLabel, placeKindLabel } from './adminLabels';

describe('administrative display labels', () => {
  it('uses country-specific Chinese administrative terms when they are known', () => {
    expect(administrativeTerm('CHN', 'adm1')).toBe('省级行政区');
    expect(administrativeTerm('CHN', 'adm3')).toBe('县级行政区');
    expect(administrativeTerm('USA', 'adm1')).toContain('州');
    expect(administrativeTerm('FRA', 'adm1')).toContain('大区');
  });

  it('falls back to neutral ADM labels instead of guessing local systems', () => {
    expect(administrativeTerm('TST', 'adm1')).toBe('一级行政区');
    expect(administrativeTerm(undefined, 'adm2')).toBe('二级行政区');
  });

  it('separates administrative areas from settlements and natural places', () => {
    expect(geographyLevelLabel('continent')).toBe('大洲 / 地理区域');
    expect(placeKindLabel('county', 'CHN')).toBe('县级行政区');
    expect(placeKindLabel('city', 'CHN')).toBe('城市');
    expect(placeKindLabel('island', 'CHN')).toBe('岛屿');
  });
});
