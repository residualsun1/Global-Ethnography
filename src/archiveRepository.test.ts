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

describe('LocalArchiveRepository cloud outbox', () => {
  const repository = new LocalArchiveRepository({ syncEnabled: true });

  beforeEach(async () => {
    await repository.clear();
  });

  it('queues imported data as a private idempotent upsert', async () => {
    const archive = privateArchive();
    await repository.restore([archive], 'merge');

    await expect(repository.list()).resolves.toMatchObject([{ id: archive.id, visibility: 'private', syncStatus: 'pending' }]);
    await expect(repository.pendingMutations()).resolves.toMatchObject([{
      archiveId: archive.id, operation: 'upsert', baseRevision: 0
    }]);
  });

  it('does not overwrite a pending local edit when an acknowledgement arrives', async () => {
    const archive = privateArchive();
    await repository.restore([archive], 'merge');
    const firstMutation = (await repository.pendingMutations())[0];
    await repository.update(archive.id, { title: '确认期间的新编辑' });

    await repository.acknowledgeMutation(firstMutation, {
      ...archive, ownerId: 'user-a', revision: 1, serverSequence: 1, syncStatus: 'synced', visibility: 'private'
    });

    await expect(repository.list()).resolves.toMatchObject([{ title: '确认期间的新编辑', revision: 1, syncStatus: 'pending' }]);
    await expect(repository.pendingMutations()).resolves.toMatchObject([{ archiveId: archive.id, baseRevision: 1 }]);
  });

  it('records a conflict instead of silently replacing local data', async () => {
    const archive = privateArchive();
    await repository.restore([archive], 'merge');
    await repository.applyRemoteArchive({
      ...archive, ownerId: 'user-a', title: '云端版本', revision: 2, serverSequence: 4, syncStatus: 'synced', visibility: 'private'
    });

    await expect(repository.list()).resolves.toMatchObject([{ title: '私人测试档案', syncStatus: 'conflict' }]);
    await expect(repository.listConflicts()).resolves.toMatchObject([{
      archiveId: archive.id,
      localArchive: { title: '私人测试档案' },
      remoteArchive: { title: '云端版本' }
    }]);
  });

  it('claims legacy local archives only after an explicit action', async () => {
    const localRepository = new LocalArchiveRepository();
    const archive = privateArchive();
    await localRepository.restore([archive], 'merge');

    expect(await repository.pendingMutations()).toEqual([]);
    expect(await repository.claimLocalArchives('7f153f53-9f67-46c2-8fd7-f5ad5c28f113')).toBe(1);
    await expect(repository.list()).resolves.toMatchObject([{
      ownerId: '7f153f53-9f67-46c2-8fd7-f5ad5c28f113', visibility: 'private', syncStatus: 'pending'
    }]);
  });
});
