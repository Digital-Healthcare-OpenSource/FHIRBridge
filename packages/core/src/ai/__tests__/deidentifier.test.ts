/**
 * De-identifier tests.
 * Verifies ALL PHI is removed and medical codes/values are preserved.
 * IMPORTANT: No PHI appears in test output — only hashes and structural assertions.
 */

import type { Bundle, Resource } from '@fhirbridge/types';
import { describe, it, expect } from 'vitest';

import { deidentify, hashIdentifier, shiftDate, reidentifyDates } from '../deidentifier.js';

const HMAC_SECRET = 'test-secret-do-not-use-in-prod';

/** Build a minimal FHIR Bundle with a patient and some resources */
function buildTestBundle(): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: [
      {
        fullUrl: 'urn:uuid:patient-001',
        resource: {
          resourceType: 'Patient',
          id: 'patient-001',
          name: [{ family: 'Smith', given: ['John', 'Michael'] }],
          telecom: [
            { system: 'phone', value: '555-1234' },
            { system: 'email', value: 'john.smith@example.com' },
          ],
          address: [
            {
              line: ['123 Main St'],
              city: 'Boston',
              state: 'MA',
              postalCode: '02101',
              country: 'US',
            },
          ],
          birthDate: '1980-05-15',
          gender: 'male',
          identifier: [{ system: 'http://hospital.com/mrn', value: 'MRN-123456' }],
        },
      },
      {
        fullUrl: 'urn:uuid:condition-001',
        resource: {
          resourceType: 'Condition',
          id: 'condition-001',
          subject: { reference: 'Patient/patient-001' },
          code: {
            coding: [
              {
                system: 'http://snomed.info/sct',
                code: '44054006',
                display: 'Type 2 diabetes mellitus',
              },
            ],
            text: 'Type 2 Diabetes',
          },
          onsetDateTime: '2020-03-01T10:00:00Z',
          clinicalStatus: {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                code: 'active',
              },
            ],
          },
        },
      },
      {
        fullUrl: 'urn:uuid:observation-001',
        resource: {
          resourceType: 'Observation',
          id: 'observation-001',
          status: 'final',
          code: {
            coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body Weight' }],
          },
          valueQuantity: {
            value: 85.2,
            unit: 'kg',
            system: 'http://unitsofmeasure.org',
            code: 'kg',
          },
          effectiveDateTime: '2023-06-15',
        },
      },
    ],
  };
}

describe('hashIdentifier', () => {
  it('returns a 16-char hex string', () => {
    const result = hashIdentifier('patient-001', HMAC_SECRET);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is deterministic for the same input', () => {
    const a = hashIdentifier('patient-001', HMAC_SECRET);
    const b = hashIdentifier('patient-001', HMAC_SECRET);
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = hashIdentifier('patient-001', HMAC_SECRET);
    const b = hashIdentifier('patient-002', HMAC_SECRET);
    expect(a).not.toBe(b);
  });
});

describe('shiftDate', () => {
  it('shifts a date-only string forward', () => {
    const result = shiftDate('2020-01-01', 10);
    expect(result).toBe('2020-01-11');
  });

  it('shifts a date-only string backward', () => {
    const result = shiftDate('2020-01-15', -10);
    expect(result).toBe('2020-01-05');
  });

  it('preserves datetime format for full ISO strings', () => {
    const result = shiftDate('2020-03-01T10:00:00.000Z', 5);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns original string for invalid dates', () => {
    expect(shiftDate('not-a-date', 10)).toBe('not-a-date');
    expect(shiftDate('', 10)).toBe('');
  });

  it('is reversible', () => {
    const original = '2020-06-15';
    const shifted = shiftDate(original, 25);
    const restored = shiftDate(shifted, -25);
    expect(restored).toBe(original);
  });
});

describe('deidentify', () => {
  it('removes patient name', () => {
    const bundle = buildTestBundle();
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);

    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    const name = patient?.['name'] as Array<Record<string, unknown>>;
    expect(name).toBeDefined();
    expect(name[0]?.['family']).toBe('[PATIENT]');
    expect((name[0]?.['given'] as string[])?.[0]).toBe('[PATIENT]');

    // Original name must not appear
    const bundleStr = JSON.stringify(deident);
    expect(bundleStr).not.toContain('Smith');
    expect(bundleStr).not.toContain('John');
    expect(bundleStr).not.toContain('Michael');
  });

  it('removes telecom (phone/email)', () => {
    const bundle = buildTestBundle();
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);

    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    expect((patient?.['telecom'] as unknown[])?.length).toBe(0);

    const bundleStr = JSON.stringify(deident);
    expect(bundleStr).not.toContain('555-1234');
    expect(bundleStr).not.toContain('john.smith@example.com');
  });

  it('strips address line/city/postalCode, keeps only state/country (Safe Harbor)', () => {
    const bundle = buildTestBundle();
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);

    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    const addresses = patient?.['address'] as Array<Record<string, unknown>>;
    // HIGH: city is now DROPPED (re-identification vector) — only state + country remain
    expect(addresses[0]?.['city']).toBeUndefined();
    expect(addresses[0]?.['state']).toBe('MA');
    expect(addresses[0]?.['country']).toBe('US');
    expect(addresses[0]?.['line']).toBeUndefined();
    expect(addresses[0]?.['postalCode']).toBeUndefined();

    const bundleStr = JSON.stringify(deident);
    expect(bundleStr).not.toContain('123 Main St');
    expect(bundleStr).not.toContain('02101');
    expect(bundleStr).not.toContain('Boston');
  });

  it('hashes patient ID and MRN', () => {
    const bundle = buildTestBundle();
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);

    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    expect(patient?.['id']).not.toBe('patient-001');
    expect(patient?.['id']).toMatch(/^[0-9a-f]{16}$/);

    const identifiers = patient?.['identifier'] as Array<Record<string, unknown>>;
    expect(identifiers[0]?.['value']).not.toBe('MRN-123456');
    expect(identifiers[0]?.['value']).toMatch(/^[0-9a-f]{16}$/);

    const bundleStr = JSON.stringify(deident);
    expect(bundleStr).not.toContain('patient-001');
    expect(bundleStr).not.toContain('MRN-123456');
  });

  it('shifts dates consistently', () => {
    const bundle = buildTestBundle();
    const { bundle: deident, shiftMap } = deidentify(bundle, HMAC_SECRET);

    // shiftMap should have one entry
    const shifts = Object.values(shiftMap);
    expect(shifts.length).toBeGreaterThan(0);
    const offset = shifts[0]!;
    expect(Math.abs(offset)).toBeLessThanOrEqual(30);

    // Birth date should be shifted
    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    expect(patient?.['birthDate']).not.toBe('1980-05-15');
    expect(patient?.['birthDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('preserves medical codes (SNOMED, LOINC)', () => {
    const bundle = buildTestBundle();
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);

    const bundleStr = JSON.stringify(deident);
    // SNOMED code for diabetes must be preserved
    expect(bundleStr).toContain('44054006');
    expect(bundleStr).toContain('http://snomed.info/sct');
    // LOINC code for body weight must be preserved
    expect(bundleStr).toContain('29463-7');
    expect(bundleStr).toContain('http://loinc.org');
  });

  it('preserves observation valueQuantity', () => {
    const bundle = buildTestBundle();
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);

    const observation = deident.entry?.[2]?.resource as Record<string, unknown>;
    const valueQuantity = observation?.['valueQuantity'] as Record<string, unknown>;
    expect(valueQuantity?.['value']).toBe(85.2);
    expect(valueQuantity?.['unit']).toBe('kg');
  });

  it('marks bundle as deidentified', () => {
    const bundle = buildTestBundle();
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    expect((deident as Record<string, unknown>)['_deidentified']).toBe(true);
  });

  it('produces consistent results for same input', () => {
    const bundle = buildTestBundle();
    const { bundle: d1 } = deidentify(bundle, HMAC_SECRET);
    const { bundle: d2 } = deidentify(bundle, HMAC_SECRET);
    // IDs should be identical (deterministic hashing)
    const p1 = (d1.entry?.[0]?.resource as Record<string, unknown>)?.['id'];
    const p2 = (d2.entry?.[0]?.resource as Record<string, unknown>)?.['id'];
    expect(p1).toBe(p2);
  });
});

describe('reidentifyDates', () => {
  it('reverses date shifts in text', () => {
    const shiftMap = { abc123: 10 };
    const text = 'Patient was seen on 2020-01-11. Follow-up on 2020-02-01.';
    const result = reidentifyDates(text, shiftMap);
    expect(result).toContain('2020-01-01');
    expect(result).toContain('2020-01-22');
  });

  it('handles empty shift map', () => {
    const text = 'Some text with 2020-01-01 in it.';
    expect(reidentifyDates(text, {})).toBe(text);
  });

  it('returns text unchanged when shiftMap has multiple entries', () => {
    // Cannot safely reverse dates for multi-patient bundles
    const shiftMap = { aaa: 5, bbb: 10 };
    const text = 'Seen on 2020-01-06.';
    expect(reidentifyDates(text, shiftMap)).toBe(text);
  });
});

describe('deidentify — security-fix coverage', () => {
  it('redacts text.div narrative to [NARRATIVE REDACTED]', () => {
    // Use unknown cast because FHIR base Resource doesn't declare text/extension fields
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
            text: { status: 'generated', div: '<div>John Smith, DOB 1980-01-01</div>' },
          } as unknown as Resource,
        },
      ],
    };

    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    const textField = patient?.['text'] as Record<string, unknown>;
    expect(textField?.['div']).toContain('[NARRATIVE REDACTED]');
    expect(JSON.stringify(deident)).not.toContain('John Smith');
  });

  it('strips extension arrays to empty', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
            extension: [
              {
                url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
                valueString: 'Asian',
              },
            ],
          } as unknown as Resource,
        },
      ],
    };

    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    expect(patient?.['extension'] as unknown[]).toEqual([]);
  });

  it('strips modifierExtension to empty', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Condition',
            id: 'c1',
            modifierExtension: [{ url: 'http://example.com/flag', valueBoolean: true }],
          } as unknown as Resource,
        },
      ],
    };

    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const condition = deident.entry?.[0]?.resource as Record<string, unknown>;
    expect(condition?.['modifierExtension'] as unknown[]).toEqual([]);
  });

  it('strips note arrays to empty', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Condition',
            id: 'c1',
            note: [{ text: 'Patient smokes 1 pack per day — personal detail' }],
          } as unknown as Resource,
        },
      ],
    };

    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const condition = deident.entry?.[0]?.resource as Record<string, unknown>;
    expect(condition?.['note'] as unknown[]).toEqual([]);
    expect(JSON.stringify(deident)).not.toContain('smokes');
  });

  it('redacts valueString to [CLINICAL_TEXT_REDACTED]', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Observation',
            id: 'obs1',
            status: 'final',
            valueString: 'Mild chest discomfort noted by provider',
          } as unknown as Resource,
        },
      ],
    };

    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const obs = deident.entry?.[0]?.resource as Record<string, unknown>;
    expect(obs?.['valueString']).toBe('[CLINICAL_TEXT_REDACTED]');
    expect(JSON.stringify(deident)).not.toContain('chest discomfort');
  });
});

describe('deidentify — C-10 invariant tests', () => {
  // INV-2: date shift không bao giờ bằng 0
  it('INV-2: date shift is never zero for any generated patient', () => {
    // Kiểm tra nhiều patient IDs khác nhau để đảm bảo không có zero-shift
    const patientIds = [
      'patient-001',
      'patient-002',
      'patient-abc',
      'p-xyz',
      'test-id-99',
      'a',
      'b',
      '123',
      'uuid-aaaa-bbbb',
      'some-other-id',
    ];
    for (const pid of patientIds) {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          {
            resource: {
              resourceType: 'Patient',
              id: pid,
              birthDate: '1980-01-01',
            } as unknown as Resource,
          },
        ],
      };
      const { shiftMap } = deidentify(bundle, HMAC_SECRET);
      const shifts = Object.values(shiftMap);
      expect(shifts.length).toBeGreaterThan(0);
      for (const shift of shifts) {
        expect(shift, `Expected shift != 0 for patient id '${pid}'`).not.toBe(0);
      }
    }
  });

  // INV-3: bệnh nhân 92 tuổi → birthDate undefined hoặc year-only bucket
  it('INV-3: Patient age 92 → birthDate is year-only bucket "1900"', () => {
    // Năm sinh 1933 → tuổi ≈ 93 tại 2026
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'elderly-patient',
            birthDate: '1933-06-15',
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    // birthDate phải là year-only bucket, không phải ngày thật
    expect(patient?.['birthDate']).toBe('1900');
    // Không được chứa năm sinh thật
    expect(JSON.stringify(deident)).not.toContain('1933');
  });

  // INV-3b: bệnh nhân 88 tuổi → birthDate vẫn được shift bình thường
  it('INV-3b: Patient age 88 → birthDate is shifted (not bucketed)', () => {
    // Năm sinh 1937 → tuổi ≈ 89 tại 2026 — cần test với 88 tuổi thật
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'young-enough',
            birthDate: '1940-06-15', // ~86 tuổi tại 2026
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    // Không phải bucket — phải là date đã shift
    expect(patient?.['birthDate']).not.toBe('1900');
    expect(patient?.['birthDate']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // INV-4: Organization.name → HMAC hash (không phải tên thật)
  it('INV-4: Organization name "General Hospital" is replaced with HMAC hash', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'Organization',
            id: 'org-001',
            name: 'General Hospital',
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const org = deident.entry?.[1]?.resource as Record<string, unknown>;
    // name phải là HMAC hash (16 hex chars), không phải tên gốc
    expect(org?.['name']).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(deident)).not.toContain('General Hospital');
  });

  // INV-4b: Location.name → HMAC hash
  it('INV-4b: Location name "ICU Ward 3" is replaced with HMAC hash', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'Location',
            id: 'loc-001',
            name: 'ICU Ward 3',
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const loc = deident.entry?.[1]?.resource as Record<string, unknown>;
    expect(loc?.['name']).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(deident)).not.toContain('ICU Ward 3');
  });

  // INV-5: code.text PHI string → stripped/redacted
  it('INV-5: code.text PHI string is redacted', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'Condition',
            id: 'c1',
            code: {
              coding: [{ system: 'http://snomed.info/sct', code: '44054006' }],
              text: 'John has diabetes — personal note with PHI',
            },
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const bundleStr = JSON.stringify(deident);
    // text PHI không được xuất hiện
    expect(bundleStr).not.toContain('John has diabetes');
    expect(bundleStr).not.toContain('personal note with PHI');
    // SNOMED code vẫn được giữ
    expect(bundleStr).toContain('44054006');
  });

  // INV-6: dosageInstruction.text → redacted
  it('INV-6: dosageInstruction.text is redacted', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'MedicationRequest',
            id: 'med1',
            status: 'active',
            dosageInstruction: [
              {
                text: 'Take 1 tablet daily — patient name Nguyen Van A',
                patientInstruction: 'Specific instruction for Tran Thi B',
              },
            ],
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const bundleStr = JSON.stringify(deident);
    expect(bundleStr).not.toContain('Nguyen Van A');
    expect(bundleStr).not.toContain('Tran Thi B');
  });

  // INV-7: Vietnamese patient name với non-ASCII chars
  it('INV-7: Vietnamese non-ASCII patient name is not leaked', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'vn-patient',
            name: [{ family: 'Nguyễn', given: ['Văn', 'Anh'] }],
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const bundleStr = JSON.stringify(deident);
    expect(bundleStr).not.toContain('Nguyễn');
    expect(bundleStr).not.toContain('Văn');
    expect(bundleStr).not.toContain('Anh');
  });

  // INV-8: authoredOn và effectiveInstant fields mới → được shift
  it('INV-8: authoredOn and effectiveInstant are shifted', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'MedicationRequest',
            id: 'med1',
            status: 'active',
            authoredOn: '2023-05-10',
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'Observation',
            id: 'obs1',
            status: 'final',
            effectiveInstant: '2023-05-10T12:00:00Z',
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const medReq = deident.entry?.[1]?.resource as Record<string, unknown>;
    const obs = deident.entry?.[2]?.resource as Record<string, unknown>;
    // authoredOn phải khác ngày gốc
    expect(medReq?.['authoredOn']).not.toBe('2023-05-10');
    expect(medReq?.['authoredOn']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // effectiveInstant phải được shift
    expect(obs?.['effectiveInstant']).not.toBe('2023-05-10T12:00:00Z');
  });
});

describe('deidentify — expert-review fixes (C1/C2/contained/onsetAge)', () => {
  // C1: Reference.display (subject/performer/requester) leaks tên → redact
  it('C1: redacts subject/performer/requester Reference.display, preserves coding[].display', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'Observation',
            id: 'obs1',
            status: 'final',
            subject: { reference: 'Patient/p1', display: 'Nguyễn Văn A' },
            performer: [{ reference: 'Practitioner/pr1', display: 'BS. Trần Thị B' }],
            code: {
              coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body Weight' }],
            },
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'ServiceRequest',
            id: 'sr1',
            status: 'active',
            requester: { reference: 'Practitioner/pr2', display: 'Dr. Charlie Requester' },
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const bundleStr = JSON.stringify(deident);

    // Tên người trong display KHÔNG được leak
    expect(bundleStr).not.toContain('Nguyễn Văn A');
    expect(bundleStr).not.toContain('Trần Thị B');
    expect(bundleStr).not.toContain('Charlie Requester');
    expect(bundleStr).toContain('[REDACTED]');

    // Medical code display PHẢI được giữ nguyên
    expect(bundleStr).toContain('Body Weight');
    expect(bundleStr).toContain('29463-7');

    const obs = deident.entry?.[1]?.resource as Record<string, unknown>;
    const subject = obs?.['subject'] as Record<string, unknown>;
    expect(subject?.['display']).toBe('[REDACTED]');
    // reference vẫn được hash (không phải plaintext id)
    expect(String(subject?.['reference'])).toMatch(/^Patient\/[0-9a-f]{16}$/);
  });

  // C2: Patient.photo + DiagnosticReport.presentedForm + DocumentReference attachment → strip
  it('C2: strips Attachment data/url/title, preserves contentType', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Patient',
            id: 'p1',
            photo: [
              { contentType: 'image/jpeg', data: 'aGVsbG8tcGhvdG8tYmFzZTY0', title: 'face.jpg' },
            ],
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'DiagnosticReport',
            id: 'dr1',
            status: 'final',
            presentedForm: [
              {
                contentType: 'application/pdf',
                data: 'JVBERi0xLjQtaWRlbnRpZnlpbmctcGRm',
                title: 'John Smith Radiology Report.pdf',
              },
            ],
          } as unknown as Resource,
        },
        {
          resource: {
            resourceType: 'DocumentReference',
            id: 'doc1',
            status: 'current',
            content: [
              {
                attachment: {
                  contentType: 'application/pdf',
                  url: 'https://hospital.example.com/patients/john-smith/scan.pdf',
                },
              },
            ],
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const bundleStr = JSON.stringify(deident);

    // Base64 payload + tiêu đề định danh + url KHÔNG được leak
    expect(bundleStr).not.toContain('aGVsbG8tcGhvdG8tYmFzZTY0');
    expect(bundleStr).not.toContain('JVBERi0xLjQtaWRlbnRpZnlpbmctcGRm');
    expect(bundleStr).not.toContain('John Smith');
    expect(bundleStr).not.toContain('face.jpg');
    expect(bundleStr).not.toContain('hospital.example.com');
    expect(bundleStr).toContain('[ATTACHMENT_REDACTED]');

    // contentType PHẢI được giữ
    expect(bundleStr).toContain('image/jpeg');
    expect(bundleStr).toContain('application/pdf');

    const patient = deident.entry?.[0]?.resource as Record<string, unknown>;
    const photo = (patient?.['photo'] as Array<Record<string, unknown>>)[0];
    expect(photo?.['data']).toBe('[ATTACHMENT_REDACTED]');
    expect(photo?.['title']).toBe('[ATTACHMENT_REDACTED]');
    expect(photo?.['contentType']).toBe('image/jpeg');
  });

  // C2 negative: SampledData.data (không có contentType) KHÔNG bị redact nhầm
  it('C2: does not redact SampledData.data (no contentType → not an attachment)', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Observation',
            id: 'obs1',
            status: 'final',
            valueSampledData: {
              origin: { value: 0 },
              period: 100,
              dimensions: 1,
              data: '1 2 3 4 5',
            },
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const obs = deident.entry?.[0]?.resource as Record<string, unknown>;
    const sampled = obs?.['valueSampledData'] as Record<string, unknown>;
    expect(sampled?.['data']).toBe('1 2 3 4 5');
  });

  // MEDIUM: contained Organization name phải được hash (resourceType override)
  it('contained Organization name is HMAC-hashed via resourceType override', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Encounter',
            id: 'enc1',
            status: 'finished',
            contained: [
              {
                resourceType: 'Organization',
                id: 'org-contained',
                name: 'Contained General Hospital',
              },
              {
                resourceType: 'Location',
                id: 'loc-contained',
                name: 'Contained ICU Ward 7',
              },
            ],
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const bundleStr = JSON.stringify(deident);
    // Tên tổ chức/địa điểm contained KHÔNG được leak
    expect(bundleStr).not.toContain('Contained General Hospital');
    expect(bundleStr).not.toContain('Contained ICU Ward 7');

    const enc = deident.entry?.[0]?.resource as Record<string, unknown>;
    const contained = enc?.['contained'] as Array<Record<string, unknown>>;
    expect(contained[0]?.['name']).toMatch(/^[0-9a-f]{16}$/);
    expect(contained[1]?.['name']).toMatch(/^[0-9a-f]{16}$/);
  });

  // MEDIUM: onsetAge > 89 phải bị cap; onsetString phải bị redact
  it('caps onsetAge/abatementAge value > 89 and redacts onsetString/abatementString', () => {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Condition',
            id: 'c1',
            onsetAge: { value: 92, unit: 'years', system: 'http://unitsofmeasure.org', code: 'a' },
            abatementAge: {
              value: 80,
              unit: 'years',
              system: 'http://unitsofmeasure.org',
              code: 'a',
            },
            onsetString: 'since patient John moved to Boston in his 90s',
          } as unknown as Resource,
        },
      ],
    };
    const { bundle: deident } = deidentify(bundle, HMAC_SECRET);
    const condition = deident.entry?.[0]?.resource as Record<string, unknown>;

    const onsetAge = condition?.['onsetAge'] as Record<string, unknown>;
    expect(onsetAge?.['value']).toBe(89); // 92 capped to 89
    expect(onsetAge?.['unit']).toBe('years'); // unit preserved

    const abatementAge = condition?.['abatementAge'] as Record<string, unknown>;
    expect(abatementAge?.['value']).toBe(80); // ≤ 89 untouched

    expect(condition?.['onsetString']).toBe('[CLINICAL_TEXT_REDACTED]');
    expect(JSON.stringify(deident)).not.toContain('Boston');
    expect(JSON.stringify(deident)).not.toContain('John moved');
  });

  // LOW: patient-less bundle derives per-subject date-shift offset (not a shared global)
  it('derives per-subject date shift for patient-less bundles', () => {
    const makeBundle = (subjectRef: string): Bundle => ({
      resourceType: 'Bundle',
      type: 'collection',
      entry: [
        {
          resource: {
            resourceType: 'Observation',
            id: 'obs1',
            status: 'final',
            subject: { reference: subjectRef },
            effectiveDateTime: '2023-06-15',
          } as unknown as Resource,
        },
      ],
    });
    const { shiftMap: mapA } = deidentify(makeBundle('Patient/subject-A'), HMAC_SECRET);
    const { shiftMap: mapB } = deidentify(makeBundle('Patient/subject-B'), HMAC_SECRET);
    // Hai subject khác nhau → key khác nhau (không dùng chung offset 'unknown')
    expect(Object.keys(mapA)[0]).not.toBe(Object.keys(mapB)[0]);
  });
});
