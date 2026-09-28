/**
 * Tests for FhirHttpClient / ssrfSafeRequest against a real local HTTP server.
 * DNS is injected (resolver option) so the connect-time SSRF guard can be
 * exercised deterministically — including a "rebinding" answer to 127.0.0.1.
 */

import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FhirHttpClient, postFormForJson, ssrfSafeRequest } from '../fhir-http-client.js';
import type { AddressResolver } from '../../security/ssrf-validator.js';

interface Seen {
  url: string;
  headers: IncomingHttpHeaders;
}

let server: Server;
let port: number;
const seen: Seen[] = [];
let otherServer: Server;
let otherPort: number;
const seenByOther: Seen[] = [];

function listen(srv: Server): Promise<number> {
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as AddressInfo).port)),
  );
}

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/fhir+json' });
      res.end(JSON.stringify(body));
    };
    switch (req.url) {
      case '/fhir/metadata':
        return json(200, { resourceType: 'CapabilityStatement', fhirVersion: '4.0.1' });
      case '/fhir/Patient/p1':
        return json(200, { resourceType: 'Patient', id: 'p1' });
      case '/fhir/gzip': {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
        return res.end(gzipSync(JSON.stringify({ resourceType: 'Bundle', total: 7 })));
      }
      case '/fhir/big':
        return json(200, { data: 'x'.repeat(10_000) });
      case '/fhir/html':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html>login</html>');
      case '/fhir/moved':
        res.writeHead(302, { Location: '/fhir/Patient/p1' });
        return res.end();
      case '/fhir/elsewhere':
        res.writeHead(302, { Location: `http://localhost:${otherPort}/landing` });
        return res.end();
      case '/token-redirect':
        res.writeHead(307, { Location: '/token' });
        return res.end();
      case '/token':
        return json(200, { access_token: 'tok', token_type: 'bearer' });
      default:
        return json(404, { resourceType: 'OperationOutcome' });
    }
  });
  otherServer = createServer((req, res) => {
    seenByOther.push({ url: req.url ?? '', headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  port = await listen(server);
  otherPort = await listen(otherServer);
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => otherServer.close(r));
});

const savedAllow = process.env['CONNECTOR_ALLOWED_HOSTS'];
function allow(value: string | undefined): void {
  if (value === undefined) delete process.env['CONNECTOR_ALLOWED_HOSTS'];
  else process.env['CONNECTOR_ALLOWED_HOSTS'] = value;
}
afterEach(() => {
  allow(savedAllow);
  seen.length = 0;
  seenByOther.length = 0;
});

/** Fake DNS: every hostname resolves to `address`. */
const resolveTo =
  (address: string, family = 4): AddressResolver =>
  (_host, _options, callback) =>
    callback(null, [{ address, family }]);

describe('FhirHttpClient', () => {
  it('GETs JSON under the base path (metadata + relative resource path)', async () => {
    allow(`localhost:${port}`);
    const client = new FhirHttpClient({ baseUrl: `http://localhost:${port}/fhir` });

    await expect(client.capabilityStatement()).resolves.toMatchObject({ fhirVersion: '4.0.1' });
    await expect(client.request('Patient/p1')).resolves.toEqual({
      resourceType: 'Patient',
      id: 'p1',
    });
    expect(seen.map((s) => s.url)).toEqual(['/fhir/metadata', '/fhir/Patient/p1']);
  });

  it('sends the bearer token and a FHIR Accept header', async () => {
    allow(`localhost:${port}`);
    const client = new FhirHttpClient({ baseUrl: `http://localhost:${port}/fhir/` });
    client.bearerToken = 'secret-token';
    await client.request('Patient/p1');
    expect(seen[0]!.headers.authorization).toBe('Bearer secret-token');
    expect(seen[0]!.headers.accept).toContain('application/fhir+json');
  });

  it('decompresses gzip responses', async () => {
    allow(`localhost:${port}`);
    const client = new FhirHttpClient({ baseUrl: `http://localhost:${port}/fhir` });
    await expect(client.request('gzip')).resolves.toEqual({ resourceType: 'Bundle', total: 7 });
  });

  it('reports HTTP errors as "HTTP <status>" without the URL (patient id)', async () => {
    allow(`localhost:${port}`);
    const client = new FhirHttpClient({ baseUrl: `http://localhost:${port}/fhir` });
    const err = await client.request('Patient/secret-id-42').catch((e: Error) => e);
    expect((err as Error).message).toBe('HTTP 404 from FHIR server');
  });

  it('rejects non-JSON bodies and oversized bodies', async () => {
    allow(`localhost:${port}`);
    const client = new FhirHttpClient({
      baseUrl: `http://localhost:${port}/fhir`,
      maxResponseBytes: 1_000,
    });
    await expect(client.request('html')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(client.request('big')).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('follows same-origin redirects', async () => {
    allow(`localhost:${port}`);
    const client = new FhirHttpClient({ baseUrl: `http://localhost:${port}/fhir` });
    await expect(client.request('moved')).resolves.toMatchObject({ id: 'p1' });
  });

  it('drops the bearer token when a redirect leaves the origin', async () => {
    allow(`localhost:${port},localhost:${otherPort}`);
    const client = new FhirHttpClient({ baseUrl: `http://localhost:${port}/fhir` });
    client.bearerToken = 'secret-token';
    await expect(client.request('elsewhere')).resolves.toEqual({ ok: true });
    expect(seen[0]!.headers.authorization).toBe('Bearer secret-token');
    expect(seenByOther[0]!.headers.authorization).toBeUndefined();
  });

  it('blocks a redirect to a host that is not allowlisted', async () => {
    allow(`localhost:${port}`); // the other port is NOT allowed
    const client = new FhirHttpClient({ baseUrl: `http://localhost:${port}/fhir` });
    await expect(client.request('elsewhere')).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    expect(seenByOther).toHaveLength(0);
  });
});

describe('connect-time SSRF guard (DNS rebinding)', () => {
  it('refuses to connect when the hostname resolves to a private IP at connect time', async () => {
    allow(undefined);
    // Public-looking name that passes the structural check, but DNS now answers 127.0.0.1.
    const client = new FhirHttpClient({
      baseUrl: `http://his.rebind.example:${port}/fhir`,
      resolver: resolveTo('127.0.0.1'),
    });
    const err = await client.capabilityStatement().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SSRF_BLOCKED' });
    expect((err as Error).message).toMatch(/127\.0\.0\.1/);
    expect(seen).toHaveLength(0); // no request ever reached the server
  });

  it('connects to exactly the validated address when the host is allowlisted', async () => {
    allow('his.rebind.example');
    const client = new FhirHttpClient({
      baseUrl: `http://his.rebind.example:${port}/fhir`,
      resolver: resolveTo('127.0.0.1'),
    });
    await expect(client.capabilityStatement()).resolves.toMatchObject({ fhirVersion: '4.0.1' });
    expect(seen[0]!.headers.host).toBe(`his.rebind.example:${port}`);
  });

  it('never connects to cloud-metadata addresses, even for an allowlisted host', async () => {
    allow('his.rebind.example');
    const client = new FhirHttpClient({
      baseUrl: `http://his.rebind.example:${port}/fhir`,
      resolver: resolveTo('169.254.169.254'),
    });
    await expect(client.capabilityStatement()).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });

  it('blocks IPv6 loopback and IPv4-mapped private answers', async () => {
    allow(undefined);
    for (const [address, family] of [
      ['::1', 6],
      ['::ffff:10.0.0.5', 6],
    ] as const) {
      const req = ssrfSafeRequest(`http://his.rebind.example:${port}/`, {
        resolver: resolveTo(address, family),
      });
      await expect(req).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    }
  });

  it('rejects the request if ANY resolved address is blocked', async () => {
    allow(undefined);
    const mixed: AddressResolver = (_h, _o, callback) =>
      callback(null, [
        { address: '93.184.215.14', family: 4 },
        { address: '10.1.2.3', family: 4 },
      ]);
    const req = ssrfSafeRequest(`http://his.rebind.example:${port}/`, { resolver: mixed });
    await expect(req).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });
});

describe('postFormForJson (OAuth2 token endpoint)', () => {
  it('posts the form and returns the JSON body', async () => {
    allow(`localhost:${port}`);
    const body = await postFormForJson(
      `http://localhost:${port}/token`,
      new URLSearchParams({ grant_type: 'client_credentials' }),
    );
    expect(body).toMatchObject({ access_token: 'tok' });
    expect(seen[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it('does not follow redirects (the client secret is never re-sent elsewhere)', async () => {
    allow(`localhost:${port}`);
    const req = postFormForJson(
      `http://localhost:${port}/token-redirect`,
      new URLSearchParams({ client_secret: 's' }),
    );
    await expect(req).rejects.toThrow('HTTP 307 from token endpoint');
    expect(seen).toHaveLength(1);
  });
});
