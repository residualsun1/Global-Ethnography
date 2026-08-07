import { ArchiveCloudGateway } from './archiveCloudGateway';
import { LocalArchiveRepository } from './archiveRepository';
import type { ArchiveConflict } from './types';
import type { CloudUser } from './supabaseRestClient';

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  failed: number;
}

export class ArchiveSyncCoordinator {
  private running?: Promise<SyncResult>;

  constructor(
    private readonly repository: LocalArchiveRepository,
    private readonly gateway: ArchiveCloudGateway
  ) {}

  synchronize(user: CloudUser) {
    this.running ??= this.run(user).finally(() => { this.running = undefined; });
    return this.running;
  }

  private async run(user: CloudUser): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, failed: 0 };
    const mutations = await this.repository.pendingMutations();
    for (const mutation of mutations) {
      if (mutation.archive && mutation.archive.ownerId !== user.id) continue;
      try {
        const remote = await this.gateway.applyMutation(mutation, user);
        if (remote.status === 'conflict') {
          const conflict: ArchiveConflict = {
            archiveId: mutation.archiveId,
            localArchive: mutation.archive,
            remoteArchive: remote.archive,
            remoteRevision: remote.archive?.revision,
            detectedAt: new Date().toISOString()
          };
          await this.repository.recordConflict(conflict);
          result.conflicts += 1;
        } else {
          await this.repository.acknowledgeMutation(mutation, remote.archive ?? remote.uploadedArchive);
          result.pushed += 1;
        }
      } catch {
        await this.repository.markMutationError(mutation.archiveId);
        result.failed += 1;
      }
    }

    let cursor = await this.repository.getSyncCursor(user.id);
    while (true) {
      const changes = await this.gateway.pullChanges(user, cursor);
      let nextCursor = cursor;
      for (const change of changes) {
        if (change.deleted) await this.repository.applyRemoteDelete(change.archiveId, change.revision);
        else if (change.archive) await this.repository.applyRemoteArchive(change.archive);
        nextCursor = Math.max(nextCursor, change.sequence);
        result.pulled += 1;
      }
      if (nextCursor !== cursor) {
        await this.repository.setSyncCursor(user.id, nextCursor);
        cursor = nextCursor;
      }
      if (changes.length < 5000) break;
    }
    return result;
  }
}
