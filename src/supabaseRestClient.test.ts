import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseRestClient } from './supabaseRestClient';

const config = {
  url: 'https://project.supabase.co',
  publishableKey: 'sb_publishable_test',
  mediaBucket: 'archive-media'
};

describe('SupabaseRestClient', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('persists a password session and authenticates user requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600,
        user: { id: 'user-a', email: 'editor@example.com' }
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'archive-a' }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SupabaseRestClient(config);

    await client.signInWithPassword('editor@example.com', 'secret-password');
    await client.request('/rest/v1/archives', {}, true);

    expect(fetchMock.mock.calls[0][0]).toBe('https://project.supabase.co/auth/v1/token?grant_type=password');
    const authHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(authHeaders.Authorization).toBeUndefined();
    const headers = fetchMock.mock.calls[1][1].headers as Headers;
    expect(headers.get('apikey')).toBe('sb_publishable_test');
    expect(headers.get('Authorization')).toBe('Bearer access-token');
    expect(new SupabaseRestClient(config).currentSession()?.user.email).toBe('editor@example.com');
  });

  it('uses only the publishable key for anonymous reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SupabaseRestClient(config);

    await client.request('/rest/v1/archives');

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('apikey')).toBe('sb_publishable_test');
    expect(headers.get('Authorization')).toBeNull();
  });
});
