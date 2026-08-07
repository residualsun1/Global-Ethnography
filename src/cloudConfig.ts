export interface CloudConfig {
  url: string;
  publishableKey: string;
  mediaBucket: string;
}

function normalizedUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function cloudConfig(): CloudConfig | undefined {
  const url = normalizedUrl(import.meta.env.VITE_SUPABASE_URL);
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return undefined;
  return {
    url,
    publishableKey,
    mediaBucket: import.meta.env.VITE_SUPABASE_MEDIA_BUCKET?.trim() || 'archive-media'
  };
}
