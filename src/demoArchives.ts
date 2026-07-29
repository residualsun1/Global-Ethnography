import type { EthnographyArchive, PlaceSnapshot } from './types';

export const PUBLIC_DEMO_OWNER_ID = 'public-demo';

const pare: PlaceSnapshot = {
  id: 'demo-place-pare-kediri',
  name: '帕雷（Mojokuto）',
  originalName: 'Pare',
  kind: 'town',
  displayKind: '田野地点',
  countryCode: 'IDN',
  latitude: -7.7697,
  longitude: 112.193,
  parents: ['亚洲', '印度尼西亚', '东爪哇省'],
  source: 'openstreetmap',
  continent: '亚洲',
  hierarchy: {
    continent: '亚洲',
    country: { code: 'IDN', name: '印度尼西亚' },
    admin1: { code: 'ID-JI', name: '东爪哇省' }
  }
};

export const PUBLIC_DEMO_ARCHIVES: readonly EthnographyArchive[] = [{
  id: 'demo-the-religion-of-java',
  ownerId: PUBLIC_DEMO_OWNER_ID,
  placeId: pare.id,
  place: pare,
  title: 'The Religion of Java',
  locationName: 'Mojokuto（研究中使用的化名，田野地点位于东爪哇帕雷）',
  authors: ['Clifford Geertz'],
  contributors: [{
    id: 'demo-author-clifford-geertz',
    name: 'Clifford Geertz',
    nationality: { countryCode: 'USA', name: '美国' }
  }],
  fieldwork: [{
    id: 'demo-fieldwork-java-1952-1954',
    authorId: 'demo-author-clifford-geertz',
    placeId: pare.id,
    place: pare,
    start: '1952',
    end: '1954'
  }],
  translators: [],
  publishedDate: '1960',
  publisher: 'The Free Press',
  reader: '公开演示',
  bookCover: undefined,
  authorImage: undefined,
  summary: '本书以化名“Mojokuto”的东爪哇城镇为中心，讨论爪哇宗教生活内部的差异、冲突，以及宗教信仰与社会整合之间的关系。',
  readingNote: {
    fileName: '公开资料来源.md',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    content: [
      '## 公开资料来源',
      '',
      '- [University of Chicago Press：The Religion of Java](https://press.uchicago.edu/ucp/books/book/chicago/R/bo3627129.html)',
      '- [Yale eHRAF：1952–1954 年东爪哇田野资料](https://ehrafworldcultures.yale.edu/cultures/oe05/documents/017)',
      '- [Institute for Advanced Study：Pare 田野档案](https://albert.ias.edu/entities/archivalmaterial/82ce4717-f874-48de-88b8-623ea46f1b79)',
      '',
      '> 此条目用于展示项目功能，不包含私人阅读记录或受版权保护的封面图片。'
    ].join('\n')
  },
  tags: ['宗教', '社会结构', '爪哇'],
  editions: [{
    id: 'demo-edition-religion-java-1960',
    role: 'original',
    languageCode: 'en',
    title: 'The Religion of Java',
    publisher: 'The Free Press',
    publishedDate: '1960',
    translators: [],
    summary: 'A study of variation and conflict in Javanese religious life and their relationship to social integration.'
  }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  syncStatus: 'synced'
}];

export function isPublicDemoArchive(archive: Pick<EthnographyArchive, 'ownerId'>) {
  return archive.ownerId === PUBLIC_DEMO_OWNER_ID;
}
