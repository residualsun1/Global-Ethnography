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
});
