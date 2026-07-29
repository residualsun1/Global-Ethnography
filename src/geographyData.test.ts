import { describe, expect, it } from 'vitest';
import countriesData from '../public/assets/geography/countries.json';
import clippertonAdmin1 from '../public/assets/geography/admin1/CLP.json';
import heardAdmin1 from '../public/assets/geography/admin1/HMD.json';
import indianOceanAdmin1 from '../public/assets/geography/admin1/IOT.json';
import southGeorgiaAdmin1 from '../public/assets/geography/admin1/SGS.json';
import type { GeoRegion } from './types';

const countries = countriesData as GeoRegion[];

const allowedContinents = new Set(['非洲', '南极洲', '亚洲', '欧洲', '北美洲', '大洋洲', '南美洲']);
const correctedOpenOceanAreas: Record<string, string> = {
  SGS: '南美洲',
  IOT: '非洲',
  SHN: '非洲',
  SYC: '非洲',
  MUS: '非洲',
  MDV: '亚洲',
  ATF: '非洲',
  HMD: '大洋洲',
  CLP: '北美洲'
};

describe('generated geography data', () => {
  it('contains only the seven supported continent names', () => {
    const invalid = countries.filter(country => !country.continent || !allowedContinents.has(country.continent));
    expect(invalid.map(country => ({ code: country.code, continent: country.continent }))).toEqual([]);
  });

  it('assigns Natural Earth open-ocean areas to geographic continents', () => {
    for (const [code, continent] of Object.entries(correctedOpenOceanAreas)) {
      expect(countries.find(country => country.code === code)?.continent, code).toBe(continent);
    }
  });

  it('does not emit country-duplicate placeholder admin regions', () => {
    expect([clippertonAdmin1, heardAdmin1, indianOceanAdmin1, southGeorgiaAdmin1].flat()).toEqual([]);
  });
});
