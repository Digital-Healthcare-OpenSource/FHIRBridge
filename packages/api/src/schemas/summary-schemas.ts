/**
 * JSON Schema definitions for summary routes.
 */

export const summaryGenerateRequestSchema = {
  type: 'object',
  properties: {
    exportId: { type: 'string' },
    bundle: { type: 'object', additionalProperties: true },
    summaryConfig: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['en', 'vi', 'ja', 'ko'], default: 'en' },
        provider: { type: 'string', enum: ['claude', 'openai'], default: 'claude' },
        detailLevel: {
          type: 'string',
          enum: ['brief', 'standard', 'detailed'],
          default: 'standard',
        },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
} as const;

export const postSummaryGenerateSchema = {
  body: summaryGenerateRequestSchema,
  response: {
    202: {
      type: 'object',
      properties: {
        summaryId: { type: 'string' },
        status: { type: 'string' },
      },
    },
  },
} as const;

export const getSummaryDownloadParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
  },
} as const;

export const getSummaryDownloadQuerySchema = {
  type: 'object',
  properties: {
    format: { type: 'string', enum: ['markdown', 'composition'], default: 'markdown' },
  },
} as const;

export const getSummaryDownloadSchema = {
  params: getSummaryDownloadParamsSchema,
  querystring: getSummaryDownloadQuerySchema,
} as const;
