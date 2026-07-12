/**
 * ExportService unit tests.
 * No real network calls — only tests the in-memory store and validation logic.
 *
 * C-6: Bổ sung streaming tests:
 *   - NDJSON output correctness (100 resources)
 *   - AbortSignal fires → stream stops
 *   - Client disconnect simulation → reply.raw.destroy()
 *   - Memory sanity: stream 10K resources, heapUsed high-water < 50 MB
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuditLogEntry } from '@fhirbridge/types';

import { ExportService } from '../export-service.js';
import { AuditService, type AuditSink } from '../audit-service.js';

// Imported after vi.mock hoisting — gives us a handle to the mock functions
import * as CoreModule from '@fhirbridge/core';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Tạo mock FastifyRequest với authUser đã set.
 */
function makeMockRequest(userId: string): FastifyRequest {
  return {
    authUser: { id: userId },
  } as unknown as FastifyRequest;
}

/**
 * Tạo mock writable stream (EventEmitter + write/end/setHeader).
 * Capture tất cả chunks được write để test NDJSON output.
 *
 * Dùng Object.defineProperties thay vì Object.assign để đảm bảo
 * getters (chunks, ended, headers) là live accessors, không bị copy thành giá trị tĩnh.
 */
function makeMockRaw() {
  const emitter = new EventEmitter();
  const chunks: string[] = [];
  // Dùng object wrapper thay vì primitive để getter luôn đọc giá trị mới nhất
  const state = { ended: false };
  const headers: Record<string, string> = {};

  // Gán methods trực tiếp lên emitter instance
  const raw = emitter as EventEmitter & {
    write(chunk: string, cb?: (err?: Error | null) => void): boolean;
    end(): void;
    setHeader(name: string, value: string): void;
    readonly chunks: string[];
    readonly ended: boolean;
    readonly headers: Record<string, string>;
  };

  raw.write = function (chunk: string, cb?: (err?: Error | null) => void): boolean {
    chunks.push(chunk);
    if (cb) cb();
    return true;
  };

  raw.end = function (): void {
    state.ended = true;
    emitter.emit('finish');
  };

  raw.setHeader = function (name: string, value: string): void {
    headers[name] = value;
  };

  // Định nghĩa live getters bằng Object.defineProperties
  Object.defineProperties(raw, {
    chunks: { get: () => chunks, enumerable: true },
    ended: { get: () => state.ended, enumerable: true },
    headers: { get: () => headers, enumerable: true },
  });

  return raw;
}

type MockRaw = ReturnType<typeof makeMockRaw>;

/**
 * Tạo mock FastifyReply với reply.raw là mock writable stream.
 */
function makeMockReply(raw: MockRaw): FastifyReply {
  let hijacked = false;
  const sentStatus: { code?: number; body?: unknown } = {};

  return {
    raw,
    hijack() {
      hijacked = true;
    },
    status(code: number) {
      sentStatus.code = code;
      return this;
    },
    send(body: unknown) {
      sentStatus.body = body;
      return this;
    },
    header() {
      return this;
    },
    get isHijacked() {
      return hijacked;
    },
    get sentStatus() {
      return sentStatus;
    },
  } as unknown as FastifyReply;
}

/**
 * Tạo async generator giả lập connector.fetchPatientData()
 * với N resources.
 */
async function* makeResourceGenerator(count: number) {
  for (let i = 0; i < count; i++) {
    yield {
      resourceType: 'Patient',
      data: {
        resourceType: 'Patient',
        id: `patient-${i}`,
        gender: 'male',
        birthDate: '1990-01-01',
      },
      source: 'test',
    };
  }
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock FhirEndpointConnector và validateBaseUrl từ @fhirbridge/core
vi.mock('@fhirbridge/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return {
    ...actual,
    // Override validateBaseUrl + validateBaseUrlWithDns để luôn pass trong tests.
    // ExportService gọi validateBaseUrlWithDns (DNS-aware, C5) trên mọi outbound URL.
    validateBaseUrl: vi.fn().mockReturnValue({ ok: true }),
    validateBaseUrlWithDns: vi.fn().mockResolvedValue({ ok: true }),
    FhirEndpointConnector: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      fetchPatientData: vi.fn().mockReturnValue(makeResourceGenerator(0)),
    })),
  };
});

// ── ExportService.startExport tests (giữ nguyên cũ) ─────────────────────────

describe('ExportService.startExport', () => {
  it('returns a UUID string', async () => {
    const svc = new ExportService();
    const id = await svc.startExport(
      {
        patientId: 'p1',
        connectorConfig: {
          type: 'fhir-endpoint',
          baseUrl: 'https://example.com/fhir',
          authType: 'none',
        },
        outputFormat: 'json',
      },
      'user-001',
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('creates a processing record immediately', async () => {
    const svc = new ExportService();
    const id = await svc.startExport(
      {
        patientId: 'p1',
        connectorConfig: {
          type: 'fhir-endpoint',
          baseUrl: 'https://example.com/fhir',
          authType: 'none',
        },
      },
      'user-002',
    );
    const record = await svc.getStatus(id, 'user-002');
    // Record may be processing or already failed (no real endpoint) — should exist
    expect(record).toBeDefined();
    expect(['processing', 'failed', 'complete']).toContain(record!.status);
  });
});

// ── ExportService.getStatus tests (giữ nguyên cũ) ───────────────────────────

describe('ExportService.getStatus', () => {
  it('returns undefined for non-existent exportId', async () => {
    const svc = new ExportService();
    expect(await svc.getStatus('nonexistent-id', 'user-001')).toBeUndefined();
  });

  it('returns undefined for wrong userId (IDOR protection)', async () => {
    const svc = new ExportService();
    const id = await svc.startExport(
      {
        patientId: 'p1',
        connectorConfig: {
          type: 'fhir-endpoint',
          baseUrl: 'https://example.com/fhir',
          authType: 'none',
        },
      },
      'owner-user',
    );

    // Attacker uses different userId
    const record = await svc.getStatus(id, 'attacker-user');
    expect(record).toBeUndefined();
  });

  it('returns the record for the correct userId', async () => {
    const svc = new ExportService();
    const id = await svc.startExport(
      {
        patientId: 'p2',
        connectorConfig: {
          type: 'fhir-endpoint',
          baseUrl: 'https://example.com/fhir',
          authType: 'none',
        },
      },
      'correct-user',
    );

    const record = await svc.getStatus(id, 'correct-user');
    expect(record).toBeDefined();
  });
});

// ── validateBaseUrl SSRF tests (giữ nguyên cũ) ──────────────────────────────

describe('validateBaseUrl (SSRF protection — tested via runExport side-effects)', () => {
  /**
   * Cài đặt SSRF-aware mock implementation cho validateBaseUrl.
   * Dùng static import CoreModule (đã được vi.mock hoisting xử lý).
   */
  function installSsrfMock(): void {
    vi.mocked(CoreModule.validateBaseUrlWithDns).mockImplementation(async (url: string) => {
      const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'];
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        if (blocked.includes(hostname)) {
          return { ok: false, reason: 'Internal endpoints are not allowed' };
        }
        if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
          return { ok: false, reason: 'Private IP ranges are not allowed' };
        }
        return { ok: true };
      } catch {
        return { ok: false, reason: `Malformed URL: ${url}` };
      }
    });
  }

  /** Helper: start an export and wait briefly for the async pipeline to attempt connection */
  async function startAndWait(
    svc: ExportService,
    baseUrl: string,
    userId: string,
  ): Promise<string> {
    installSsrfMock();

    const id = await svc.startExport(
      {
        patientId: 'p1',
        connectorConfig: { type: 'fhir-endpoint', baseUrl, authType: 'none' },
      },
      userId,
    );
    // Give the async pipeline a tick to run and fail
    await new Promise<void>((r) => setTimeout(r, 50));
    return id;
  }

  it('blocks localhost', async () => {
    const svc = new ExportService();
    const id = await startAndWait(svc, 'http://localhost:8080/fhir', 'u1');
    const record = await svc.getStatus(id, 'u1');
    expect(record?.status).toBe('failed');
    expect(record?.error).toMatch(/Internal endpoints are not allowed/i);
  });

  it('blocks 127.0.0.1', async () => {
    const svc = new ExportService();
    const id = await startAndWait(svc, 'http://127.0.0.1:8080/fhir', 'u2');
    const record = await svc.getStatus(id, 'u2');
    expect(record?.status).toBe('failed');
    expect(record?.error).toMatch(/Internal endpoints are not allowed/i);
  });

  it('blocks private 192.168.x.x range', async () => {
    const svc = new ExportService();
    const id = await startAndWait(svc, 'http://192.168.1.1/fhir', 'u3');
    const record = await svc.getStatus(id, 'u3');
    expect(record?.status).toBe('failed');
    expect(record?.error).toMatch(/Private IP ranges are not allowed/i);
  });

  it('blocks AWS metadata endpoint', async () => {
    const svc = new ExportService();
    const id = await startAndWait(svc, 'http://169.254.169.254/latest/meta-data', 'u4');
    const record = await svc.getStatus(id, 'u4');
    expect(record?.status).toBe('failed');
    expect(record?.error).toMatch(/Internal endpoints are not allowed/i);
  });
});

// ── C-6: streamExport tests ──────────────────────────────────────────────────

describe('ExportService.streamExport (C-6)', () => {
  /**
   * Setup: mock FhirEndpointConnector.fetchPatientData với N resources.
   */
  async function setupStreamTest(resourceCount: number) {
    vi.mocked(CoreModule.FhirEndpointConnector).mockImplementation(() => ({
      type: 'fhir-endpoint' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn(),
      fetchPatientData: vi.fn().mockReturnValue(makeResourceGenerator(resourceCount)),
    }));

    const svc = new ExportService();
    const raw = makeMockRaw();
    const request = makeMockRequest('stream-user');
    const reply = makeMockReply(raw);

    return { svc, raw, request, reply };
  }

  it('streams 100 resources as valid NDJSON lines', async () => {
    const { svc, raw, request, reply } = await setupStreamTest(100);

    await svc.streamExport(request, reply, {
      patientId: 'patient-test',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'stream-user',
    });

    // Collect tất cả chunks
    const allOutput = raw.chunks.join('');
    const lines = allOutput.split('\n').filter((l) => l.trim().length > 0);

    // Phải có đúng 100 lines
    expect(lines).toHaveLength(100);

    // Mỗi line phải là JSON hợp lệ với resourceType
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed).toHaveProperty('resourceType', 'Patient');
      expect(parsed).toHaveProperty('id');
    }

    // Stream phải được đóng đúng cách
    expect(raw.ended).toBe(true);
  });

  it('sets correct Content-Type header for NDJSON', async () => {
    const { svc, raw, request, reply } = await setupStreamTest(1);

    await svc.streamExport(request, reply, {
      patientId: 'patient-test',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'stream-user',
    });

    expect(raw.headers['Content-Type']).toBe('application/fhir+ndjson');
    expect(raw.headers['Transfer-Encoding']).toBe('chunked');
  });

  it('IDOR: từ chối stream khi userId không khớp authUser', async () => {
    const { svc, raw } = await setupStreamTest(0);
    const request = makeMockRequest('auth-user'); // authUser = 'auth-user'
    const reply = makeMockReply(raw);

    // Truyền userId khác với authUser
    let sentStatus = 0;
    let sentBody: unknown = null;
    const mockReply = {
      ...reply,
      status(code: number) {
        sentStatus = code;
        return this;
      },
      send(body: unknown) {
        sentBody = body;
        return this;
      },
    } as unknown as FastifyReply;

    await svc.streamExport(request, mockReply, {
      patientId: 'patient-test',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'different-user', // IDOR attempt
    });

    expect(sentStatus).toBe(403);
    expect((sentBody as Record<string, unknown>)?.['error']).toBe('Forbidden');
  });

  it('SSRF: từ chối stream khi baseUrl bị blocked', async () => {
    const core = await import('@fhirbridge/core');
    vi.mocked(core.validateBaseUrlWithDns).mockResolvedValueOnce({
      ok: false,
      reason: 'IP is in a blocked private range',
    });

    const { svc, raw } = await setupStreamTest(0);
    const request = makeMockRequest('stream-user');

    let sentStatus = 0;
    const mockReply = {
      raw,
      hijack: vi.fn(),
      status(code: number) {
        sentStatus = code;
        return this;
      },
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;

    await svc.streamExport(request, mockReply, {
      patientId: 'patient-test',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'http://192.168.1.1/fhir',
        authType: 'none',
      },
      userId: 'stream-user',
    });

    expect(sentStatus).toBe(400);
  });

  it('stream 0 resources → empty output, reply.raw.end() called', async () => {
    const { svc, raw, request, reply } = await setupStreamTest(0);

    await svc.streamExport(request, reply, {
      patientId: 'patient-empty',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'stream-user',
    });

    expect(raw.chunks.join('')).toBe('');
    expect(raw.ended).toBe(true);
  });

  it('connector error mid-stream → OperationOutcome line written, stream ended', async () => {
    const { FhirEndpointConnector } = await import('@fhirbridge/core');

    // Generator throw sau resource đầu tiên
    async function* errorGenerator() {
      yield {
        resourceType: 'Patient',
        data: { resourceType: 'Patient', id: 'p1', gender: 'male', birthDate: '1990-01-01' },
        source: 'test',
      };
      throw new Error('Connection reset');
    }

    vi.mocked(FhirEndpointConnector).mockImplementation(() => ({
      type: 'fhir-endpoint' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn(),
      fetchPatientData: vi.fn().mockReturnValue(errorGenerator()),
    }));

    const svc = new ExportService();
    const raw = makeMockRaw();
    const request = makeMockRequest('stream-user');
    const reply = makeMockReply(raw);

    await svc.streamExport(request, reply, {
      patientId: 'patient-test',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'stream-user',
    });

    const allOutput = raw.chunks.join('');
    const lines = allOutput.split('\n').filter((l) => l.trim().length > 0);

    // Ít nhất 1 resource + 1 OperationOutcome
    expect(lines.length).toBeGreaterThanOrEqual(2);

    // Dòng cuối phải là OperationOutcome
    const lastLine = lines[lines.length - 1]!;
    const outcome = JSON.parse(lastLine) as Record<string, unknown>;
    expect(outcome['resourceType']).toBe('OperationOutcome');

    expect(raw.ended).toBe(true);
  });

  it('client disconnect (simulated via close event) → stream aborts', async () => {
    const { FhirEndpointConnector } = await import('@fhirbridge/core');

    // Generator chậm — emit close sau resource đầu để simulate disconnect
    let emitClose: (() => void) | null = null;

    async function* slowGenerator() {
      for (let i = 0; i < 1000; i++) {
        yield {
          resourceType: 'Patient',
          data: { resourceType: 'Patient', id: `p${i}`, gender: 'male', birthDate: '1990-01-01' },
          source: 'test',
        };
        // Sau 5 resources, trigger disconnect
        if (i === 4 && emitClose) {
          emitClose();
        }
        // Small delay để event loop có cơ hội xử lý abort
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    vi.mocked(FhirEndpointConnector).mockImplementation(() => ({
      type: 'fhir-endpoint' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn(),
      fetchPatientData: vi.fn().mockReturnValue(slowGenerator()),
    }));

    const svc = new ExportService();
    const raw = makeMockRaw();
    const request = makeMockRequest('stream-user');
    const reply = makeMockReply(raw);

    // Capture emitClose
    const originalOn = raw.on.bind(raw);
    raw.on = function (event: string, listener: (...args: unknown[]) => void) {
      if (event === 'close') {
        emitClose = () => listener();
      }
      return originalOn(event, listener);
    } as typeof raw.on;

    await svc.streamExport(request, reply, {
      patientId: 'patient-test',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'stream-user',
    });

    // Stream phải dừng sớm hơn 1000 resources
    const allOutput = raw.chunks.join('');
    const lines = allOutput.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeLessThan(1000);

    // Stream phải được end
    expect(raw.ended).toBe(true);
  });

  it('memory sanity: stream 10K resources, no resource array accumulated', async () => {
    const { FhirEndpointConnector } = await import('@fhirbridge/core');

    vi.mocked(FhirEndpointConnector).mockImplementation(() => ({
      type: 'fhir-endpoint' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn(),
      fetchPatientData: vi.fn().mockReturnValue(makeResourceGenerator(10_000)),
    }));

    const svc = new ExportService();

    // Mock raw stream với /dev/null behavior để không tích lũy chunks trong memory
    const emitter = new EventEmitter();
    let writeCount = 0;
    const nullRaw = Object.assign(emitter, {
      write(_chunk: string, cb?: (err?: Error | null) => void): boolean {
        writeCount++;
        if (cb) cb();
        return true;
      },
      end(): void {
        emitter.emit('finish');
      },
      setHeader: vi.fn(),
      removeListener: emitter.removeListener.bind(emitter),
      once: emitter.once.bind(emitter),
      on: emitter.on.bind(emitter),
    });

    const request = makeMockRequest('stream-user');
    const reply = {
      raw: nullRaw,
      hijack: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;

    // Đo heap trước khi stream
    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    await svc.streamExport(request, reply, {
      patientId: 'patient-perf',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'stream-user',
    });

    if (global.gc) global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

    // Tất cả 10K resources phải được write
    expect(writeCount).toBe(10_000);

    // Memory delta phải dưới 50 MB (sanity check — không buffer array)
    expect(heapDeltaMB).toBeLessThan(50);
  });

  // AC-6: TTFB — chunk đầu tiên phải đến trước khi connector hoàn thành
  it('AC-6: first chunk written within 200ms (TTFB streaming sanity)', async () => {
    const { FhirEndpointConnector } = await import('@fhirbridge/core');

    // Generator delay 5ms mỗi resource → 100 resources = 500ms total
    async function* slowGen() {
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 5));
        yield {
          resourceType: 'Patient',
          data: { resourceType: 'Patient', id: `p-${i}` },
          source: 'test',
        };
      }
    }

    vi.mocked(FhirEndpointConnector).mockImplementation(() => ({
      type: 'fhir-endpoint' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn(),
      fetchPatientData: vi.fn().mockReturnValue(slowGen()),
    }));

    const svc = new ExportService();

    let firstWriteAt = 0;
    const startedAt = Date.now();
    const emitter = new EventEmitter();
    const raw = Object.assign(emitter, {
      write(_chunk: string, cb?: (err?: Error | null) => void): boolean {
        if (firstWriteAt === 0) firstWriteAt = Date.now() - startedAt;
        if (cb) cb();
        return true;
      },
      end(): void {
        emitter.emit('finish');
      },
      setHeader: vi.fn(),
      removeListener: emitter.removeListener.bind(emitter),
      once: emitter.once.bind(emitter),
      on: emitter.on.bind(emitter),
    });

    const request = makeMockRequest('ttfb-user');
    const reply = {
      raw,
      hijack: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;

    await svc.streamExport(request, reply, {
      patientId: 'p',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'ttfb-user',
    });

    // First chunk phải đến trong 200ms — well before 500ms generator total
    expect(firstWriteAt).toBeGreaterThan(0);
    expect(firstWriteAt).toBeLessThan(200);
  });

  // AC-6: Backpressure — slow consumer (write returns false until drain) không OOM server
  it('AC-6: backpressure — slow consumer does not exceed memory bound', async () => {
    const { FhirEndpointConnector } = await import('@fhirbridge/core');

    vi.mocked(FhirEndpointConnector).mockImplementation(() => ({
      type: 'fhir-endpoint' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn(),
      fetchPatientData: vi.fn().mockReturnValue(makeResourceGenerator(2_000)),
    }));

    const svc = new ExportService();

    let writeCount = 0;
    const emitter = new EventEmitter();
    const raw = Object.assign(emitter, {
      // Slow consumer: every 50th write returns false (buffer full) → must drain
      write(_chunk: string, cb?: (err?: Error | null) => void): boolean {
        writeCount++;
        if (cb) setImmediate(() => cb());
        const drained = writeCount % 50 !== 0;
        if (!drained) {
          // Simulate real socket: drain after a tick
          setImmediate(() => emitter.emit('drain'));
        }
        return drained;
      },
      end(): void {
        emitter.emit('finish');
      },
      setHeader: vi.fn(),
      removeListener: emitter.removeListener.bind(emitter),
      once: emitter.once.bind(emitter),
      on: emitter.on.bind(emitter),
    });

    const request = makeMockRequest('bp-user');
    const reply = {
      raw,
      hijack: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;

    if (global.gc) global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    await svc.streamExport(request, reply, {
      patientId: 'p',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'bp-user',
    });

    if (global.gc) global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDeltaMB = (heapAfter - heapBefore) / 1024 / 1024;

    // Tất cả 2K resources được flushed
    expect(writeCount).toBe(2_000);
    // Memory delta vẫn bounded (slow consumer không gây spike)
    expect(heapDeltaMB).toBeLessThan(20);
  });
});

// ── C5: DNS-aware SSRF validation is actually called ────────────────────────

describe('ExportService — C5 DNS-aware SSRF', () => {
  it('calls validateBaseUrlWithDns (not the sync-only validator) on export start', async () => {
    vi.mocked(CoreModule.validateBaseUrlWithDns).mockClear();
    vi.mocked(CoreModule.validateBaseUrlWithDns).mockResolvedValue({ ok: true });

    const svc = new ExportService();
    await svc.startExport(
      {
        patientId: 'p1',
        connectorConfig: {
          type: 'fhir-endpoint',
          baseUrl: 'https://fhir.example.com',
          authType: 'none',
        },
      },
      'u1',
    );
    // Cho async pipeline một tick để chạy tới bước validate
    await new Promise<void>((r) => setTimeout(r, 50));

    expect(vi.mocked(CoreModule.validateBaseUrlWithDns)).toHaveBeenCalledWith(
      'https://fhir.example.com',
    );
  });
});

// ── HIGH: waitForDrain settles on client close during backpressure (no hang) ──

describe('ExportService.streamExport — backpressure + disconnect', () => {
  it('settles (does not hang) when client closes during backpressure with no drain', async () => {
    const { FhirEndpointConnector } = await import('@fhirbridge/core');
    vi.mocked(CoreModule.validateBaseUrlWithDns).mockResolvedValue({ ok: true });

    vi.mocked(FhirEndpointConnector).mockImplementation(() => ({
      type: 'fhir-endpoint' as const,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      testConnection: vi.fn(),
      fetchPatientData: vi.fn().mockReturnValue(makeResourceGenerator(50)),
    }));

    const svc = new ExportService();

    const emitter = new EventEmitter();
    let ended = false;
    let firstWrite = true;
    const raw = Object.assign(emitter, {
      write(_chunk: string, cb?: (err?: Error | null) => void): boolean {
        if (cb) cb();
        if (firstWrite) {
          firstWrite = false;
          // Client disconnect ngay khi backpressure — emit 'close', KHÔNG BAO GIỜ 'drain'.
          setImmediate(() => emitter.emit('close'));
        }
        return false; // luôn backpressured → streamExport phải awaitDrain
      },
      end(): void {
        ended = true;
        emitter.emit('finish');
      },
      setHeader: vi.fn(),
    });

    const request = makeMockRequest('bp-close-user');
    const reply = {
      raw,
      hijack: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;

    // Nếu waitForDrain treo, test này sẽ timeout — đó chính là bug đang fix.
    await svc.streamExport(request, reply, {
      patientId: 'p',
      connectorConfig: {
        type: 'fhir-endpoint',
        baseUrl: 'https://fhir.example.com',
        authType: 'none',
      },
      userId: 'bp-close-user',
    });

    expect(ended).toBe(true);
  });
});

// ── MEDIUM: cross-tenant export access is audited (parity with SummaryService) ─

describe('ExportService.getStatus — IDOR audit', () => {
  class CapturingAuditSink implements AuditSink {
    entries: AuditLogEntry[] = [];
    async write(entry: AuditLogEntry): Promise<void> {
      this.entries.push(entry);
    }
  }

  it('audits cross-tenant denial with hashed ids and returns undefined', async () => {
    vi.mocked(CoreModule.validateBaseUrlWithDns).mockResolvedValue({ ok: true });
    const sink = new CapturingAuditSink();
    const audit = new AuditService(sink);
    const svc = new ExportService({ audit, auditHashSalt: 'test-salt-32-chars-min-required-here' });

    const id = await svc.startExport(
      {
        patientId: 'p1',
        connectorConfig: {
          type: 'fhir-endpoint',
          baseUrl: 'https://fhir.example.com',
          authType: 'none',
        },
      },
      'owner-user-100',
    );

    const record = await svc.getStatus(id, 'attacker-user-200');
    expect(record).toBeUndefined();

    expect(sink.entries).toHaveLength(1);
    const entry = sink.entries[0]!;
    expect(entry.action).toBe('export_access_denied');
    expect(entry.status).toBe('error');
    expect(entry.metadata?.['export_id']).toBe(id);
    expect(entry.metadata?.['reason']).toBe('cross_tenant');
    // Hashed, not raw
    expect(entry.userIdHash).not.toBe('attacker-user-200');
    expect(entry.userIdHash).toMatch(/^[0-9a-f]{16}$/);
    expect(entry.metadata?.['owner_user_hash']).not.toBe('owner-user-100');
  });

  it('does NOT audit legitimate owner access', async () => {
    vi.mocked(CoreModule.validateBaseUrlWithDns).mockResolvedValue({ ok: true });
    const sink = new CapturingAuditSink();
    const audit = new AuditService(sink);
    const svc = new ExportService({ audit });

    const id = await svc.startExport(
      {
        patientId: 'p1',
        connectorConfig: {
          type: 'fhir-endpoint',
          baseUrl: 'https://fhir.example.com',
          authType: 'none',
        },
      },
      'owner-user-101',
    );

    await svc.getStatus(id, 'owner-user-101');
    expect(sink.entries).toHaveLength(0);
  });
});
