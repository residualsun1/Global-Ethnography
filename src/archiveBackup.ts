import type {
  ArchiveAuthor,
  ArchiveImage,
  EthnographyArchive,
  EthnographyEdition,
  FieldworkLeg,
  MarkdownNote,
  PlaceSnapshot,
  SyncStatus
} from './types';

export const ARCHIVE_BACKUP_FORMAT = 'ethnographic-archive-backup';
export const ARCHIVE_BACKUP_SCHEMA_VERSION = 1;
export const MAX_ARCHIVE_IMPORT_BYTES = 20 * 1024 * 1024;
export const ARCHIVE_BACKUP_APP_VERSION = '1.0.0';
const MAX_ARCHIVE_COUNT = 5_000;
const placeKinds = new Set(['country', 'province', 'island', 'district', 'county', 'city', 'town', 'village']);
const syncStatuses = new Set<SyncStatus>(['local', 'synced', 'pending', 'error']);

export interface ArchiveBackup {
  format: typeof ARCHIVE_BACKUP_FORMAT;
  schemaVersion: typeof ARCHIVE_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  appVersion: string;
  archives: EthnographyArchive[];
}

export class ArchiveBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveBackupError';
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveBackupError(`${label}不是有效对象`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, allowEmpty = true) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new ArchiveBackupError(`${label}不是有效文本`);
  }
  return value;
}

function optionalString(value: unknown, label: string) {
  return value === undefined ? undefined : stringValue(value, label);
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ArchiveBackupError(`${label}不是有效文本列表`);
  }
  return [...value] as string[];
}

function isoDate(value: unknown, label: string) {
  const result = stringValue(value, label, false);
  if (Number.isNaN(Date.parse(result))) throw new ArchiveBackupError(`${label}不是有效日期`);
  return result;
}

function image(value: unknown, label: string): ArchiveImage | undefined {
  if (value === undefined) return undefined;
  const source = record(value, label);
  if (source.type === 'url') {
    const url = stringValue(source.url, `${label}.url`, false);
    if (!url.startsWith('https://')) throw new ArchiveBackupError(`${label}.url 必须使用 HTTPS`);
    return {
      type: 'url',
      url,
      name: optionalString(source.name, `${label}.name`),
      alt: optionalString(source.alt, `${label}.alt`)
    };
  }
  if (source.type === 'local') {
    const dataUrl = stringValue(source.dataUrl, `${label}.dataUrl`, false);
    if (!/^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(dataUrl)) {
      throw new ArchiveBackupError(`${label}.dataUrl 不是受支持的图片`);
    }
    return {
      type: 'local',
      dataUrl,
      name: optionalString(source.name, `${label}.name`),
      alt: optionalString(source.alt, `${label}.alt`)
    };
  }
  throw new ArchiveBackupError(`${label}.type 不受支持`);
}

function place(value: unknown, label: string): PlaceSnapshot {
  const source = record(value, label);
  const latitude = source.latitude;
  const longitude = source.longitude;
  if (typeof latitude !== 'number' || latitude < -90 || latitude > 90) {
    throw new ArchiveBackupError(`${label}.latitude 超出范围`);
  }
  if (typeof longitude !== 'number' || longitude < -180 || longitude > 180) {
    throw new ArchiveBackupError(`${label}.longitude 超出范围`);
  }
  const kind = stringValue(source.kind, `${label}.kind`, false);
  if (!placeKinds.has(kind)) throw new ArchiveBackupError(`${label}.kind 不受支持`);
  const sourceName = stringValue(source.source, `${label}.source`, false);
  if (sourceName !== 'natural-earth' && sourceName !== 'openstreetmap') {
    throw new ArchiveBackupError(`${label}.source 不受支持`);
  }
  const hierarchySource = source.hierarchy === undefined ? undefined : record(source.hierarchy, `${label}.hierarchy`);
  const countrySource = hierarchySource?.country === undefined ? undefined : record(hierarchySource.country, `${label}.hierarchy.country`);
  const admin1Source = hierarchySource?.admin1 === undefined ? undefined : record(hierarchySource.admin1, `${label}.hierarchy.admin1`);
  return {
    id: stringValue(source.id, `${label}.id`, false),
    name: stringValue(source.name, `${label}.name`, false),
    originalName: optionalString(source.originalName, `${label}.originalName`),
    kind: kind as PlaceSnapshot['kind'],
    displayKind: optionalString(source.displayKind, `${label}.displayKind`),
    countryCode: optionalString(source.countryCode, `${label}.countryCode`),
    latitude,
    longitude,
    parents: stringArray(source.parents, `${label}.parents`),
    source: sourceName,
    continent: optionalString(source.continent, `${label}.continent`),
    hierarchy: hierarchySource ? {
      continent: optionalString(hierarchySource.continent, `${label}.hierarchy.continent`),
      country: countrySource ? {
        code: stringValue(countrySource.code, `${label}.hierarchy.country.code`, false),
        name: stringValue(countrySource.name, `${label}.hierarchy.country.name`, false)
      } : undefined,
      admin1: admin1Source ? {
        code: optionalString(admin1Source.code, `${label}.hierarchy.admin1.code`),
        name: stringValue(admin1Source.name, `${label}.hierarchy.admin1.name`, false)
      } : undefined
    } : undefined
  };
}

function contributor(value: unknown, label: string): ArchiveAuthor {
  const source = record(value, label);
  const nationality = source.nationality === undefined ? undefined : record(source.nationality, `${label}.nationality`);
  return {
    id: stringValue(source.id, `${label}.id`, false),
    name: stringValue(source.name, `${label}.name`, false),
    nationality: nationality ? {
      countryCode: optionalString(nationality.countryCode, `${label}.nationality.countryCode`),
      name: stringValue(nationality.name, `${label}.nationality.name`, false)
    } : undefined
  };
}

function fieldwork(value: unknown, label: string): FieldworkLeg {
  const source = record(value, label);
  return {
    id: stringValue(source.id, `${label}.id`, false),
    authorId: stringValue(source.authorId, `${label}.authorId`, false),
    placeId: stringValue(source.placeId, `${label}.placeId`, false),
    place: place(source.place, `${label}.place`),
    start: optionalString(source.start, `${label}.start`),
    end: optionalString(source.end, `${label}.end`)
  };
}

function edition(value: unknown, label: string): EthnographyEdition {
  const source = record(value, label);
  const role = stringValue(source.role, `${label}.role`, false);
  if (role !== 'original' && role !== 'translation') throw new ArchiveBackupError(`${label}.role 不受支持`);
  return {
    id: stringValue(source.id, `${label}.id`, false),
    role,
    languageCode: stringValue(source.languageCode, `${label}.languageCode`, false),
    title: stringValue(source.title, `${label}.title`, false),
    publisher: optionalString(source.publisher, `${label}.publisher`),
    publishedDate: optionalString(source.publishedDate, `${label}.publishedDate`),
    isbn: optionalString(source.isbn, `${label}.isbn`),
    translators: stringArray(source.translators, `${label}.translators`),
    bookCover: image(source.bookCover, `${label}.bookCover`),
    summary: optionalString(source.summary, `${label}.summary`)
  };
}

function note(value: unknown, label: string): MarkdownNote | undefined {
  if (value === undefined) return undefined;
  const source = record(value, label);
  return {
    fileName: stringValue(source.fileName, `${label}.fileName`, false),
    content: stringValue(source.content, `${label}.content`),
    uploadedAt: isoDate(source.uploadedAt, `${label}.uploadedAt`)
  };
}

function archive(value: unknown, index: number): EthnographyArchive {
  const label = `archives[${index}]`;
  const source = record(value, label);
  const status = stringValue(source.syncStatus, `${label}.syncStatus`, false);
  if (!syncStatuses.has(status as SyncStatus)) throw new ArchiveBackupError(`${label}.syncStatus 不受支持`);
  const contributorsSource = source.contributors;
  const fieldworkSource = source.fieldwork;
  const editionsSource = source.editions;
  if (!Array.isArray(contributorsSource)) throw new ArchiveBackupError(`${label}.contributors 不是有效列表`);
  if (!Array.isArray(fieldworkSource)) throw new ArchiveBackupError(`${label}.fieldwork 不是有效列表`);
  if (editionsSource !== undefined && !Array.isArray(editionsSource)) throw new ArchiveBackupError(`${label}.editions 不是有效列表`);
  return {
    id: stringValue(source.id, `${label}.id`, false),
    ownerId: optionalString(source.ownerId, `${label}.ownerId`),
    placeId: stringValue(source.placeId, `${label}.placeId`, false),
    place: place(source.place, `${label}.place`),
    title: stringValue(source.title, `${label}.title`, false),
    locationName: stringValue(source.locationName, `${label}.locationName`, false),
    authors: stringArray(source.authors, `${label}.authors`),
    contributors: contributorsSource.map((item, itemIndex) => contributor(item, `${label}.contributors[${itemIndex}]`)),
    fieldwork: fieldworkSource.map((item, itemIndex) => fieldwork(item, `${label}.fieldwork[${itemIndex}]`)),
    translators: stringArray(source.translators, `${label}.translators`),
    publishedDate: stringValue(source.publishedDate, `${label}.publishedDate`),
    publisher: stringValue(source.publisher, `${label}.publisher`),
    reader: stringValue(source.reader, `${label}.reader`),
    finishedReadingDate: optionalString(source.finishedReadingDate, `${label}.finishedReadingDate`),
    bookCover: image(source.bookCover, `${label}.bookCover`),
    authorImage: image(source.authorImage, `${label}.authorImage`),
    summary: stringValue(source.summary, `${label}.summary`),
    readingNote: note(source.readingNote, `${label}.readingNote`),
    tags: stringArray(source.tags, `${label}.tags`),
    editions: editionsSource?.map((item, itemIndex) => edition(item, `${label}.editions[${itemIndex}]`)),
    createdAt: isoDate(source.createdAt, `${label}.createdAt`),
    updatedAt: isoDate(source.updatedAt, `${label}.updatedAt`),
    syncStatus: status as SyncStatus
  };
}

export function createArchiveBackup(archives: readonly EthnographyArchive[]): ArchiveBackup {
  return {
    format: ARCHIVE_BACKUP_FORMAT,
    schemaVersion: ARCHIVE_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: ARCHIVE_BACKUP_APP_VERSION,
    archives: [...structuredClone(archives)]
  };
}

export function serializeArchiveBackup(archives: readonly EthnographyArchive[]) {
  return JSON.stringify(createArchiveBackup(archives), null, 2);
}

export function parseArchiveBackup(text: string): ArchiveBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ArchiveBackupError('文件不是有效的 JSON');
  }
  const source = record(parsed, '备份文件');
  if (source.format !== ARCHIVE_BACKUP_FORMAT) throw new ArchiveBackupError('文件不是民族志档案备份');
  if (source.schemaVersion !== ARCHIVE_BACKUP_SCHEMA_VERSION) {
    throw new ArchiveBackupError(`暂不支持备份版本 ${String(source.schemaVersion)}`);
  }
  if (!Array.isArray(source.archives)) throw new ArchiveBackupError('备份中缺少档案列表');
  if (source.archives.length > MAX_ARCHIVE_COUNT) throw new ArchiveBackupError('备份中的档案数量过多');
  const ids = new Set<string>();
  const archives = source.archives.map((item, index) => archive(item, index));
  for (const item of archives) {
    if (ids.has(item.id)) throw new ArchiveBackupError(`备份中存在重复档案 ID：${item.id}`);
    ids.add(item.id);
  }
  return {
    format: ARCHIVE_BACKUP_FORMAT,
    schemaVersion: ARCHIVE_BACKUP_SCHEMA_VERSION,
    exportedAt: isoDate(source.exportedAt, 'exportedAt'),
    appVersion: stringValue(source.appVersion, 'appVersion', false),
    archives
  };
}
