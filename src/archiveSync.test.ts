import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveCloudGateway } from './archiveCloudGateway';
import { LocalArchiveRepository } from './archiveRepository';
import { ArchiveSyncCoordinator } from './archiveSync';
import { PUBLIC_DEMO_ARCHIVES } from './demoArchives';

const user = { id: '4b4b03c9-f870-46d6-91a8-d6071eea992a', email: 'editor@example.com' };
const archive = () => ({
  ...structuredClone(PUBLIC_DEMO_ARCHIVES[0]),
  id: crypto.randomUUID(), ownerId: user.id, visibility: 'private' as const,
  revision: 0, serverSequence: undefined, syncStatus: 'pending' as const
});

describe('ArchiveSyncCoordinator', () => {
  const repository = new LocalArchiveRepository({ syncEnabled: true });

  beforeEach(async () => {
    await repository.clear();
  });

  it('acknowledges an idempotent push and marks the local record synced', async () => {
    const local = archive();
    await repository.restore([local], 'merge');
    const remote = { ...local, revision: 1, serverSequence: 1, syncStatus: 'synced' as const };
    const gateway = {
      applyMutation: vi.fn().mockResolvedValue({ status: 'applied', archive: remote }),
      pullChanges: vi.fn().mockResolvedValue([])
    } as unknown as ArchiveCloudGateway;

    const result = await new ArchiveSyncCoordinator(repository, gateway).synchronize(user);

    expect(result).toMatchObject({ pushed: 1, failed: 0, conflicts: 0 });
    await expect(repository.pendingMutations()).resolves.toEqual([]);
    await expect(repository.list()).resolves.toMatchObject([{ id: local.id, revision: 1, syncStatus: 'synced' }]);
  });

  it('keeps both versions when the server reports a revision conflict', async () => {
    const local = archive();
    await repository.restore([local], 'merge');
    const remote = { ...local, title: '云端并发版本', revision: 2, serverSequence: 2, syncStatus: 'synced' as const };
    const gateway = {
      applyMutation: vi.fn().mockResolvedValue({ status: 'conflict', archive: remote }),
      pullChanges: vi.fn().mockResolvedValue([])
    } as unknown as ArchiveCloudGateway;

    const result = await new ArchiveSyncCoordinator(repository, gateway).synchronize(user);

    expect(result.conflicts).toBe(1);
    await expect(repository.listConflicts()).resolves.toMatchObject([{
      localArchive: { title: local.title }, remoteArchive: { title: '云端并发版本' }
    }]);
  });
});
