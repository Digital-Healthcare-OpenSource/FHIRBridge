/**
 * SSRF Validator — ngăn chặn Server-Side Request Forgery.
 *
 * Chặn các request đến:
 * - Private/loopback IPv4 ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16)
 * - IPv6 loopback (::1), ULA (fc00::/7), link-local (fe80::/10), IPv4-mapped
 * - Cloud metadata endpoints (AWS, GCP, Azure)
 * - Schemes không phải http/https (javascript:, file:, data:, ftp:)
 * - Decimal/hex/octal IP representations (normalize trước khi match)
 * - URLs có userinfo (user:pass@host)
 *
 * TODO(DNS rebinding mitigation): DNS resolution xảy ra tại connect-time, không tại
 * validate-time. Để chống DNS rebinding (resolve về IP hợp lệ sau đó đổi về nội bộ),
 * cần implement connect-then-validate: sau khi TCP connect, lấy actual IP từ socket
 * và re-validate. Hiện tại chỉ resolve DNS và check IP trước khi connect.
 */

import { lookup } from 'node:dns/promises';

/** Kết quả validate — discriminated union để caller không thể bỏ qua lỗi */
export type ValidateBaseUrlResult = { ok: true } | { ok: false; reason: string };

/** Metadata endpoint hostnames cần chặn tuyệt đối */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '169.254.169.254', // AWS/GCP/Azure IMDS
  'metadata.google.internal', // GCP metadata
  'metadata.azure.com', // Azure metadata (alternative)
  'metadata.internal', // generic
  'metadata.aws.internal', // AWS metadata internal
]);

/** Schemes được phép — chỉ http và https */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Chuyển IPv4 dạng decimal/hex/octal về dạng dotted-decimal chuẩn.
 * Ví dụ: 0x7f000001 → "127.0.0.1", 017700000001 → "127.0.0.1", 2130706433 → "127.0.0.1"
 */
function normalizeIpv4(hostname: string): string | null {
  // Kiểm tra hex đầy đủ: 0x7f000001
  if (/^0x[0-9a-fA-F]+$/.test(hostname)) {
    const num = parseInt(hostname, 16);
    if (isNaN(num)) return null;
    return octetsFromUint32(num);
  }

  // Kiểm tra octal đầy đủ: 017700000001
  if (/^0[0-7]+$/.test(hostname)) {
    const num = parseInt(hostname, 8);
    if (isNaN(num)) return null;
    return octetsFromUint32(num);
  }

  // Kiểm tra decimal đầy đủ (single-integer): 2130706433
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (!isNaN(num) && num <= 0xffffffff) {
      return octetsFromUint32(num);
    }
  }

  return hostname; // giữ nguyên nếu không match
}

/** Chuyển uint32 về IPv4 dotted-decimal */
function octetsFromUint32(num: number): string {
  return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff].join('.');
}

/**
 * Kiểm tra IPv4 có thuộc private/loopback/link-local range không.
 * Input phải là dotted-decimal chuẩn.
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

  const [a, b] = octets as [number, number, number, number];

  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12 — 172.16.x.x đến 172.31.x.x
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local + AWS IMDS
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;

  return false;
}

/**
 * Kiểm tra IPv6 address có thuộc blocked range không.
 * Xử lý: ::1, fc00::/7, fe80::/10, ::ffff:<ipv4-mapped>
 */
function isBlockedIpv6(ip: string): boolean {
  // Loại bỏ brackets nếu có [::1]
  const addr = ip.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

  // Loopback
  if (addr === '::1') return true;

  // Unspecified address (::) — routes to loopback/all-interfaces on many stacks
  if (addr === '::' || addr === '::0') return true;

  // IPv4-mapped: ::ffff:x.x.x.x hoặc ::ffff:0xhex
  if (addr.startsWith('::ffff:')) {
    const ipv4Part = addr.slice(7);
    // dotted IPv4 trong IPv4-mapped
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4Part)) {
      return isPrivateIpv4(ipv4Part);
    }
    // hex packed: ::ffff:7f00:1 → 127.0.0.1
    // Block tất cả IPv4-mapped để an toàn vì thường dùng để bypass
    return true;
  }

  // ULA fc00::/7 — địa chỉ từ fc00:: đến fdff::
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true;

  // link-local fe80::/10
  if (
    addr.startsWith('fe80') ||
    addr.startsWith('fe9') ||
    addr.startsWith('fea') ||
    addr.startsWith('feb')
  ) {
    return true;
  }

  return false;
}

/**
 * Validate URL string — trả về kết quả discriminated union.
 * Không ném exception — caller kiểm tra result.ok.
 */
export function validateBaseUrl(url: string): ValidateBaseUrlResult {
  // Parse URL — bắt malformed URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `Malformed URL: ${url}` };
  }

  // Chỉ cho phép http/https
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `Scheme '${parsed.protocol}' not allowed — only http/https`,
    };
  }

  // Chặn userinfo (user:pass@host) — credential leakage vector
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason: 'URLs with userinfo (credentials) are not allowed',
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostname list (metadata endpoints, localhost variants)
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Hostname '${hostname}' is blocked` };
  }

  // Normalize decimal/hex/octal IPv4 representations
  const normalizedHostname = normalizeIpv4(hostname);
  const effectiveHostname = normalizedHostname ?? hostname;

  // Kiểm tra IPv4 private/loopback/link-local
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(effectiveHostname)) {
    if (isPrivateIpv4(effectiveHostname)) {
      return {
        ok: false,
        reason: `IP '${effectiveHostname}' is in a blocked private/loopback range`,
      };
    }
  }

  // Kiểm tra IPv6
  if (hostname.startsWith('[') || /^[0-9a-fA-F:]+$/.test(hostname)) {
    if (isBlockedIpv6(hostname)) {
      return {
        ok: false,
        reason: `IPv6 address '${hostname}' is blocked`,
      };
    }
  }

  return { ok: true };
}

/**
 * Validate URL + resolve DNS rồi validate IP đã resolve.
 * Async — thực hiện DNS lookup trước khi cho phép connect.
 *
 * TODO(DNS rebinding): Hiện tại chỉ validate tại lookup-time.
 * Để phòng DNS rebinding hoàn toàn, cần pin resolved IP vào connection
 * và verify lại sau khi TCP handshake. Xem comment ở đầu file.
 */
export async function validateBaseUrlWithDns(url: string): Promise<ValidateBaseUrlResult> {
  // Validate structural trước
  const structuralResult = validateBaseUrl(url);
  if (!structuralResult.ok) return structuralResult;

  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Bỏ qua DNS lookup nếu đã là IP address
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || /^[0-9a-fA-F:]+$/.test(hostname)) {
    return { ok: true };
  }

  // DNS resolution — kiểm tra resolved IP
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (addr.family === 4 && isPrivateIpv4(addr.address)) {
        return {
          ok: false,
          reason: `DNS resolved '${hostname}' to blocked IP '${addr.address}'`,
        };
      }
      if (addr.family === 6 && isBlockedIpv6(addr.address)) {
        return {
          ok: false,
          reason: `DNS resolved '${hostname}' to blocked IPv6 '${addr.address}'`,
        };
      }
    }
  } catch (err) {
    // DNS lookup failure — fail-safe: block nếu không resolve được
    return {
      ok: false,
      reason: `DNS lookup failed for '${hostname}': ${(err as Error).message}`,
    };
  }

  return { ok: true };
}
