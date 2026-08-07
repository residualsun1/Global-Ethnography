import { describe, expect, it } from 'vitest';
import { ArchiveBackupError, parseArchiveBackup, serializeArchiveBackup } from './archiveBackup';
import { PUBLIC_DEMO_ARCHIVES } from './demoArchives';

describe('archive backup', () => {
  it('round-trips a complete archive without losing nested data', () => {
    const json = serializeArchiveBackup(PUBLIC_DEMO_ARCHIVES);
    const parsed = parseArchiveBackup(json);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.archives).toEqual(PUBLIC_DEMO_ARCHIVES);
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseArchiveBackup('{"archives":[]}')).toThrow(ArchiveBackupError);
  });

  it('rejects unsafe external image URLs', () => {
    const backup = JSON.parse(serializeArchiveBackup(PUBLIC_DEMO_ARCHIVES));
    backup.archives[0].bookCover = { type: 'url', url: 'http://example.com/cover.jpg' };

    expect(() => parseArchiveBackup(JSON.stringify(backup))).toThrow('必须使用 HTTPS');
  });

  it('rejects duplicate archive ids', () => {
    const backup = JSON.parse(serializeArchiveBackup(PUBLIC_DEMO_ARCHIVES));
    backup.archives.push(structuredClone(backup.archives[0]));

    expect(() => parseArchiveBackup(JSON.stringify(backup))).toThrow('重复档案 ID');
  });

  it('round-trips cloud metadata and safe storage references', () => {
    const archive = structuredClone(PUBLIC_DEMO_ARCHIVES[0]);
    archive.visibility = 'private';
    archive.revision = 3;
    archive.serverSequence = 9;
    archive.syncStatus = 'conflict';
    archive.bookCover = { type: 'storage', path: 'user/archive/cover.webp', url: 'https://example.com/signed-cover' };

    expect(parseArchiveBackup(serializeArchiveBackup([archive])).archives[0]).toMatchObject({
      visibility: 'private', revision: 3, serverSequence: 9, syncStatus: 'conflict',
      bookCover: { type: 'storage', path: 'user/archive/cover.webp' }
    });
  });

  it('rejects unsafe storage paths', () => {
    const backup = JSON.parse(serializeArchiveBackup(PUBLIC_DEMO_ARCHIVES));
    backup.archives[0].bookCover = { type: 'storage', path: '../private/cover.png' };
    expect(() => parseArchiveBackup(JSON.stringify(backup))).toThrow('安全的对象路径');
  });
});
