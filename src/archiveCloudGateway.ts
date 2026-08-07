import { validateArchiveRecord } from './archiveBackup';
import type { ArchiveImage, ArchiveMutation, EthnographyArchive } from './types';
import { CloudApiError, SupabaseRestClient, type CloudUser } from './supabaseRestClient';

interface RemoteArchiveRow {
  id: string;
  owner_id: string;
  visibility: 'private' | 'public';
  place_id: string;
  place_snapshot: EthnographyArchive['place'];
  document: Record<string, unknown>;
  revision: number;
  change_sequence: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MutationResponse {
  status: 'applied' | 'duplicate' | 'conflict';
  archive?: RemoteArchiveRow;
}

export interface RemoteChange {
  archiveId: string;
  archive?: EthnographyArchive;
  revision: number;
  sequence: number;
  deleted: boolean;
}

function remoteDocument(archive: EthnographyArchive) {
  const source = structuredClone(archive);
  const stripSignedUrl = (image: ArchiveImage | undefined) => {
    if (image?.type === 'storage') delete image.url;
  };
  stripSignedUrl(source.bookCover);
  stripSignedUrl(source.authorImage);
  for (const edition of source.editions ?? []) stripSignedUrl(edition.bookCover);
  const {
    id: _id, ownerId: _ownerId, placeId: _placeId, place: _place,
    createdAt: _createdAt, updatedAt: _updatedAt, syncStatus: _syncStatus,
    visibility: _visibility, revision: _revision, serverSequence: _serverSequence,
    ...document
  } = source;
  return document;
}

function rowArchive(row: RemoteArchiveRow) {
  return validateArchiveRecord({
    ...row.document,
    id: row.id,
    ownerId: row.owner_id,
    placeId: row.place_id,
    place: row.place_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: 'synced',
    visibility: row.visibility,
    revision: row.revision,
    serverSequence: row.change_sequence
  });
}

function imageExtension(type: string) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[type] ?? 'bin';
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function dataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export class ArchiveMediaGateway {
  constructor(private readonly client: SupabaseRestClient) {}

  private async uploadImage(image: ArchiveImage | undefined, user: CloudUser, archiveId: string) {
    if (!image || image.type !== 'local' || !image.dataUrl) return image;
    const source = await fetch(image.dataUrl).then(response => response.blob());
    const bytes = await source.arrayBuffer();
    const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
    const path = `${user.id}/${archiveId}/${digest}.${imageExtension(source.type)}`;
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', new Blob([bytes], { type: source.type }), image.name || `archive-image.${imageExtension(source.type)}`);
    await this.client.request(`/storage/v1/object/${this.client.config.mediaBucket}/${path}`, {
      method: 'POST',
      headers: { 'x-upsert': 'true' },
      body: form
    }, true);
    return { type: 'storage' as const, path, name: image.name, alt: image.alt };
  }

  async uploadArchiveMedia(archive: EthnographyArchive, user: CloudUser) {
    const result = structuredClone(archive);
    result.bookCover = await this.uploadImage(result.bookCover, user, archive.id);
    result.authorImage = await this.uploadImage(result.authorImage, user, archive.id);
    if (result.editions) {
      for (const edition of result.editions) edition.bookCover = await this.uploadImage(edition.bookCover, user, archive.id);
    }
    return result;
  }

  private async signImage(image: ArchiveImage | undefined, requireUser: boolean) {
    if (!image || image.type !== 'storage' || !image.path) return image;
    const result = await this.client.request<{ signedURL?: string; signedUrl?: string }>(
      `/storage/v1/object/sign/${this.client.config.mediaBucket}/${image.path}`,
      { method: 'POST', body: JSON.stringify({ expiresIn: 3600 }) },
      requireUser
    );
    const signed = result.signedURL ?? result.signedUrl;
    return { ...image, url: signed ? `${this.client.config.url}/storage/v1${signed}` : undefined };
  }

  async resolveArchiveMedia(archive: EthnographyArchive, requireUser: boolean) {
    const result = structuredClone(archive);
    result.bookCover = await this.signImage(result.bookCover, requireUser);
    result.authorImage = await this.signImage(result.authorImage, requireUser);
    if (result.editions) {
      for (const edition of result.editions) edition.bookCover = await this.signImage(edition.bookCover, requireUser);
    }
    return result;
  }

  async materializeForBackup(archive: EthnographyArchive) {
    const result = structuredClone(archive);
    const materialize = async (image: ArchiveImage | undefined) => {
      if (!image || image.type !== 'storage') return image;
      const signed = await this.signImage(image, true);
      if (!signed?.url) throw new CloudApiError('无法读取云端图片，备份已停止', 502);
      const blob = await fetch(signed.url).then(response => {
        if (!response.ok) throw new CloudApiError('无法下载云端图片，备份已停止', response.status);
        return response.blob();
      });
      return { type: 'local' as const, dataUrl: await dataUrl(blob), name: image.name, alt: image.alt };
    };
    result.bookCover = await materialize(result.bookCover);
    result.authorImage = await materialize(result.authorImage);
    if (result.editions) for (const edition of result.editions) edition.bookCover = await materialize(edition.bookCover);
    return result;
  }
}

export class ArchiveCloudGateway {
  readonly media: ArchiveMediaGateway;

  constructor(private readonly client: SupabaseRestClient) {
    this.media = new ArchiveMediaGateway(client);
  }

  async listPublic() {
    const select = 'id,owner_id,visibility,place_id,place_snapshot,document,revision,change_sequence,created_at,updated_at,deleted_at';
    const rows = await this.client.request<RemoteArchiveRow[]>(`/rest/v1/archives?select=${select}&visibility=eq.public&deleted_at=is.null&order=updated_at.desc&limit=5000`);
    return Promise.all(rows.map(row => this.media.resolveArchiveMedia(rowArchive(row), false)));
  }

  async pullChanges(user: CloudUser, cursor: number) {
    const select = 'id,owner_id,visibility,place_id,place_snapshot,document,revision,change_sequence,created_at,updated_at,deleted_at';
    const rows = await this.client.request<RemoteArchiveRow[]>(`/rest/v1/archives?select=${select}&owner_id=eq.${encodeURIComponent(user.id)}&change_sequence=gt.${cursor}&order=change_sequence.asc&limit=5000`, {}, true);
    return Promise.all(rows.map(async row => ({
      archiveId: row.id,
      archive: row.deleted_at ? undefined : await this.media.resolveArchiveMedia(rowArchive(row), true),
      revision: row.revision,
      sequence: row.change_sequence,
      deleted: Boolean(row.deleted_at)
    } satisfies RemoteChange)));
  }

  async applyMutation(mutation: ArchiveMutation, user: CloudUser) {
    const archive = mutation.archive ? await this.media.uploadArchiveMedia(mutation.archive, user) : undefined;
    const response = await this.client.request<MutationResponse>('/rest/v1/rpc/apply_archive_mutation', {
      method: 'POST',
      body: JSON.stringify({
        p_mutation_id: mutation.mutationId,
        p_archive_id: mutation.archiveId,
        p_base_revision: mutation.baseRevision,
        p_operation: mutation.operation,
        p_document: archive ? remoteDocument(archive) : {},
        p_visibility: archive?.visibility ?? 'private',
        p_place_id: archive?.placeId ?? '',
        p_place_snapshot: archive?.place ?? {}
      })
    }, true);
    return {
      status: response.status,
      archive: response.archive && !response.archive.deleted_at
        ? await this.media.resolveArchiveMedia(rowArchive(response.archive), true)
        : response.archive ? rowArchive(response.archive) : undefined,
      uploadedArchive: archive
    };
  }
}
