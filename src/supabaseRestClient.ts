import type { CloudConfig } from './cloudConfig';

const SESSION_KEY = 'ethnographic-archive-cloud-session';

export interface CloudUser {
  id: string;
  email?: string;
}

export interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: CloudUser;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: CloudUser;
}

export class CloudApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: unknown) {
    super(message);
    this.name = 'CloudApiError';
  }
}

function storedSession(): CloudSession | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Partial<CloudSession> | null;
    if (!parsed?.accessToken || !parsed.refreshToken || !parsed.expiresAt || !parsed.user?.id) return undefined;
    return parsed as CloudSession;
  } catch {
    return undefined;
  }
}

async function responseBody(response: Response) {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object') {
    const source = body as Record<string, unknown>;
    const message = source.msg ?? source.message ?? source.error_description ?? source.error;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export class SupabaseRestClient {
  private session = storedSession();
  private refreshPromise?: Promise<CloudSession>;
  private readonly listeners = new Set<(session: CloudSession | undefined) => void>();

  constructor(readonly config: CloudConfig) {}

  currentSession() { return this.session; }

  onSessionChange(listener: (session: CloudSession | undefined) => void) {
    this.listeners.add(listener);
    listener(this.session);
    return () => { this.listeners.delete(listener); };
  }

  private setSession(session: CloudSession | undefined) {
    this.session = session;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    for (const listener of this.listeners) listener(session);
  }

  private fromAuthResponse(response: AuthResponse): CloudSession {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: response.expires_at ?? Math.floor(Date.now() / 1000) + response.expires_in,
      user: response.user
    };
  }

  private async authRequest(path: string, body?: unknown, accessToken?: string) {
    const headers: Record<string, string> = {
      apikey: this.config.publishableKey,
      'Content-Type': 'application/json'
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${this.config.url}/auth/v1/${path}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await responseBody(response);
    if (!response.ok) throw new CloudApiError(errorMessage(result, '身份认证失败'), response.status, result);
    return result;
  }

  async signInWithPassword(email: string, password: string) {
    const result = await this.authRequest('token?grant_type=password', { email, password }) as AuthResponse;
    const session = this.fromAuthResponse(result);
    this.setSession(session);
    return session;
  }

  async refreshSession() {
    if (!this.session) throw new CloudApiError('登录状态已失效', 401);
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const result = await this.authRequest('token?grant_type=refresh_token', { refresh_token: this.session?.refreshToken }) as AuthResponse;
        const session = this.fromAuthResponse(result);
        this.setSession(session);
        return session;
      } catch (error) {
        this.setSession(undefined);
        throw error;
      } finally {
        this.refreshPromise = undefined;
      }
    })();
    return this.refreshPromise;
  }

  async accessToken() {
    if (!this.session) return undefined;
    if (this.session.expiresAt <= Math.floor(Date.now() / 1000) + 60) await this.refreshSession();
    return this.session?.accessToken;
  }

  async signOut() {
    const token = await this.accessToken();
    try {
      if (token) await this.authRequest('logout', undefined, token);
    } finally {
      this.setSession(undefined);
    }
  }

  async request<T>(path: string, init: RequestInit = {}, requireUser = false, retry = true): Promise<T> {
    const token = requireUser ? await this.accessToken() : undefined;
    if (requireUser && !token) throw new CloudApiError('请先登录', 401);
    const headers = new Headers(init.headers);
    headers.set('apikey', this.config.publishableKey);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
    const binaryBody = init.body instanceof Blob || init.body instanceof FormData || init.body instanceof URLSearchParams || init.body instanceof ArrayBuffer;
    if (init.body && !binaryBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${this.config.url}${path}`, { ...init, headers });
    if (response.status === 401 && requireUser && retry && this.session) {
      await this.refreshSession();
      return this.request<T>(path, init, requireUser, false);
    }
    const body = await responseBody(response);
    if (!response.ok) throw new CloudApiError(errorMessage(body, `云端请求失败（${response.status}）`), response.status, body);
    return body as T;
  }
}
