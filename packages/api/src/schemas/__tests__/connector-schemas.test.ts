/**
 * Tests for connector-schemas.ts — validates JSON Schema correctness, and the
 * canonical column-mapping JSON Schema shipped in examples/column-mappings/.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { FIELD_TRANSFORMS, SUPPORTED_RESOURCE_TYPES, parseMappingConfig } from '@fhirbridge/core';
import {
  postConnectorTestSchema,
  connectorTestRequestSchema,
  postConnectorImportSchema,
  IMPORT_FIELDS,
  MAPPING_REQUIRED_MESSAGE,
  MAX_IMPORT_RESOURCES,
} from '../connector-schemas.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.post('/connector/test', { schema: postConnectorTestSchema }, async (req) => req.body);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('connectorTestRequestSchema — valid payload', () => {
  it('accepts minimal valid connector test payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'https://fhir.example.com' },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts payload with optional fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: {
        type: 'fhir-endpoint',
        config: {
          baseUrl: 'https://fhir.example.com',
          clientId: 'my-client',
          clientSecret: 'secret',
          tokenEndpoint: 'https://auth.example.com/token',
          timeout: 5000,
        },
      },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('connectorTestRequestSchema — invalid payload', () => {
  it('rejects when type is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: { config: { baseUrl: 'https://fhir.example.com' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when config is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: { type: 'fhir-endpoint' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects when config.baseUrl is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: { type: 'fhir-endpoint', config: { clientId: 'abc' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid type enum value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: {
        type: 'unknown-type',
        config: { baseUrl: 'https://fhir.example.com' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty baseUrl (minLength: 1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: '' },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('strips additional top-level properties (Fastify removeAdditional mode)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/connector/test',
      payload: {
        type: 'fhir-endpoint',
        config: { baseUrl: 'https://fhir.example.com' },
        extraField: 'oops',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('extraField');
  });
});

describe('connectorTestRequestSchema — plain object shape', () => {
  it('has required fields type and config', () => {
    expect(connectorTestRequestSchema.required).toContain('type');
    expect(connectorTestRequestSchema.required).toContain('config');
  });

  it('type only allows fhir-endpoint', () => {
    expect(connectorTestRequestSchema.properties.type.enum).toContain('fhir-endpoint');
    expect(connectorTestRequestSchema.properties.type.enum.length).toBe(1);
  });
});

// ── Import route schema + examples/column-mappings/mapping.schema.json ──────

describe('postConnectorImportSchema / import constants', () => {
  it('documents the multipart contract', () => {
    expect(postConnectorImportSchema.consumes).toEqual(['multipart/form-data']);
    expect(IMPORT_FIELDS).toEqual({ file: 'file', mapping: 'mapping', sheet: 'sheet' });
    expect(MAPPING_REQUIRED_MESSAGE).toMatch(/examples\/column-mappings/);
    expect(MAX_IMPORT_RESOURCES).toBe(10_000);
  });
});

describe('examples/column-mappings/mapping.schema.json', () => {
  const dir = resolve(__dirname, '../../../../../examples/column-mappings');
  const schema = JSON.parse(readFileSync(join(dir, 'mapping.schema.json'), 'utf8'));
  const exampleFiles = readdirSync(dir).filter(
    (f) => f.endsWith('.json') && f !== 'mapping.schema.json',
  );
  let validator: FastifyInstance;

  beforeAll(async () => {
    // Ajv nghiêm ngặt: không tự xoá/ép kiểu field — lỗi phải lộ ra
    validator = Fastify({
      logger: false,
      ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: true } },
    });
    validator.post('/validate', { schema: { body: schema } }, async () => ({ ok: true }));
    await validator.ready();
  });

  afterAll(async () => {
    await validator.close();
  });

  const check = (payload: unknown) =>
    validator.inject({ method: 'POST', url: '/validate', payload: payload as object });

  it.each(exampleFiles)(
    '%s validates against the schema and points to it relatively',
    async (file) => {
      const example = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      expect(example.$schema).toBe('./mapping.schema.json');
      const res = await check(example);
      expect(res.json()).toEqual({ ok: true });
      // …and the core loader agrees
      expect(() => parseMappingConfig(example)).not.toThrow();
    },
  );

  it.each([
    ['unknown top-level key', { fields: { 'Patient.name.family': 'L' }, field: {} }],
    ['unknown transform', { fields: { 'Patient.gender': { column: 'G', transform: 'lower' } } }],
    [
      'format without date transform',
      { fields: { 'Patient.birthDate': { column: 'D', format: 'YYYY' } } },
    ],
    ['IANA timezone', { timezone: 'Asia/Seoul', fields: { 'Patient.name.family': 'L' } }],
    ['key without resource type', { fields: { gender: 'G' } }],
    ['unsupported resource type', { fields: { 'Medication.code.text': 'M' } }],
    ['literal with extra key', { fields: { 'Patient.active': { literal: true, column: 'A' } } }],
    ['empty fields', { fields: {} }],
  ])('rejects %s (as does parseMappingConfig)', async (_label, payload) => {
    const res = await check(payload);
    expect(res.statusCode).toBe(400);
    expect(() => parseMappingConfig(payload)).toThrow();
  });

  it('stays in sync with the core loader constants', () => {
    expect(schema.definitions.resourceType.enum).toEqual([...SUPPORTED_RESOURCE_TYPES]);
    expect(schema.definitions.columnSpec.properties.transform.enum).toEqual([...FIELD_TRANSFORMS]);
    const keyPattern: string = schema.properties.fields.propertyNames.pattern;
    for (const type of SUPPORTED_RESOURCE_TYPES) expect(keyPattern).toContain(type);
    const tz = new RegExp(schema.properties.timezone.pattern);
    for (const ok of ['+07:00', '+09:00', '-05:00', 'Z']) expect(tz.test(ok)).toBe(true);
    for (const bad of ['+7', 'UTC', '+15:00', 'Asia/Seoul']) expect(tz.test(bad)).toBe(false);
  });
});
