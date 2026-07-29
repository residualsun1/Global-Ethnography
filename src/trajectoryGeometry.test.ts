import { describe, expect, it } from 'vitest';
import { greatCircleCoordinates, planarCoordinates, splitAntimeridian, trajectoryLegCoordinates } from './trajectoryGeometry';
import type { Place } from './types';

const place = (name: string, latitude: number, longitude: number): Place => ({
  id: name, name, kind: 'city', latitude, longitude, parents: [], source: 'openstreetmap'
});

describe('trajectory great-circle geometry', () => {
  it('keeps the real endpoints and produces a curved geographic path', () => {
    const london = place('London', 51.5072, -0.1276);
    const tokyo = place('Tokyo', 35.6762, 139.6503);
    const coordinates = greatCircleCoordinates(london, tokyo, 40);
    expect(coordinates[0][0]).toBeCloseTo(london.longitude, 5);
    expect(coordinates[0][1]).toBeCloseTo(london.latitude, 5);
    expect(coordinates.at(-1)?.[0]).toBeCloseTo(tokyo.longitude, 5);
    expect(coordinates.at(-1)?.[1]).toBeCloseTo(tokyo.latitude, 5);
    const linearMidLatitude = (london.latitude + tokyo.latitude) / 2;
    expect(Math.abs(coordinates[20][1] - linearMidLatitude)).toBeGreaterThan(5);
  });

  it('splits a shortest Pacific route at the antimeridian without a map-wide connector', () => {
    const unitedStates = place('United States', 39.5, -98.35);
    const indonesia = place('Indonesia', -2.5, 118);
    const segments = splitAntimeridian(greatCircleCoordinates(unitedStates, indonesia, 80));
    expect(segments).toHaveLength(2);
    expect(Math.abs(segments[0].at(-1)![0])).toBe(180);
    expect(Math.abs(segments[1][0][0])).toBe(180);
    for (const segment of segments) {
      for (let index = 1; index < segment.length; index += 1) {
        expect(Math.abs(segment[index][0] - segment[index - 1][0])).toBeLessThan(180);
      }
    }
  });

  it('keeps multiple fieldwork legs fanned out from the shared origin', () => {
    const unitedStates = place('United States', 39.5, -98.35);
    const java = place('Java', -7.5, 110);
    const bali = place('Bali', -8.4, 115.2);
    const legs = trajectoryLegCoordinates([
      { place: unitedStates },
      { place: java, start: '1952' },
      { place: bali, start: '1957' }
    ], 20);
    expect(legs).toHaveLength(2);
    expect(legs[1][0][0]).toBeCloseTo(unitedStates.longitude, 5);
    expect(legs[1][0][1]).toBeCloseTo(unitedStates.latitude, 5);
    expect(legs[1].at(-1)?.[0]).toBeCloseTo(bali.longitude, 5);
    expect(legs[1].at(-1)?.[1]).toBeCloseTo(bali.latitude, 5);
  });

  it('uses a direct single-frame route in flat map view instead of crossing the screen boundary', () => {
    const unitedStates = place('United States', 39.5, -98.35);
    const indonesia = place('Indonesia', -2.5, 118);
    const coordinates = planarCoordinates(unitedStates, indonesia, 20);
    expect(coordinates[0]).toEqual([unitedStates.longitude, unitedStates.latitude]);
    expect(coordinates.at(-1)).toEqual([indonesia.longitude, indonesia.latitude]);
    for (let index = 1; index < coordinates.length; index += 1) {
      expect(Math.abs(coordinates[index][0] - coordinates[index - 1][0])).toBeLessThan(180);
    }
    expect(coordinates[10][0]).toBeCloseTo((unitedStates.longitude + indonesia.longitude) / 2, 5);
  });
});
