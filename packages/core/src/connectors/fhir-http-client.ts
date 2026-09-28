/**
 * Minimal FHIR REST client over node:http / node:https — only what the
 * FHIR endpoint connector needs (GET JSON with an optional bearer token, and a
 * form POST for the OAuth2 token endpoint).
 *
 * Why not fetch() or a FHIR SDK: SSRF protection has to hold at CONNECT time.
 * Each request resolves the host once (`resolveSafeAddresses`), applies the SSRF
 * policy to the answers and connects to those exact IPs, so a DNS answer that
 * changes after the pre-flight check (DNS rebinding) is never used. Keep-alive
 * sockets are pooled per client instance only (never shared with other code or
 * other connections), so a reused socket is always one opened this way. Redirects are followed by hand
 * (GET only, max 5 hops, each hop re-validated), the bearer token is only sent to
 * the original origin, and response bodies are size-capped after decompression.
 */

import type { LookupAddress } from 'node:dns';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { ConnectorError } from './his-connector-interface.js';
import {
  SSRF_BLOCKED_CODE,
  resolveSafeAddresses,
  validateBaseUrl,
  type AddressResolver,
} from '../security/ssrf-validator.js';

/** Default per-request deadline (whole request, not idle time). */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Largest decoded response body accepted (one FHIR page / token response). */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeRequestOptions {
  method?: 'GET' | 'POST';
  headers?: OutgoingHttpHeaders;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Follow GET redirects (default true). POSTs never follow redirects. */
  followRedirects?: boolean;
  /** DNS resolver override — tests only. */
  resolver?: AddressResolver;
  /** Keep-alive pools to use; without them every request opens a fresh socket. */
  agents?: SafeAgents;
}

export interface SafeAgents {
  http: HttpAgent;
  https: HttpsAgent;
}

export interface SafeResponse {
  status: number;
  body: Buffer;
}

/** One HTTP(S) request whose socket is opened through the connect-time SSRF guard. */
export async function ssrfSafeRequest(
  url: string | URL,
  options: SafeRequestOptions = {},
): Promise<SafeResponse> {
  const method = options.method ?? 'GET';
  const followRedirects = method === 'GET' && options.followRedirects !== false;
  let target = new URL(url);
  const origin = target.origin;
  let headers = { ...options.headers };

  for (let hop = 0; ; hop++) {
    const structural = validateBaseUrl(target.href);
    if (!structural.ok) {
      throw new ConnectorError(`Blocked request: ${structural.reason}`, 'SSRF_BLOCKED');
    }
    const res = await sendOnce(target, method, headers, options);
    const location = res.message.headers.location;
    if (!followRedirects || !REDIRECT_STATUSES.has(res.status) || !location) {
      return { status: res.status, body: await readBody(res.message, options) };
    }
    res.message.resume();
    if (hop >= MAX_REDIRECTS) {
      throw new ConnectorError('Too many redirects', 'REDIRECT_LIMIT');
    }
    target = new URL(location, target);
    if (target.origin !== origin) {
      // Never forward credentials to another origin.
      headers = Object.fromEntries(
        Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'),
      );
    }
  }
}

/** Connection failures after which the next validated address is tried. */
const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL']);

type SentRequest = { status: number; message: IncomingMessage };

/**
 * Resolve the host ONCE, keep only addresses the SSRF policy allows (any blocked
 * answer rejects the request), then connect to those exact IPs — the socket never
 * does a DNS lookup of its own, so a rebinding answer cannot be used. The original
 * host name is kept for TLS (SNI + certificate check) and the Host header.
 */
async function sendOnce(
  target: URL,
  method: string,
  headers: OutgoingHttpHeaders,
  options: SafeRequestOptions,
): Promise<SentRequest> {
  const isHttps = target.protocol === 'https:';
  const port = target.port || (isHttps ? '443' : '80');
  // WHATWG URL keeps brackets around IPv6 literals ("[::1]").
  const hostname = target.hostname.startsWith('[') ? target.hostname.slice(1, -1) : target.hostname;

  let addresses: LookupAddress[];
  try {
    addresses = await resolveSafeAddresses(hostname, port, options.resolver);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === SSRF_BLOCKED_CODE) {
      throw new ConnectorError(`Blocked connection: ${e.message}`, 'SSRF_BLOCKED');
    }
    throw e;
  }

  let lastError: unknown = new Error(`No address to connect to for ${hostname}`);
  for (const address of addresses) {
    try {
      return await sendTo(address, target, hostname, port, method, headers, options);
    } catch (err) {
      lastError = err;
      if (!CONNECT_ERRORS.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
    }
  }
  throw lastError;
}

function sendTo(
  address: LookupAddress,
  target: URL,
  hostname: string,
  port: string,
  method: string,
  headers: OutgoingHttpHeaders,
  options: SafeRequestOptions,
): Promise<SentRequest> {
  const isHttps = target.protocol === 'https:';
  const send = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = send(
      {
        host: address.address, // the validated IP — not the user-supplied name
        family: address.family,
        port: Number(port),
        path: `${target.pathname}${target.search}`,
        method,
        // TLS: SNI + certificate check against the configured name (not for IP literals)
        ...(isHttps && isIP(hostname) === 0 ? { servername: hostname } : {}),
        // Pools are per-client; without one, a fresh socket per request.
        agent: options.agents ? options.agents[isHttps ? 'https' : 'http'] : false,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        headers: {
          Host: target.host,
          'Accept-Encoding': 'gzip, deflate, br',
          ...headers,
          ...(options.body !== undefined
            ? { 'Content-Length': Buffer.byteLength(options.body) }
            : {}),
        },
      },
      (message) => resolve({ status: message.statusCode ?? 0, message }),
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        reject(new Error(`Request timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`));
      } else {
        reject(err);
      }
    });
    req.end(options.body);
  });
}

/** Decompress (gzip / deflate / br) and collect the body, enforcing the size cap. */
async function readBody(message: IncomingMessage, options: SafeRequestOptions): Promise<Buffer> {
  const limit = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const encoding = String(message.headers['content-encoding'] ?? '').toLowerCase();
  let stream: Readable = message;
  if (encoding === 'gzip' || encoding === 'x-gzip') stream = message.pipe(createGunzip());
  else if (encoding === 'deflate') stream = message.pipe(createInflate());
  else if (encoding === 'br') stream = message.pipe(createBrotliDecompress());

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      message.destroy();
      stream.destroy();
      throw new ConnectorError(`Response exceeds ${limit} bytes`, 'RESPONSE_TOO_LARGE');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function parseJson(body: Buffer, what: string): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new ConnectorError(`${what} did not return JSON`, 'INVALID_RESPONSE');
  }
}

export interface FhirHttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** DNS resolver override — tests only. */
  resolver?: AddressResolver;
}

/** GET-only FHIR REST client used by FhirEndpointConnector. */
export class FhirHttpClient {
  /** OAuth2 access token — kept in memory only, never logged. */
  bearerToken: string | undefined;
  private readonly baseUrl: URL;
  // This client's own keep-alive pools: every socket in them was opened through
  // ssrfSafeLookup by this client.
  private readonly agents: SafeAgents = {
    http: new HttpAgent({ keepAlive: true, maxSockets: 8 }),
    https: new HttpsAgent({ keepAlive: true, maxSockets: 8 }),
  };

  constructor(private readonly options: FhirHttpClientOptions) {
    // Exactly one trailing slash so relative paths resolve *under* the base
    // (…/baseR4/Patient/…). A loop, not /\/*$/: that regex is quadratic on many '/'.
    let end = options.baseUrl.length;
    while (end > 0 && options.baseUrl[end - 1] === '/') end--;
    this.baseUrl = new URL(`${options.baseUrl.slice(0, end)}/`);
  }

  /** Close pooled sockets. */
  close(): void {
    this.agents.http.destroy();
    this.agents.https.destroy();
  }

  /** GET [base]/metadata — the server's CapabilityStatement. */
  capabilityStatement(): Promise<unknown> {
    return this.request('metadata');
  }

  /** GET a path relative to the base URL, or an absolute URL (e.g. a paging link). */
  async request(pathOrUrl: string): Promise<unknown> {
    const res = await ssrfSafeRequest(new URL(pathOrUrl, this.baseUrl), {
      headers: {
        Accept: 'application/fhir+json, application/json;q=0.9',
        ...(this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : {}),
      },
      timeoutMs: this.options.timeoutMs,
      maxResponseBytes: this.options.maxResponseBytes,
      resolver: this.options.resolver,
      agents: this.agents,
    });
    // "HTTP <status>" lets the retry handler tell 4xx (final) from 429/5xx (retry).
    // The URL is left out on purpose: it contains the patient id.
    if (res.status < 200 || res.status > 299) {
      throw new Error(`HTTP ${res.status} from FHIR server`);
    }
    return parseJson(res.body, 'FHIR server');
  }
}

/** POST an application/x-www-form-urlencoded body and parse the JSON reply (OAuth2). */
export async function postFormForJson(
  url: string,
  form: URLSearchParams,
  options: { timeoutMs?: number; resolver?: AddressResolver } = {},
): Promise<unknown> {
  const res = await ssrfSafeRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
    timeoutMs: options.timeoutMs,
    maxResponseBytes: 1024 * 1024,
    resolver: options.resolver,
  });
  if (res.status < 200 || res.status > 299) {
    throw new Error(`HTTP ${res.status} from token endpoint`);
  }
  return parseJson(res.body, 'Token endpoint');
}
