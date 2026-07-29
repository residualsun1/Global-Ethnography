import { describe, expect, it } from 'vitest';
import { isCompactCountry } from './EarthScene';

describe('compact country and territory selection fallback', () => {
  it('allows American Samoa to fall back to its country/territory boundary', () => {
    expect(isCompactCountry({ bbox: [-170.8205, -14.3598, -170.5681, -14.2574] })).toBe(true);
  });

  it('does not replace local place selection across a large country', () => {
    expect(isCompactCountry({ bbox: [-125, 24, -66, 49] })).toBe(false);
  });
});
