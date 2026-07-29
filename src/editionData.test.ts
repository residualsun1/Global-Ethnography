import { describe, expect, it } from 'vitest';
import { archiveMatchesYear, chineseEdition, originalEdition } from './App';
import type { EthnographyArchive } from './types';

const legacy: EthnographyArchive = {
  id: 'archive-1', placeId: 'place-1',
  place: { id: 'place-1', name: '巴黎', kind: 'city', latitude: 48.86, longitude: 2.35, parents: ['欧洲', '法国'], source: 'openstreetmap' },
  title: 'Legacy title', locationName: '巴黎', authors: ['Author'], contributors: [], fieldwork: [], translators: [],
  publishedDate: '1950', publisher: 'Legacy Press', reader: 'Reader', summary: 'Summary', tags: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', syncStatus: 'local'
};

describe('bilingual edition compatibility', () => {
  it('reads an existing archive as a safe original-edition fallback', () => {
    expect(originalEdition(legacy)).toMatchObject({ title: 'Legacy title', publishedDate: '1950', role: 'original' });
    expect(chineseEdition(legacy)).toBeUndefined();
  });

  it('distinguishes first publication from Chinese translation publication', () => {
    const bilingual: EthnographyArchive = {
      ...legacy,
      editions: [
        { id: 'original', role: 'original', languageCode: 'en', title: 'Original', publishedDate: '1950', translators: [] },
        { id: 'zh', role: 'translation', languageCode: 'zh-CN', title: '中文版', publishedDate: '2001', translators: ['译者'] }
      ]
    };
    expect(archiveMatchesYear(bilingual, 'publication', 1950)).toBe(true);
    expect(archiveMatchesYear(bilingual, 'publication', 2001)).toBe(false);
    expect(archiveMatchesYear(bilingual, 'chinesePublication', 2001)).toBe(true);
  });
});
