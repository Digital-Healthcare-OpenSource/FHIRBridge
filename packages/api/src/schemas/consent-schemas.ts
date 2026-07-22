/**
 * JSON Schema definitions for consent routes.
 * Không dùng TypeBox — giữ nhất quán với các schema file khác trong project.
 *
 * PIPA Art. 28-8 (Korea): grant consent với market='kr' phải xác nhận đủ 5 mục
 * disclosure — thiếu bất kỳ mục nào → 400 (enforce bằng if/then bên dưới).
 */

/** 5 mục disclosure bắt buộc theo PIPA Art. 28-8 khi chuyển PI ra nước ngoài. */
export const PIPA_DISCLOSURE_KEYS = [
  'dataCategories', // 1. Thông tin được chuyển
  'destinationAndMethod', // 2. Nước nhận + phương thức chuyển
  'recipientContact', // 3. Bên nhận (tên + contact)
  'purposeAndRetention', // 4. Mục đích sử dụng + thời gian lưu của bên nhận
  'refusalAndConsequences', // 5. Cách từ chối + hậu quả của từ chối
] as const;

export const consentRecordBodySchema = {
  type: 'object',
  required: ['type', 'consentVersionHash', 'granted'],
  properties: {
    type: {
      type: 'string',
      enum: ['crossborder_ai'],
    },
    consentVersionHash: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
    },
    granted: {
      type: 'boolean',
    },
    market: {
      type: 'string',
      enum: ['kr'],
    },
    disclosures: {
      type: 'object',
      properties: Object.fromEntries(PIPA_DISCLOSURE_KEYS.map((k) => [k, { type: 'boolean' }])),
      additionalProperties: false,
    },
  },
  additionalProperties: false,
  // PIPA Art. 28-8: grant (granted=true) cho thị trường KR → phải ack đủ 5 mục.
  // Decline (granted=false) vẫn được record mà không cần disclosures.
  if: {
    required: ['market'],
    properties: {
      market: { const: 'kr' },
      granted: { const: true },
    },
  },
  then: {
    required: ['disclosures'],
    properties: {
      disclosures: {
        type: 'object',
        required: [...PIPA_DISCLOSURE_KEYS],
        properties: Object.fromEntries(PIPA_DISCLOSURE_KEYS.map((k) => [k, { const: true }])),
      },
    },
  },
} as const;

export const postConsentRecordSchema = {
  body: consentRecordBodySchema,
  response: {
    204: {
      type: 'null',
      description: 'Consent recorded successfully',
    },
  },
} as const;
