/**
 * Typed fetch wrapper — all API calls go through this client.
 * Auth token is kept in memory only (never persisted).
 */

import { API_BASE_URL } from '../lib/constants';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Build an ApiError from a non-ok Response.
 *
 * Đọc body ĐÚNG MỘT LẦN qua res.text() rồi JSON.parse — gọi res.json() rồi
 * res.text() sẽ double-consume stream và ném 'body stream already read'.
 * statusText rỗng trên HTTP/2 nên message ưu tiên body.message / body.error,
 * fallback về status code.
 */
async function buildApiError(res: Response): Promise<ApiError> {
  const raw = await res.text();
  let body: unknown = raw;
  let message = `HTTP ${res.status}`;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      body = parsed;
      if (parsed && typeof parsed === 'object') {
        const p = parsed as { message?: unknown; error?: unknown };
        if (typeof p.message === 'string' && p.message) message = p.message;
        else if (typeof p.error === 'string' && p.error) message = p.error;
      }
    } catch {
      // Non-JSON body (HTML error page, plain text) — dùng raw làm message.
      message = raw;
    }
  }
  return new ApiError(res.status, message, body);
}

let _authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  _authToken = token;
}

export function getAuthToken(): string | null {
  return _authToken;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`;

  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    throw await buildApiError(res);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return request<T>('GET', path, undefined, signal);
  },
  post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>('POST', path, body, signal);
  },
  put<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    return request<T>('PUT', path, body, signal);
  },
  delete<T>(path: string, signal?: AbortSignal): Promise<T> {
    return request<T>('DELETE', path, undefined, signal);
  },

  /** Upload a file with optional metadata via FormData. */
  async upload<T>(path: string, file: File, metadata?: Record<string, string>): Promise<T> {
    const form = new FormData();
    form.append('file', file);
    if (metadata) {
      Object.entries(metadata).forEach(([k, v]) => form.append(k, v));
    }
    const headers: Record<string, string> = {};
    if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`;

    const url = `${API_BASE_URL}${path}`;
    const res = await fetch(url, { method: 'POST', headers, body: form });
    if (!res.ok) {
      throw await buildApiError(res);
    }
    return res.json() as Promise<T>;
  },

  /** Download a blob (PDF, JSON bundle, etc.). */
  async download(path: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`;
    const url = `${API_BASE_URL}${path}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}: ${res.statusText}`);
    return res.blob();
  },
};
