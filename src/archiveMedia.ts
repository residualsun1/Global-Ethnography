export const MAX_ARCHIVE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MARKDOWN_NOTE_BYTES = 2 * 1024 * 1024;
export const ARCHIVE_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif';

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export class ArchiveMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveMediaError';
  }
}

export function validateArchiveImageFile(file: Pick<File, 'size' | 'type'>) {
  if (!supportedImageTypes.has(file.type.toLowerCase())) {
    throw new ArchiveMediaError('仅支持 JPG、PNG、WebP 或 GIF 图片');
  }
  if (file.size > MAX_ARCHIVE_IMAGE_BYTES) {
    throw new ArchiveMediaError('图片不能超过 5 MB');
  }
}

export function normalizeHttpsImageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ArchiveMediaError('请输入完整的图片网址');
  }
  if (url.protocol !== 'https:') throw new ArchiveMediaError('外链图片必须使用 HTTPS');
  return url.toString();
}
