import Dexie, { type Table } from 'dexie';
import type { ArchiveConflict, ArchiveMutation, ArchiveRepository, ArchiveSyncMeta, EthnographyArchive } from './types';

const DB_NAME = 'world-ethnographic-archive';

class ArchiveDatabase extends Dexie {
  archives!: Table<EthnographyArchive, string>;
  outbox!: Table<ArchiveMutation, string>;
  syncMeta!: Table<ArchiveSyncMeta, string>;
  conflicts!: Table<ArchiveConflict, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      archives: 'id, placeId, ownerId, updatedAt'
    });
    this.version(2).stores({
      archives: 'id, placeId, ownerId, updatedAt'
    }).upgrade(transaction => transaction.table('archives').toCollection().modify(archive => {
      archive.contributors ??= (archive.authors ?? []).map((name: string, index: number) => ({ id: `legacy-author-${index}`, name }));
      archive.fieldwork ??= [];
    }));
    this.version(3).stores({
      archives: 'id, placeId, ownerId, updatedAt, syncStatus, visibility',
      outbox: '&archiveId, createdAt',
      syncMeta: '&key',
      conflicts: '&archiveId, detectedAt'
    });
  }
}

function normalizeArchive(archive: EthnographyArchive): EthnographyArchive {
  return {
    ...archive,
    reader: archive.reader ?? '未记录',
    contributors: archive.contributors ?? archive.authors.map((name, index) => ({ id: `legacy-author-${index}`, name })),
    fieldwork: archive.fieldwork ?? [],
    translators: archive.translators ?? [],
    tags: archive.tags ?? [],
    visibility: archive.visibility ?? 'private',
    revision: archive.revision ?? 0
  };
}

function pendingMutation(archive: EthnographyArchive, baseRevision = archive.revision ?? 0): ArchiveMutation {
  return {
    archiveId: archive.id,
    mutationId: crypto.randomUUID(),
    operation: 'upsert',
    baseRevision,
    archive: structuredClone({ ...archive, syncStatus: 'pending' }),
    createdAt: new Date().toISOString()
  };
}

export interface LocalArchiveRepositoryOptions {
  syncEnabled?: boolean;
}

export class LocalArchiveRepository implements ArchiveRepository {
  private readonly db: ArchiveDatabase;
  private readonly syncEnabled: boolean;

  constructor(options: LocalArchiveRepositoryOptions = {}, db = new ArchiveDatabase()) {
    this.db = db;
    this.syncEnabled = options.syncEnabled ?? false;
  }

  async list() {
    return (await this.db.archives.orderBy('updatedAt').reverse().toArray())
      .map(normalizeArchive)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listByPlace(placeId: string) {
    return (await this.db.archives.where('placeId').equals(placeId).toArray())
      .map(normalizeArchive)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: Omit<EthnographyArchive, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) {
    const now = new Date().toISOString();
    const archive: EthnographyArchive = {
      ...input,
      reader: input.reader || '未记录',
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      syncStatus: this.syncEnabled ? 'pending' : 'local',
      visibility: input.visibility ?? 'private',
      revision: input.revision ?? 0
    };
    await this.db.transaction('rw', this.db.archives, this.db.outbox, async () => {
      await this.db.archives.add(archive);
      if (this.syncEnabled) await this.db.outbox.put(pendingMutation(archive, 0));
    });
    return archive;
  }

  async update(id: string, input: Partial<Omit<EthnographyArchive, 'id' | 'createdAt'>>) {
    const existing = await this.db.archives.get(id);
    if (!existing) throw new Error(`Archive not found: ${id}`);
    const next: EthnographyArchive = normalizeArchive({
      ...existing,
      ...input,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      syncStatus: this.syncEnabled ? 'pending' : (input.syncStatus ?? 'local')
    });
    await this.db.transaction('rw', this.db.archives, this.db.outbox, async () => {
      await this.db.archives.put(next);
      if (this.syncEnabled) await this.db.outbox.put(pendingMutation(next, existing.revision ?? 0));
    });
    return next;
  }

  async remove(id: string) {
    const existing = await this.db.archives.get(id);
    await this.db.transaction('rw', this.db.archives, this.db.outbox, async () => {
      await this.db.archives.delete(id);
      if (this.syncEnabled && existing) {
        await this.db.outbox.put({
          archiveId: id,
          mutationId: crypto.randomUUID(),
          operation: 'delete',
          baseRevision: existing.revision ?? 0,
          createdAt: new Date().toISOString()
        });
      }
    });
  }

  async restore(archives: EthnographyArchive[], mode: 'merge' | 'replace') {
    const normalized = archives.map(archive => normalizeArchive({
      ...structuredClone(archive),
      syncStatus: this.syncEnabled ? 'pending' : 'local',
      visibility: archive.visibility ?? 'private',
      revision: archive.revision ?? 0
    }));
    let restoredCount = 0;
    await this.db.transaction('rw', this.db.archives, this.db.outbox, async () => {
      if (mode === 'replace') {
        await this.db.archives.clear();
        await this.db.outbox.clear();
        await this.db.archives.bulkPut(normalized);
        if (this.syncEnabled) await this.db.outbox.bulkPut(normalized.map(item => pendingMutation(item)));
        restoredCount = normalized.length;
        return;
      }
      const existing = await this.db.archives.bulkGet(normalized.map(archive => archive.id));
      const newest = normalized.filter((archive, index) => {
        const current = existing[index];
        return !current || archive.updatedAt >= current.updatedAt;
      });
      await this.db.archives.bulkPut(newest);
      if (this.syncEnabled) await this.db.outbox.bulkPut(newest.map(item => pendingMutation(item)));
      restoredCount = newest.length;
    });
    return restoredCount;
  }

  async clear() {
    await this.db.transaction('rw', this.db.archives, this.db.outbox, this.db.conflicts, this.db.syncMeta, async () => {
      await this.db.archives.clear();
      await this.db.outbox.clear();
      await this.db.conflicts.clear();
      await this.db.syncMeta.clear();
    });
  }

  async pendingMutations() {
    return this.db.outbox.orderBy('createdAt').toArray();
  }

  async acknowledgeMutation(mutation: ArchiveMutation, remoteArchive?: EthnographyArchive) {
    await this.db.transaction('rw', this.db.archives, this.db.outbox, this.db.conflicts, async () => {
      const currentMutation = await this.db.outbox.get(mutation.archiveId);
      if (currentMutation?.mutationId === mutation.mutationId) {
        await this.db.outbox.delete(mutation.archiveId);
        if (mutation.operation === 'delete') await this.db.archives.delete(mutation.archiveId);
        else if (remoteArchive) await this.db.archives.put(normalizeArchive({ ...remoteArchive, syncStatus: 'synced' }));
      } else if (currentMutation && remoteArchive) {
        const current = await this.db.archives.get(mutation.archiveId);
        if (current) {
          const rebased = normalizeArchive({ ...current, revision: remoteArchive.revision, serverSequence: remoteArchive.serverSequence, syncStatus: 'pending' });
          await this.db.archives.put(rebased);
          await this.db.outbox.put({ ...currentMutation, baseRevision: remoteArchive.revision ?? currentMutation.baseRevision, archive: structuredClone(rebased) });
        }
      }
      await this.db.conflicts.delete(mutation.archiveId);
    });
  }

  async applyRemoteArchive(remoteArchive: EthnographyArchive) {
    const remote = normalizeArchive({ ...structuredClone(remoteArchive), syncStatus: 'synced' });
    await this.db.transaction('rw', this.db.archives, this.db.outbox, this.db.conflicts, async () => {
      const mutation = await this.db.outbox.get(remote.id);
      const local = await this.db.archives.get(remote.id);
      if (mutation && (remote.revision ?? 0) > mutation.baseRevision) {
        await this.db.conflicts.put({ archiveId: remote.id, localArchive: local, remoteArchive: remote, detectedAt: new Date().toISOString() });
        if (local) await this.db.archives.put({ ...local, syncStatus: 'conflict' });
        return;
      }
      if (!mutation) await this.db.archives.put(remote);
    });
  }

  async applyRemoteDelete(archiveId: string, revision: number) {
    await this.db.transaction('rw', this.db.archives, this.db.outbox, this.db.conflicts, async () => {
      const mutation = await this.db.outbox.get(archiveId);
      const local = await this.db.archives.get(archiveId);
      if (mutation && revision > mutation.baseRevision) {
        await this.db.conflicts.put({ archiveId, localArchive: local, remoteRevision: revision, detectedAt: new Date().toISOString() });
        if (local) await this.db.archives.put({ ...local, syncStatus: 'conflict' });
        return;
      }
      if (!mutation) await this.db.archives.delete(archiveId);
    });
  }

  async markMutationError(archiveId: string) {
    const archive = await this.db.archives.get(archiveId);
    if (archive && archive.syncStatus !== 'conflict') await this.db.archives.put({ ...archive, syncStatus: 'error' });
  }

  async recordConflict(conflict: ArchiveConflict) {
    await this.db.transaction('rw', this.db.archives, this.db.conflicts, async () => {
      await this.db.conflicts.put(structuredClone(conflict));
      const local = await this.db.archives.get(conflict.archiveId);
      if (local) await this.db.archives.put({ ...local, syncStatus: 'conflict' });
    });
  }

  async listConflicts() {
    return this.db.conflicts.orderBy('detectedAt').reverse().toArray();
  }

  async resolveConflict(archiveId: string, resolution: 'local' | 'remote') {
    const conflict = await this.db.conflicts.get(archiveId);
    if (!conflict) return;
    await this.db.transaction('rw', this.db.archives, this.db.outbox, this.db.conflicts, async () => {
      if (resolution === 'remote') {
        if (conflict.remoteArchive) await this.db.archives.put(normalizeArchive({ ...conflict.remoteArchive, syncStatus: 'synced' }));
        else await this.db.archives.delete(archiveId);
        await this.db.outbox.delete(archiveId);
      } else if (conflict.localArchive) {
        const local = normalizeArchive({
          ...conflict.localArchive,
          revision: conflict.remoteRevision ?? conflict.remoteArchive?.revision ?? conflict.localArchive.revision ?? 0,
          syncStatus: 'pending'
        });
        await this.db.archives.put(local);
        await this.db.outbox.put(pendingMutation(local, local.revision));
      }
      await this.db.conflicts.delete(archiveId);
    });
  }

  async claimLocalArchives(ownerId: string) {
    let count = 0;
    await this.db.transaction('rw', this.db.archives, this.db.outbox, async () => {
      const candidates = (await this.db.archives.toArray()).filter(archive => !archive.ownerId || archive.ownerId === 'local-demo-user');
      for (const source of candidates) {
        const archive = normalizeArchive({ ...source, ownerId, visibility: 'private', syncStatus: 'pending' });
        await this.db.archives.put(archive);
        await this.db.outbox.put(pendingMutation(archive, 0));
        count += 1;
      }
    });
    return count;
  }

  async getSyncCursor(ownerId: string) {
    return Number((await this.db.syncMeta.get(`cursor:${ownerId}`))?.value ?? '0');
  }

  async setSyncCursor(ownerId: string, cursor: number) {
    await this.db.syncMeta.put({ key: `cursor:${ownerId}`, value: String(cursor) });
  }
}
