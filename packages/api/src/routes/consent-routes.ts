/**
 * Consent routes:
 *   POST /api/v1/consent/record — ghi cross-border AI consent vào audit log.
 *
 * Auth required: JWT Bearer hoặc X-API-Key (qua authPlugin).
 * Returns 204 No Content on success.
 *
 * DI: nhận consentService qua opts để dễ test (không tạo singleton).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ConsentService } from '../services/consent-service.js';
import { requireScope } from '../plugins/auth-plugin.js';
import { postConsentRecordSchema } from '../schemas/consent-schemas.js';
import type { AuditSink } from '../services/audit-service.js';

interface ConsentRecordBody {
  type: 'crossborder_ai';
  consentVersionHash: string;
  granted: boolean;
}

export interface ConsentRoutesOpts {
  auditSink: AuditSink;
}

export async function consentRoutes(
  fastify: FastifyInstance,
  opts: ConsentRoutesOpts,
): Promise<void> {
  const consentService = new ConsentService(opts.auditSink);

  // POST /api/v1/consent/record
  fastify.post<{ Body: ConsentRecordBody }>(
    '/api/v1/consent/record',
    { schema: postConsentRecordSchema, preHandler: requireScope('consent:write') },
    async (request: FastifyRequest<{ Body: ConsentRecordBody }>, reply: FastifyReply) => {
      const { type, consentVersionHash, granted } = request.body;

      // authUser set bởi authPlugin; fallback 'anonymous' không bao giờ xảy ra
      // vì route này không nằm trong PUBLIC_PATHS
      const userId = request.authUser?.id ?? 'anonymous';

      await consentService.recordConsent({
        userId,
        consentType: type,
        consentVersionHash,
        granted,
      });

      return reply.status(204).send();
    },
  );
}
