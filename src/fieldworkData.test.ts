import { describe, expect, it } from 'vitest';
import { fieldworkForAuthor, fieldworkForNationality } from './fieldworkData';
import type { EthnographyArchive } from './types';

const place = { id: 'place-a', name: '田野地点', kind: 'city' as const, latitude: 0, longitude: 0, parents: [], source: 'openstreetmap' as const };
const archive = (start: string): EthnographyArchive => ({
  id: start, ownerId: 'local-demo-user', placeId: place.id, place, title: '民族志', locationName: place.name,
  authors: ['作者甲'], contributors: [{ id: 'author-a', name: '作者甲', nationality: { name: '中国', countryCode: 'CHN' } }],
  fieldwork: [{ id: `leg-${start}`, authorId: 'author-a', placeId: place.id, place, start }], translators: [],
  publishedDate: '', publisher: '', reader: '', summary: '', tags: [], createdAt: start, updatedAt: start, syncStatus: 'local'
});

describe('fieldworkForAuthor', () => {
  it('returns a named author’s fieldwork in chronological order', () => {
    expect(fieldworkForAuthor([archive('1980'), archive('1972')], '作者甲').map(leg => leg.start)).toEqual(['1972', '1980']);
  });
  it('groups dated fieldwork by a nationality code', () => {
    expect(fieldworkForNationality([archive('1980'), archive('1972')], 'CHN').map(item => item.leg.start)).toEqual(['1972', '1980']);
  });
  it('retains legacy nationality-name records while their codes are being migrated', () => {
    const legacy = archive('1970');
    legacy.contributors[0].nationality = { name: '中国' };
    expect(fieldworkForNationality([legacy], 'CHN', '中国')).toHaveLength(1);
  });
});
