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
 * Operator allowlist — CONNECTOR_ALLOWED_HOSTS (comma-separated hostnames, IPv4
 * addresses, IPv4 CIDRs or host:port pairs, e.g. "his.hospital.local,10.20.0.0/16,
 * localhost:8090"). A host:port entry only opens that one port. A self-hosted
 * hospital's HIS almost always lives on a private network, which the rules above
 * block; listed entries are the explicit, opt-in way to reach it. Cloud-metadata
 * hosts and link-local 169.254.0.0/16 stay blocked even when listed.
 *
 * DNS rebinding: `validateBaseUrlWithDns` checks the addresses a hostname resolves
 * to *before* a request, but a hostile DNS server can answer differently a moment
 * later when the socket connects. `ssrfSafeLookup` closes that gap — it is passed as
 * the `lookup` of every outbound connection (see connectors/fhir-http-client.ts), so
 * the SAME answer that is validated is the one the TCP connection uses.
 */

import { lookup as dnsLookupCallback } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
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

/** Never reachable, even when an operator lists them in CONNECTOR_ALLOWED_HOSTS. */
const METADATA_HOSTNAMES = new Set([...BLOCKED_HOSTNAMES].filter((h) => h !== 'localhost'));

/** Env var holding the operator allowlist. */
export const ALLOWED_HOSTS_ENV = 'CONNECTOR_ALLOWED_HOSTS';

const ALLOWLIST_HINT = ` — if this is your own HIS on the hospital network, add it to ${ALLOWED_HOSTS_ENV}`;

interface AllowList {
  hostnames: Set<string>;
  /** "host:port" entries — allow only that port on that host. */
  hostPorts: Set<string>;
  cidrs: Array<{ base: number; mask: number }>;
}

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

let cachedRaw: string | undefined;
let cachedAllowList: AllowList = { hostnames: new Set(), hostPorts: new Set(), cidrs: [] };

/** Parse CONNECTOR_ALLOWED_HOSTS (re-read each call so config/tests can change it). */
function currentAllowList(): AllowList {
  const raw = process.env[ALLOWED_HOSTS_ENV] ?? '';
  if (raw === cachedRaw) return cachedAllowList;
  const allowList: AllowList = { hostnames: new Set(), hostPorts: new Set(), cidrs: [] };
  for (const entry of raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)) {
    const cidr = entry.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    const base = cidr ? ipv4ToUint32(cidr[1]!) : null;
    const bits = cidr ? Number(cidr[2]) : NaN;
    if (cidr && base !== null && bits >= 0 && bits <= 32) {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      allowList.cidrs.push({ base: (base & mask) >>> 0, mask });
    } else if (/^[^:[\]]+:\d{1,5}$/.test(entry)) {
      allowList.hostPorts.add(entry);
    } else {
      allowList.hostnames.add(entry.replace(/^\[|\]$/g, ''));
    }
  }
  cachedRaw = raw;
  cachedAllowList = allowList;
  return allowList;
}

/** Port the URL will actually connect to (explicit, or the scheme default). */
function effectivePort(parsed: URL): string {
  return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
}

/** Link-local / "this network" IPv4 — metadata services live here; never allowlistable. */
function isAlwaysBlockedIpv4(ip: string): boolean {
  const value = ipv4ToUint32(ip);
  if (value === null) return false;
  const a = value >>> 24;
  const b = (value >>> 16) & 0xff;
  return (a === 169 && b === 254) || a === 0;
}

/** IPv4 embedded in an IPv4-mapped IPv6 address (dotted or hex form), else null. */
function mappedIpv4(ipv6: string): string | null {
  const addr = ipv6.replace(/^\[|\]$/g, '').toLowerCase();
  if (!addr.startsWith('::ffff:')) return null;
  const tail = addr.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

/** IPv6 forms of metadata / link-local targets — never allowlistable either. */
function isAlwaysBlockedIpv6(ipv6: string): boolean {
  const addr = ipv6.replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = mappedIpv4(addr);
  if (v4 !== null) return isAlwaysBlockedIpv4(v4);
  // AWS IMDS over IPv6 + link-local fe80::/10
  return addr === 'fd00:ec2::254' || /^fe[89ab]/.test(addr);
}

/** True when the operator explicitly allowlisted this IPv4 (exact or CIDR). */
function isAllowlistedIpv4(ip: string, allowList: AllowList): boolean {
  if (allowList.hostnames.has(ip)) return true;
  const value = ipv4ToUint32(ip);
  if (value === null) return false;
  return allowList.cidrs.some(({ base, mask }) => (value & mask) >>> 0 === base);
}

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
  const allowList = currentAllowList();

  // Metadata endpoints: blocked unconditionally (allowlist cannot re-open them)
  if (METADATA_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Hostname '${hostname}' is blocked` };
  }

  // Normalize decimal/hex/octal IPv4 representations
  const normalizedHostname = normalizeIpv4(hostname);
  const effectiveHostname = normalizedHostname ?? hostname;
  const isIpv4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(effectiveHostname);

  if (isIpv4Literal && isAlwaysBlockedIpv4(effectiveHostname)) {
    return {
      ok: false,
      reason: `IP '${effectiveHostname}' is in a blocked link-local/metadata range`,
    };
  }
  if (hostname.startsWith('[') && isAlwaysBlockedIpv6(hostname)) {
    return { ok: false, reason: `IPv6 address '${hostname}' is in a blocked metadata range` };
  }

  // Operator allowlist (exact hostname / IP, host:port, or CIDR for IPv4 literals)
  if (
    allowList.hostnames.has(hostname.replace(/^\[|\]$/g, '')) ||
    allowList.hostPorts.has(`${effectiveHostname}:${effectivePort(parsed)}`) ||
    (isIpv4Literal && isAllowlistedIpv4(effectiveHostname, allowList))
  ) {
    return { ok: true };
  }

  // localhost variants
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Hostname '${hostname}' is blocked${ALLOWLIST_HINT}` };
  }

  // Kiểm tra IPv4 private/loopback/link-local
  if (isIpv4Literal) {
    if (isPrivateIpv4(effectiveHostname)) {
      return {
        ok: false,
        reason: `IP '${effectiveHostname}' is in a blocked private/loopback range${ALLOWLIST_HINT}`,
      };
    }
  }

  // Kiểm tra IPv6
  if (hostname.startsWith('[') || /^[0-9a-fA-F:]+$/.test(hostname)) {
    if (isBlockedIpv6(hostname)) {
      return {
        ok: false,
        reason: `IPv6 address '${hostname}' is blocked${ALLOWLIST_HINT}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Why `address` (a DNS answer for `hostname`, connecting on `port`) must not be
 * used, or null when it may. Shared by the pre-flight check and the connect-time
 * lookup so both apply exactly the same policy.
 */
function blockedAddressReason(
  hostname: string,
  port: string,
  address: string,
  family: number,
  allowList: AllowList,
): string | null {
  const host = hostname.toLowerCase();
  if (
    (family === 4 && isAlwaysBlockedIpv4(address)) ||
    (family === 6 && isAlwaysBlockedIpv6(address))
  ) {
    return `DNS resolved '${hostname}' to blocked link-local/metadata IP '${address}'`;
  }
  // Operator vouched for this host (by name, or name:port).
  if (allowList.hostnames.has(host) || allowList.hostPorts.has(`${host}:${port}`)) return null;
  if (family === 4 && isPrivateIpv4(address) && !isAllowlistedIpv4(address, allowList)) {
    return `DNS resolved '${hostname}' to blocked IP '${address}'${ALLOWLIST_HINT}`;
  }
  if (family === 6 && isBlockedIpv6(address)) {
    return `DNS resolved '${hostname}' to blocked IPv6 '${address}'${ALLOWLIST_HINT}`;
  }
  return null;
}

/** Error code set on errors raised by `ssrfSafeLookup` when an answer is refused. */
export const SSRF_BLOCKED_CODE = 'ESSRFBLOCKED';

/** Resolver signature (node:dns `lookup` with `all: true`) — injectable for tests. */
export type AddressResolver = (
  hostname: string,
  options: LookupOptions & { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/** `lookup` option accepted by node:net / node:http / node:https. */
export type SafeLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

const defaultResolver: AddressResolver = (hostname, options, callback) =>
  dnsLookupCallback(hostname, options, callback);

/**
 * Connect-time SSRF guard (DNS-rebinding safe): a drop-in `lookup` for outbound
 * sockets to `port`. It resolves the hostname, rejects the connection if ANY
 * returned address is blocked by policy, and otherwise hands those exact
 * addresses to the socket — there is no second, unvalidated DNS query.
 */
export function ssrfSafeLookup(
  port: string,
  resolver: AddressResolver = defaultResolver,
): SafeLookup {
  return (hostname, options, callback) => {
    resolver(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err, '', 0);
        return;
      }
      const allowList = currentAllowList();
      for (const addr of addresses) {
        const reason = blockedAddressReason(hostname, port, addr.address, addr.family, allowList);
        if (reason) {
          callback(Object.assign(new Error(reason), { code: SSRF_BLOCKED_CODE }), '', 0);
          return;
        }
      }
      if (options.all) {
        callback(null, addresses);
      } else if (addresses[0]) {
        callback(null, addresses[0].address, addresses[0].family);
      } else {
        callback(
          Object.assign(new Error(`DNS lookup returned no address for '${hostname}'`), {
            code: 'ENOTFOUND',
          }),
          '',
          0,
        );
      }
    });
  };
}

/**
 * Validate URL + resolve DNS rồi validate IP đã resolve (pre-flight, gives an early
 * and clear error). Connections themselves are re-checked by `ssrfSafeLookup`.
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

  const allowList = currentAllowList();
  const port = effectivePort(parsed);

  // DNS resolution — kiểm tra resolved IP
  try {
    const addresses = await lookup(hostname, { all: true });
    for (const addr of addresses) {
      const reason = blockedAddressReason(hostname, port, addr.address, addr.family, allowList);
      if (reason) return { ok: false, reason };
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
