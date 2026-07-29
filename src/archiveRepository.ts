import Dexie, { type Table } from 'dexie';
import type { ArchiveRepository, EthnographyArchive } from './types';

const DB_NAME = 'world-ethnographic-archive';

class ArchiveDatabase extends Dexie {
  archives!: Table<EthnographyArchive, string>;

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
  }
}

function normalizeArchive(archive: EthnographyArchive): EthnographyArchive {
  return {
    ...archive,
    reader: archive.reader ?? '未记录',
    contributors: archive.contributors ?? archive.authors.map((name, index) => ({ id: `legacy-author-${index}`, name })),
    fieldwork: archive.fieldwork ?? [],
    translators: archive.translators ?? [],
    tags: archive.tags ?? []
  };
}

export class LocalArchiveRepository implements ArchiveRepository {
  private readonly db: ArchiveDatabase;

  constructor(db = new ArchiveDatabase()) {
    this.db = db;
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
      syncStatus: 'local'
    };
    await this.db.archives.add(archive);
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
      syncStatus: input.syncStatus ?? 'local'
    });
    await this.db.archives.put(next);
    return next;
  }

  async remove(id: string) {
    await this.db.archives.delete(id);
  }

  async restore(archives: EthnographyArchive[], mode: 'merge' | 'replace') {
    const normalized = archives.map(archive => normalizeArchive({
      ...structuredClone(archive),
      syncStatus: 'local'
    }));
    let restoredCount = 0;
    await this.db.transaction('rw', this.db.archives, async () => {
      if (mode === 'replace') {
        await this.db.archives.clear();
        await this.db.archives.bulkPut(normalized);
        restoredCount = normalized.length;
        return;
      }
      const existing = await this.db.archives.bulkGet(normalized.map(archive => archive.id));
      const newest = normalized.filter((archive, index) => {
        const current = existing[index];
        return !current || archive.updatedAt >= current.updatedAt;
      });
      await this.db.archives.bulkPut(newest);
      restoredCount = newest.length;
    });
    return restoredCount;
  }

  async clear() {
    await this.db.archives.clear();
  }
}
