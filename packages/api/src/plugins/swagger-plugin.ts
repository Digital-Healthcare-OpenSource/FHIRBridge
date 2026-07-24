/**
 * Swagger / OpenAPI plugin — auto-generate API docs từ JSON schemas hiện có.
 *
 * Bonus H-9:
 * - @fastify/swagger tự gen spec từ route schemas
 * - @fastify/swagger-ui mount tại /api/v1/docs
 * - GET /api/v1/openapi.json expose spec JSON
 *
 * Chỉ enable trong non-production hoặc khi ENABLE_DOCS=true.
 * Docs không expose PHI — chỉ mô tả schema structure.
 */

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { skipOverride } from './plugin-utils.js';

async function _swaggerPlugin(fastify: FastifyInstance): Promise<void> {
  // Chỉ mount docs khi không phải production hoặc đã bật ENABLE_DOCS
  const isProduction = process.env['NODE_ENV'] === 'production';
  const enableDocs = process.env['ENABLE_DOCS'] === 'true';
  if (isProduction && !enableDocs) {
    fastify.log.info('[Swagger] docs disabled in production (set ENABLE_DOCS=true to enable)');
    return;
  }

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'FHIRBridge API',
        description:
          'FHIR R4 Patient Data Portability Tool — exports patient data, transforms to FHIR bundles, generates AI summaries.',
        version: '0.2.0',
        contact: {
          name: 'FHIRBridge Team',
        },
        license: {
          name: 'MIT',
        },
      },
      servers: [
        {
          url: '/api/v1',
          description: 'FHIRBridge API v1',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT token (HS256) — include in Authorization header',
          },
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'API key for machine-to-machine access',
          },
        },
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'export', description: 'FHIR R4 data export' },
        { name: 'summary', description: 'AI-powered patient summary generation' },
        { name: 'consent', description: 'Cross-border AI consent records' },
        { name: 'connector', description: 'HIS connector management' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/api/v1/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: false, // CSP managed by security-headers-plugin
    transformStaticCSP: (header) => header,
  });

  fastify.log.info('[Swagger] docs available at /api/v1/docs');
}

export const swaggerPlugin = skipOverride(_swaggerPlugin);
