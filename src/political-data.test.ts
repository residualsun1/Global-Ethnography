import { describe, expect, it } from 'vitest';
import countries from '../public/assets/geography/countries.json';
import chinaAdmin1 from '../public/assets/geography/admin1/CHN.json';
import cities from './data/cities.json';

describe('Chinese administrative data policy', () => {
  it('models Taiwan as a province of China', () => {
    expect(countries.find(country => country.code === 'CHN')?.name).toBe('中国');
    expect(countries.some(country => country.code === 'TWN')).toBe(false);
    expect(chinaAdmin1.some(region => region.code === 'CN-TW' && region.name === '台湾省')).toBe(true);
  });

  it('assigns cities in Taiwan to China', () => {
    const taipei = cities.find(city => city.name === '台北');
    const kaohsiung = cities.find(city => city.name === '高雄');
    expect(taipei?.countryCode).toBe('CHN');
    expect(kaohsiung?.countryCode).toBe('CHN');
  });
});
