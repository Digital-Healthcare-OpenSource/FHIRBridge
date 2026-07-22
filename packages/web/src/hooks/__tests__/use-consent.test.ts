/**
 * Unit tests for useConsent hook.
 *
 * Stub: Web Crypto API (subtle.digest), localStorage, apiClient.post.
 * Không mock module — dùng vi.stubGlobal và localStorage in-memory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Stub Web Crypto API trước khi import hook
// ---------------------------------------------------------------------------
const mockDigest = vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xab).buffer);
vi.stubGlobal('crypto', {
  subtle: { digest: mockDigest },
});

// Stub apiClient.post để không thực sự gọi HTTP
vi.mock('../../api/api-client', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useConsent } from '../use-consent';
import { apiClient } from '../../api/api-client';

// ---------------------------------------------------------------------------
// localStorage stub (in-memory)
// ---------------------------------------------------------------------------
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => {
    localStorageStore[k] = v;
  },
  removeItem: (k: string) => {
    delete localStorageStore[k];
  },
  clear: () => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
  },
};
vi.stubGlobal('localStorage', localStorageMock);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useConsent', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset cached version hash giữa các test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__consentVersionCache = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hasConsent is false when localStorage is empty', () => {
    const { result } = renderHook(() => useConsent());
    expect(result.current.hasConsent).toBe(false);
  });

  it('modalOpen starts as false', () => {
    const { result } = renderHook(() => useConsent());
    expect(result.current.modalOpen).toBe(false);
  });

  it('requestConsent opens modal (modalOpen becomes true)', async () => {
    const { result } = renderHook(() => useConsent());

    // Gọi requestConsent nhưng không resolve promise (chưa click nút)
    act(() => {
      void result.current.requestConsent();
    });

    await waitFor(() => {
      expect(result.current.modalOpen).toBe(true);
    });
  });

  it('handleModalAccept resolves requestConsent with true and closes modal', async () => {
    const { result } = renderHook(() => useConsent());

    let granted: boolean | undefined;
    act(() => {
      void result.current.requestConsent().then((v) => {
        granted = v;
      });
    });

    await waitFor(() => expect(result.current.modalOpen).toBe(true));

    await act(async () => {
      result.current.handleModalAccept(false);
    });

    await waitFor(() => {
      expect(result.current.modalOpen).toBe(false);
      expect(granted).toBe(true);
    });
  });

  it('handleModalDecline resolves requestConsent with false and closes modal', async () => {
    const { result } = renderHook(() => useConsent());

    let granted: boolean | undefined;
    act(() => {
      void result.current.requestConsent().then((v) => {
        granted = v;
      });
    });

    await waitFor(() => expect(result.current.modalOpen).toBe(true));

    await act(async () => {
      result.current.handleModalDecline();
    });

    await waitFor(() => {
      expect(result.current.modalOpen).toBe(false);
      expect(granted).toBe(false);
    });
  });

  it('handleModalAccept calls apiClient.post with granted=true', async () => {
    const { result } = renderHook(() => useConsent());

    act(() => {
      void result.current.requestConsent();
    });
    await waitFor(() => expect(result.current.modalOpen).toBe(true));

    await act(async () => {
      result.current.handleModalAccept(false);
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/v1/consent/record',
        expect.objectContaining({ granted: true, type: 'crossborder_ai' }),
      );
    });
  });

  it('handleModalDecline calls apiClient.post with granted=false', async () => {
    const { result } = renderHook(() => useConsent());

    act(() => {
      void result.current.requestConsent();
    });
    await waitFor(() => expect(result.current.modalOpen).toBe(true));

    await act(async () => {
      result.current.handleModalDecline();
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/v1/consent/record',
        expect.objectContaining({ granted: false }),
      );
    });
  });

  it('handleModalAccept with rememberSession=true writes expiresAt to localStorage', async () => {
    const { result } = renderHook(() => useConsent());

    act(() => {
      void result.current.requestConsent();
    });
    await waitFor(() => expect(result.current.modalOpen).toBe(true));

    await act(async () => {
      result.current.handleModalAccept(true);
    });

    await waitFor(() => {
      const raw = localStorageStore['fhirbridge.consent.crossborder'];
      expect(raw).toBeDefined();
      const record = JSON.parse(raw) as { expiresAt?: string; granted: boolean };
      expect(record.granted).toBe(true);
      expect(record.expiresAt).toBeDefined();
    });
  });

  it('PIPA: sau khi decline, requestConsent tiếp theo trả false ngay (AI summary disabled cho session)', async () => {
    const { result } = renderHook(() => useConsent());

    act(() => {
      void result.current.requestConsent();
    });
    await waitFor(() => expect(result.current.modalOpen).toBe(true));

    await act(async () => {
      result.current.handleModalDecline();
    });
    await waitFor(() => expect(result.current.modalOpen).toBe(false));

    // Lần 2: không mở modal, resolve false ngay
    let second: boolean | undefined;
    await act(async () => {
      second = await result.current.requestConsent();
    });
    expect(second).toBe(false);
    expect(result.current.modalOpen).toBe(false);
  });

  it('PIPA: locale ko → consent body gửi market=kr + đủ 5 mục disclosures', async () => {
    const { default: i18n } = await import('../../i18n');
    await i18n.changeLanguage('ko');
    try {
      const { result } = renderHook(() => useConsent());

      act(() => {
        void result.current.requestConsent();
      });
      await waitFor(() => expect(result.current.modalOpen).toBe(true));

      await act(async () => {
        result.current.handleModalAccept(false);
      });

      await waitFor(() => {
        expect(apiClient.post).toHaveBeenCalledWith(
          '/v1/consent/record',
          expect.objectContaining({
            granted: true,
            market: 'kr',
            disclosures: {
              dataCategories: true,
              destinationAndMethod: true,
              recipientContact: true,
              purposeAndRetention: true,
              refusalAndConsequences: true,
            },
          }),
        );
      });
    } finally {
      await i18n.changeLanguage('vi');
    }
  });

  it('revokeConsent removes record from localStorage', async () => {
    // Pre-populate a consent record
    localStorageStore['fhirbridge.consent.crossborder'] = JSON.stringify({
      version: 'aabbcc',
      granted: true,
      timestamp: new Date().toISOString(),
    });

    const { result } = renderHook(() => useConsent());

    await act(async () => {
      await result.current.revokeConsent();
    });

    expect(localStorageStore['fhirbridge.consent.crossborder']).toBeUndefined();
  });
});
