/**
 * useConsent — quản lý cross-border AI consent state.
 *
 * Luồng:
 *  1. Khi user click "Generate Summary", gọi requestConsent().
 *  2. Hook mở modal (setModalOpen(true)) và trả về Promise<boolean>.
 *  3. User chọn "Đồng ý" hoặc "Từ chối" → resolve Promise.
 *  4. Consent được persist vào localStorage (24h TTL nếu "remember") và gửi
 *     lên API POST /api/v1/consent/record để audit.
 *
 * Version hash: SHA-256 của CONSENT_TEXT_V1 — thay đổi khi nội dung modal cập nhật.
 * localStorage key: STORAGE_KEY
 */

import { useState, useCallback, useRef } from 'react';
import { apiClient } from '../api/api-client';
import i18n from '../i18n';

// ---------------------------------------------------------------------------
// Consent text dùng để tính version hash (phải khớp nội dung modal)
// v2: bổ sung đủ 5 mục PIPA Art. 28-8 (method, recipient contact, purpose,
// refusal consequences) — hash đổi → mọi consent v1 cũ tự hết hiệu lực.
// ---------------------------------------------------------------------------
const CONSENT_TEXT_V2 =
  'FHIRBridge cross-border AI consent v2 (PIPA Art.28-8 complete): ' +
  'de-identified FHIR bundle transferred to US via TLS API call; ' +
  'recipient Anthropic/OpenAI (privacy contact per provider site); ' +
  'purpose: clinical summary generation; provider retains per ToS; ' +
  'FHIRBridge does not cache; user may decline — declining disables AI summary ' +
  'for the session, export unaffected.';

// PIPA Art. 28-8: 5 mục disclosure — modal render đủ cho MỌI locale, gửi ack
// kèm market='kr' khi UI đang chạy locale tiếng Hàn.
const PIPA_DISCLOSURES = {
  dataCategories: true,
  destinationAndMethod: true,
  recipientContact: true,
  purposeAndRetention: true,
  refusalAndConsequences: true,
} as const;

/** Deployment đang phục vụ thị trường KR? — suy từ UI locale hiện tại. */
function isKrMarket(): boolean {
  return (i18n.language ?? '').toLowerCase().startsWith('ko');
}

/** 24 giờ tính bằng ms */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const STORAGE_KEY = 'fhirbridge.consent.crossborder';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsentRecord {
  version: string;
  granted: boolean;
  timestamp: string;
  /**
   * Thời điểm hết hạn. Record được persist BẮT BUỘC phải có expiresAt — record
   * thiếu expiresAt bị coi là KHÔNG hợp lệ (xem isRecordValid). Grant không
   * "remember" chỉ sống trong React state, không ghi localStorage.
   */
  expiresAt?: string;
}

export interface UseConsentReturn {
  /** True khi có consent hợp lệ chưa hết hạn cho version hiện tại */
  hasConsent: boolean;
  /** Version hash của consent text hiện tại */
  consentVersion: string;
  /**
   * Mở modal yêu cầu consent.
   * Trả về true nếu user đồng ý, false nếu từ chối.
   * Nếu đã có consent hợp lệ, resolve ngay mà không mở modal.
   */
  requestConsent: () => Promise<boolean>;
  /** Thu hồi consent — xóa localStorage và gửi audit revoke */
  revokeConsent: () => Promise<void>;
  /** True khi modal đang mở */
  modalOpen: boolean;
  /** Gọi từ modal khi user nhấn "Đồng ý" */
  handleModalAccept: (rememberSession: boolean) => void;
  /** Gọi từ modal khi user nhấn "Từ chối" */
  handleModalDecline: () => void;
}

// ---------------------------------------------------------------------------
// SHA-256 via Web Crypto API (browser-native, không cần polyfill)
// ---------------------------------------------------------------------------
async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Tính version hash một lần lúc module load (promise, resolve lần đầu)
// ---------------------------------------------------------------------------
let _versionHashCache: string | null = null;

async function getVersionHash(): Promise<string> {
  if (_versionHashCache) return _versionHashCache;
  _versionHashCache = await sha256Hex(CONSENT_TEXT_V2);
  return _versionHashCache;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function readRecord(): ConsentRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConsentRecord;
  } catch {
    return null;
  }
}

function writeRecord(record: ConsentRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage có thể bị disabled trong private browsing — bỏ qua
  }
}

function deleteRecord(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // bỏ qua
  }
}

function isRecordValid(record: ConsentRecord, currentVersion: string): boolean {
  if (!record.granted) return false;
  if (record.version !== currentVersion) return false;
  // Record persist KHÔNG có expiresAt = không hợp lệ. Trước đây thiếu expiresAt
  // bị coi là "không bao giờ hết hạn" → grant session-only vô tình sống mãi.
  if (!record.expiresAt) return false;
  if (new Date(record.expiresAt) < new Date()) return false;
  return true;
}

// ---------------------------------------------------------------------------
// API call để ghi audit
// ---------------------------------------------------------------------------
async function recordConsentApi(consentVersionHash: string, granted: boolean): Promise<void> {
  try {
    await apiClient.post('/v1/consent/record', {
      type: 'crossborder_ai',
      consentVersionHash,
      granted,
      // PIPA Art. 28-8: locale KO → gửi market + ack đủ 5 mục disclosure
      ...(isKrMarket() ? { market: 'kr', disclosures: PIPA_DISCLOSURES } : {}),
    });
  } catch {
    // Không block UI nếu audit call fail — lỗi sẽ được log phía server
    // Consent vẫn được ghi vào localStorage
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConsent(): UseConsentReturn {
  const [modalOpen, setModalOpen] = useState(false);
  const [consentVersion, setConsentVersion] = useState<string>('');
  // Grant "không remember": chỉ sống trong session React state, KHÔNG persist.
  const [sessionGranted, setSessionGranted] = useState(false);
  // PIPA: đã từ chối trong session này → AI summary disabled, không hỏi lại
  // cho tới khi reload (export và tính năng khác không ảnh hưởng).
  const [sessionDeclined, setSessionDeclined] = useState(false);

  // Promise resolver để bridge giữa async requestConsent() và UI callbacks
  const resolverRef = useRef<((granted: boolean) => void) | null>(null);

  // Lazy-init version hash
  const ensureVersion = useCallback(async (): Promise<string> => {
    const hash = await getVersionHash();
    setConsentVersion(hash);
    return hash;
  }, []);

  // Kiểm tra consent hợp lệ: ưu tiên session grant, rồi tới localStorage record
  const checkExisting = useCallback(async (): Promise<boolean> => {
    const version = await ensureVersion();
    if (sessionGranted) return true;
    const record = readRecord();
    return record !== null && isRecordValid(record, version);
  }, [ensureVersion, sessionGranted]);

  // hasConsent là synchronous check (dùng cached version nếu có)
  const hasConsent = (() => {
    if (sessionGranted) return true;
    if (!_versionHashCache) return false;
    const record = readRecord();
    return record !== null && isRecordValid(record, _versionHashCache);
  })();

  const requestConsent = useCallback(async (): Promise<boolean> => {
    // Đã decline trong session → không mở lại modal, AI summary vẫn disabled
    if (sessionDeclined) return false;

    // Kiểm tra có consent hợp lệ chưa
    const alreadyGranted = await checkExisting();
    if (alreadyGranted) return true;

    // Mở modal và chờ user chọn
    setModalOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, [checkExisting, sessionDeclined]);

  const handleModalAccept = useCallback(
    (rememberSession: boolean) => {
      setModalOpen(false);

      // Accept xoá trạng thái declined của session (user đổi ý)
      setSessionDeclined(false);

      // Tính version hash và ghi consent
      void (async () => {
        const version = await ensureVersion();
        const now = new Date();
        if (rememberSession) {
          // Persist 24h vào localStorage
          const record: ConsentRecord = {
            version,
            granted: true,
            timestamp: now.toISOString(),
            expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
          };
          writeRecord(record);
          setSessionGranted(false);
        } else {
          // KHÔNG remember: chỉ giữ trong React state, xóa mọi record persist cũ
          // để không vô tình để lại grant "không hết hạn".
          deleteRecord();
          setSessionGranted(true);
        }
        await recordConsentApi(version, true);
        resolverRef.current?.(true);
        resolverRef.current = null;
      })();
    },
    [ensureVersion],
  );

  const handleModalDecline = useCallback(() => {
    setModalOpen(false);
    // PIPA: decline → disable AI summary cho session, không hỏi lại
    setSessionDeclined(true);

    void (async () => {
      const version = await ensureVersion();
      // Xóa consent cũ nếu có
      setSessionGranted(false);
      deleteRecord();
      await recordConsentApi(version, false);
      resolverRef.current?.(false);
      resolverRef.current = null;
    })();
  }, [ensureVersion]);

  const revokeConsent = useCallback(async (): Promise<void> => {
    const version = await ensureVersion();
    setSessionGranted(false);
    deleteRecord();
    await recordConsentApi(version, false);
  }, [ensureVersion]);

  return {
    hasConsent,
    consentVersion,
    requestConsent,
    revokeConsent,
    modalOpen,
    handleModalAccept,
    handleModalDecline,
  };
}
