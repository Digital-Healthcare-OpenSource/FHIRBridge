/**
 * Tests for apiClient — typed fetch wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError, setAuthToken, getAuthToken } from '../api-client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeResponse(body: unknown, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(String(body)),
    blob: vi.fn().mockResolvedValue(new Blob()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuthToken(null);
});

afterEach(() => {
  setAuthToken(null);
});

describe('apiClient.get', () => {
  it('calls fetch with correct URL including base', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ id: '1' }));
    await apiClient.get('/exports');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/exports');
  });

  it('uses GET method', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}));
    await apiClient.get('/exports');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
  });

  it('does not include Authorization header when no token', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({}));
    await apiClient.get('/exports');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('sends JWT-shaped token as Authorization: Bearer', async () => {
    // 3 segment base64url — server verify Bearer như JWT (HS256)
    setAuthToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln');
    mockFetch.mockResolvedValueOnce(makeResponse({}));
    await apiClient.get('/exports');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln');
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('routes dotted API key (3 segments, non-JWT header) via x-api-key', async () => {
    // 'prod.web.key1' có đúng 3 segment base64url nhưng segment đầu không phải
    // JSON header có "alg" — phải đi x-api-key, không được misroute thành Bearer
    setAuthToken('prod.web.key1');
    mockFetch.mockResolvedValueOnce(makeResponse({}));
    await apiClient.get('/exports');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('prod.web.key1');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('sends opaque API key via x-api-key header, not Bearer', async () => {
    // Server chỉ nhận API key qua x-api-key; Bearer với API key sẽ 401
    setAuthToken('my-token');
    mockFetch.mockResolvedValueOnce(makeResponse({}));
    await apiClient.get('/exports');
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('my-token');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns parsed JSON on success', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ items: [1, 2] }));
    const result = await apiClient.get<{ items: number[] }>('/exports');
    expect(result).toEqual({ items: [1, 2] });
  });

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ message: 'Not Found' }, 404, 'Not Found'));
    await expect(apiClient.get('/exports/missing')).rejects.toThrow(ApiError);
  });

  it('includes status code in ApiError', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ message: 'Server Error' }, 500, 'Internal Server Error'),
    );
    try {
      await apiClient.get('/fail');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
    }
  });
});

describe('apiClient.post', () => {
  it('calls fetch with POST method', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ id: 'new' }));
    await apiClient.post('/exports', { patientId: '123' });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('serializes body as JSON', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ id: 'new' }));
    await apiClient.post('/exports', { patientId: '123' });
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ patientId: '123' }));
  });
});

describe('setAuthToken / getAuthToken', () => {
  it('stores and retrieves token', () => {
    setAuthToken('abc123');
    expect(getAuthToken()).toBe('abc123');
  });

  it('clears token when set to null', () => {
    setAuthToken('abc123');
    setAuthToken(null);
    expect(getAuthToken()).toBeNull();
  });
});

describe('apiClient.download', () => {
  it('returns a Blob on success', async () => {
    const blob = new Blob(['data'], { type: 'application/json' });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(blob),
    });
    const result = await apiClient.download('/exports/1/bundle');
    expect(result).toBeInstanceOf(Blob);
  });

  it('throws ApiError when download fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });
    await expect(apiClient.download('/exports/1/bundle')).rejects.toThrow(ApiError);
  });
});
