import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalArchiveRepository } from './archiveRepository';
import { PUBLIC_DEMO_ARCHIVES } from './demoArchives';

const privateArchive = () => ({
  ...structuredClone(PUBLIC_DEMO_ARCHIVES[0]),
  id: crypto.randomUUID(),
  ownerId: 'local-demo-user',
  title: '私人测试档案',
  syncStatus: 'local' as const
});

describe('LocalArchiveRepository restore', () => {
  const repository = new LocalArchiveRepository();

  beforeEach(async () => {
    await repository.clear();
  });

  it('restores a validated backup as local data', async () => {
    const archive = privateArchive();

    expect(await repository.restore([archive], 'replace')).toBe(1);
    await expect(repository.list()).resolves.toMatchObject([
      { id: archive.id, title: archive.title, syncStatus: 'local' }
    ]);
  });

  it('does not overwrite a newer local record during merge', async () => {
    const archive = privateArchive();
    await repository.restore([archive], 'replace');
    await repository.update(archive.id, { title: '本机较新的修改' });

    expect(await repository.restore([{ ...archive, title: '较旧备份' }], 'merge')).toBe(0);
    await expect(repository.list()).resolves.toMatchObject([
      { id: archive.id, title: '本机较新的修改' }
    ]);
  });

  it('replaces all private data atomically in replace mode', async () => {
    const first = privateArchive();
    const second = privateArchive();
    await repository.restore([first], 'replace');
    await repository.restore([second], 'replace');

    const archives = await repository.list();
    expect(archives.map(archive => archive.id)).toEqual([second.id]);
  });
});
