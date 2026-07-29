import { describe, expect, it } from 'vitest';
import {
  ArchiveMediaError,
  MAX_ARCHIVE_IMAGE_BYTES,
  normalizeHttpsImageUrl,
  validateArchiveImageFile
} from './archiveMedia';

describe('archive media validation', () => {
  it('accepts supported image files within the size limit', () => {
    expect(() => validateArchiveImageFile({ type: 'image/webp', size: 1024 })).not.toThrow();
  });

  it('rejects unsupported or oversized image files', () => {
    expect(() => validateArchiveImageFile({ type: 'image/svg+xml', size: 1024 })).toThrow(ArchiveMediaError);
    expect(() => validateArchiveImageFile({ type: 'image/png', size: MAX_ARCHIVE_IMAGE_BYTES + 1 })).toThrow('5 MB');
  });

  it('only permits HTTPS image URLs', () => {
    expect(normalizeHttpsImageUrl('https://example.com/cover.jpg')).toBe('https://example.com/cover.jpg');
    expect(() => normalizeHttpsImageUrl('http://example.com/cover.jpg')).toThrow('HTTPS');
    expect(() => normalizeHttpsImageUrl('not a url')).toThrow('完整');
  });
});
