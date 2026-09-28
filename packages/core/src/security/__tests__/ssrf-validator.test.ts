/**
 * SSRF validator unit tests — 20+ attack vectors.
 * Bao gồm: private IP ranges, metadata endpoints, scheme attacks,
 * decimal/hex/octal IP encoding, userinfo bypass, IPv6 attacks.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { validateBaseUrl, validateBaseUrlWithDns } from '../ssrf-validator.js';

// Helper: expect blocked
function expectBlocked(url: string) {
  const result = validateBaseUrl(url);
  expect(result.ok, `Expected '${url}' to be blocked, but was allowed`).toBe(false);
}

// Helper: expect allowed
function expectAllowed(url: string) {
  const result = validateBaseUrl(url);
  if (!result.ok) {
    throw new Error(`Expected '${url}' to be allowed, but blocked with: ${result.reason}`);
  }
  expect(result.ok).toBe(true);
}

describe('validateBaseUrl — scheme enforcement', () => {
  it('allows http', () => expectAllowed('http://example.com/fhir'));
  it('allows https', () => expectAllowed('https://fhir.example.org/r4'));

  it('blocks javascript: scheme', () => expectBlocked('javascript:alert(1)'));
  it('blocks file: scheme', () => expectBlocked('file:///etc/passwd'));
  it('blocks data: scheme', () => expectBlocked('data:text/html,<script>alert(1)</script>'));
  it('blocks ftp: scheme', () => expectBlocked('ftp://internal.host/data'));
  it('blocks gopher: scheme', () => expectBlocked('gopher://internal/data'));
});

describe('validateBaseUrl — userinfo (credential leakage)', () => {
  it('blocks user:pass@host', () => expectBlocked('https://admin:secret@example.com/fhir'));
  it('blocks user@host (username only)', () => expectBlocked('https://user@example.com/fhir'));
});

describe('validateBaseUrl — blocked hostnames (metadata endpoints)', () => {
  it('blocks localhost', () => expectBlocked('http://localhost/fhir'));
  it('blocks 169.254.169.254 (AWS IMDS)', () =>
    expectBlocked('http://169.254.169.254/latest/meta-data/'));
  it('blocks metadata.google.internal', () =>
    expectBlocked('http://metadata.google.internal/computeMetadata/v1/'));
  it('blocks metadata.azure.com', () =>
    expectBlocked('http://metadata.azure.com/metadata/instance'));
  it('blocks metadata.aws.internal', () => expectBlocked('http://metadata.aws.internal/'));
});

describe('validateBaseUrl — private IPv4 ranges', () => {
  it('blocks 10.x.x.x (RFC1918)', () => expectBlocked('http://10.0.0.1/fhir'));
  it('blocks 10.255.255.255', () => expectBlocked('http://10.255.255.255/data'));
  it('blocks 172.16.x.x (RFC1918)', () => expectBlocked('http://172.16.0.1/api'));
  it('blocks 172.31.255.255 (RFC1918 upper bound)', () =>
    expectBlocked('http://172.31.255.255/data'));
  it('allows 172.15.x.x (not private)', () => expectAllowed('http://172.15.0.1/fhir'));
  it('allows 172.32.x.x (not private)', () => expectAllowed('http://172.32.0.1/fhir'));
  it('blocks 192.168.x.x (RFC1918)', () => expectBlocked('http://192.168.1.100/fhir'));
  it('blocks 127.0.0.1 (loopback)', () => expectBlocked('http://127.0.0.1/fhir'));
  it('blocks 127.255.255.255 (loopback range)', () => expectBlocked('http://127.255.255.255/fhir'));
  it('blocks 0.0.0.0', () => expectBlocked('http://0.0.0.0/fhir'));
  it('blocks 169.254.0.1 (link-local)', () => expectBlocked('http://169.254.0.1/fhir'));
});

describe('validateBaseUrl — decimal/hex/octal IP encoding bypass attempts', () => {
  it('blocks decimal-encoded 127.0.0.1 = 2130706433', () =>
    expectBlocked('http://2130706433/fhir'));
  it('blocks hex-encoded 127.0.0.1 = 0x7f000001', () => expectBlocked('http://0x7f000001/fhir'));
  it('blocks octal-encoded 127.0.0.1 = 017700000001', () =>
    expectBlocked('http://017700000001/fhir'));
  it('blocks hex-encoded 10.0.0.1 = 0x0a000001', () => expectBlocked('http://0x0a000001/fhir'));
  it('blocks decimal-encoded 169.254.169.254 (AWS IMDS) = 2852039166', () =>
    expectBlocked('http://2852039166/fhir'));
});

describe('validateBaseUrl — IPv6 attacks', () => {
  it('blocks ::1 (IPv6 loopback)', () => expectBlocked('http://[::1]/fhir'));
  it('blocks fc00:: (ULA range start)', () => expectBlocked('http://[fc00::1]/fhir'));
  it('blocks fd00:: (ULA range)', () => expectBlocked('http://[fd12:3456:789a::1]/fhir'));
  it('blocks fe80:: (link-local)', () => expectBlocked('http://[fe80::1]/fhir'));
  it('blocks ::ffff:127.0.0.1 (IPv4-mapped loopback)', () =>
    expectBlocked('http://[::ffff:127.0.0.1]/fhir'));
  it('blocks ::ffff:10.0.0.1 (IPv4-mapped private)', () =>
    expectBlocked('http://[::ffff:10.0.0.1]/fhir'));
});

describe('validateBaseUrl — malformed URL rejection', () => {
  it('blocks empty string', () => expectBlocked(''));
  it('blocks plain hostname (no scheme)', () => expectBlocked('example.com'));
  it('blocks //example.com (protocol-relative)', () => expectBlocked('//example.com'));
});

describe('validateBaseUrl — legitimate public URLs allowed', () => {
  it('allows public FHIR server', () => expectAllowed('https://hapi.fhir.org/baseR4'));
  it('allows HTTPS with port', () => expectAllowed('https://fhir.example.com:8443/r4'));
  it('allows HTTP (non-TLS) for dev', () => expectAllowed('http://fhir.hospital.example/r4'));
  it('allows IP outside private ranges', () => expectAllowed('http://8.8.8.8/fhir'));
  it('allows 172.15.0.1 (just below RFC1918 range)', () => expectAllowed('http://172.15.0.1/fhir'));
  it('allows 192.169.0.1 (just above RFC1918)', () => expectAllowed('http://192.169.0.1/fhir'));
});

describe('validateBaseUrl — result shape', () => {
  it('blocked result includes reason string', () => {
    const result = validateBaseUrl('http://localhost/fhir');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('allowed result has ok: true only', () => {
    const result = validateBaseUrl('https://fhir.example.com/r4');
    expect(result.ok).toBe(true);
    // Không có reason field khi ok
    expect((result as Record<string, unknown>)['reason']).toBeUndefined();
  });
});

describe('CONNECTOR_ALLOWED_HOSTS operator allowlist', () => {
  const saved = process.env['CONNECTOR_ALLOWED_HOSTS'];
  afterEach(() => {
    if (saved === undefined) delete process.env['CONNECTOR_ALLOWED_HOSTS'];
    else process.env['CONNECTOR_ALLOWED_HOSTS'] = saved;
  });

  it('blocks a private HIS by default and tells the operator how to allow it', () => {
    delete process.env['CONNECTOR_ALLOWED_HOSTS'];
    const result = validateBaseUrl('http://10.20.1.5/fhir');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/CONNECTOR_ALLOWED_HOSTS/);
  });

  it('allows IPv4 literals inside an allowlisted CIDR only', () => {
    process.env['CONNECTOR_ALLOWED_HOSTS'] = '10.20.0.0/16';
    expect(validateBaseUrl('http://10.20.1.5/fhir').ok).toBe(true);
    expect(validateBaseUrl('http://10.21.0.1/fhir').ok).toBe(false);
    expect(validateBaseUrl('http://192.168.1.10/fhir').ok).toBe(false);
  });

  it('allows an exact hostname or IP entry', () => {
    process.env['CONNECTOR_ALLOWED_HOSTS'] = ' HIS.Hospital.local , 192.168.1.10 ';
    expect(validateBaseUrl('https://his.hospital.local/fhir/R4').ok).toBe(true);
    expect(validateBaseUrl('http://192.168.1.10:8080/fhir').ok).toBe(true);
    expect(validateBaseUrl('http://192.168.1.11:8080/fhir').ok).toBe(false);
  });

  it('allows localhost only when explicitly listed', async () => {
    delete process.env['CONNECTOR_ALLOWED_HOSTS'];
    expect(validateBaseUrl('http://localhost:8090/fhir').ok).toBe(false);
    process.env['CONNECTOR_ALLOWED_HOSTS'] = 'localhost';
    expect(validateBaseUrl('http://localhost:8090/fhir').ok).toBe(true);
    expect((await validateBaseUrlWithDns('http://localhost:8090/fhir')).ok).toBe(true);
  });

  it('allows loopback IP literals when their CIDR is listed', () => {
    process.env['CONNECTOR_ALLOWED_HOSTS'] = '127.0.0.0/8';
    expect(validateBaseUrl('http://127.0.0.1:8090/fhir').ok).toBe(true);
  });

  it('never re-opens cloud metadata or link-local, even when listed', async () => {
    process.env['CONNECTOR_ALLOWED_HOSTS'] =
      '169.254.169.254,169.254.0.0/16,0.0.0.0/0,metadata.google.internal';
    expect(validateBaseUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(validateBaseUrl('http://metadata.google.internal/').ok).toBe(false);
    expect(validateBaseUrl('http://0xa9fea9fe/').ok).toBe(false); // hex-encoded
    expect(validateBaseUrl('http://2852039166/').ok).toBe(false); // 169.254.169.254 as decimal
  });

  it('never re-opens metadata through IPv6 forms, even when listed', () => {
    process.env['CONNECTOR_ALLOWED_HOSTS'] =
      '::ffff:a9fe:a9fe,::ffff:169.254.169.254,fd00:ec2::254';
    expect(validateBaseUrl('http://[::ffff:169.254.169.254]/').ok).toBe(false);
    expect(validateBaseUrl('http://[::ffff:a9fe:a9fe]/').ok).toBe(false);
    expect(validateBaseUrl('http://[fd00:ec2::254]/').ok).toBe(false);
    expect(validateBaseUrl('http://[fe80::1]/').ok).toBe(false);
  });

  it('still allows an explicitly listed private IPv6 HIS address', () => {
    process.env['CONNECTOR_ALLOWED_HOSTS'] = 'fd12:3456::10';
    expect(validateBaseUrl('http://[fd12:3456::10]:8080/fhir').ok).toBe(true);
    expect(validateBaseUrl('http://[fd12:3456::11]:8080/fhir').ok).toBe(false);
  });
});

describe('CONNECTOR_ALLOWED_HOSTS host:port entries', () => {
  const saved = process.env['CONNECTOR_ALLOWED_HOSTS'];
  afterEach(() => {
    if (saved === undefined) delete process.env['CONNECTOR_ALLOWED_HOSTS'];
    else process.env['CONNECTOR_ALLOWED_HOSTS'] = saved;
  });

  it('opens only the listed port', async () => {
    process.env['CONNECTOR_ALLOWED_HOSTS'] = 'localhost:8090,10.0.0.5:443';
    expect(validateBaseUrl('http://localhost:8090/fhir').ok).toBe(true);
    expect(validateBaseUrl('http://localhost:3001/api').ok).toBe(false);
    expect(validateBaseUrl('https://10.0.0.5/fhir').ok).toBe(true); // default https port
    expect(validateBaseUrl('http://10.0.0.5/fhir').ok).toBe(false); // port 80 not listed
    expect((await validateBaseUrlWithDns('http://localhost:8090/fhir')).ok).toBe(true);
    expect((await validateBaseUrlWithDns('http://localhost:6379/')).ok).toBe(false);
  });
});
