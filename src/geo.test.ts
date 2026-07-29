import { describe, expect, it } from 'vitest';
import { isClickGesture, latLonToVector3, vector3ToLatLon } from './geo';

describe('geographic conversions', () => {
  it.each([[0, 0], [90, 0], [-90, 0], [31.2304, 121.4737], [0, 179.999], [0, -179.999]])('round trips %s, %s', (lat, lon) => {
    const result = vector3ToLatLon(latLonToVector3(lat, lon));
    expect(result.latitude).toBeCloseTo(lat, 5);
    expect(result.longitude).toBeCloseTo(lon, 5);
  });
  it('distinguishes clicks from drags', () => {
    expect(isClickGesture(3, 3, 200)).toBe(true);
    expect(isClickGesture(8, 0, 100)).toBe(false);
    expect(isClickGesture(1, 1, 500)).toBe(false);
  });
});
