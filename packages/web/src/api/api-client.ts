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

/**
 * JWT compact form: đúng 3 segment base64url VÀ segment đầu decode ra JSON
 * header có "alg". Check shape suông (3 dấu chấm) chưa đủ — API key server
 * chấp nhận chuỗi bất kỳ không chứa dấu phẩy, nên key kiểu `prod.web.key1`
 * sẽ bị misroute thành Bearer và 401 oan. Server chỉ nhận API key qua
 * x-api-key, còn Authorization: Bearer bị verify như JWT (HS256).
 */
function isJwtShaped(token: string): boolean {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments.every((s) => s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s))) {
    return false;
  }
  try {
    const b64 = segments[0]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const header = JSON.parse(atob(padded)) as { alg?: unknown };
    return typeof header.alg === 'string';
  } catch {
    return false;
  }
}

/** Gắn credential vào đúng header server hiểu: JWT → Bearer, API key → x-api-key. */
function buildAuthHeaders(): Record<string, string> {
  if (!_authToken) return {};
  return isJwtShaped(_authToken)
    ? { Authorization: `Bearer ${_authToken}` }
    : { 'x-api-key': _authToken };
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
  Object.assign(headers, buildAuthHeaders());

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
    Object.assign(headers, buildAuthHeaders());

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
    Object.assign(headers, buildAuthHeaders());
    const url = `${API_BASE_URL}${path}`;
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}: ${res.statusText}`);
    return res.blob();
  },
};
