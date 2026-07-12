/**
 * Tests for IPSBundleBuilder.
 * Verifies IPS document Bundle structure per HL7 IPS profile:
 * https://hl7.org/fhir/uv/ips/StructureDefinition-Composition-uv-ips.html
 *
 * Không dùng mock — sử dụng realistic FHIR R4 data fixtures.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IPSBundleBuilder } from '../ips-builder.js';
import type { Resource, Reference } from '@fhirbridge/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const patient: Resource = { resourceType: 'Patient', id: 'patient-ips-001' };
const authorRef: Reference = { reference: 'Practitioner/dr-nguyen-001', display: 'Dr. Nguyen' };

const allergyResource1: Resource = {
  resourceType: 'AllergyIntolerance',
  id: 'allergy-001',
};

const allergyResource2: Resource = {
  resourceType: 'AllergyIntolerance',
  id: 'allergy-002',
};

const medicationResource1: Resource = {
  resourceType: 'MedicationRequest',
  id: 'med-req-001',
};

const medicationResource2: Resource = {
  resourceType: 'MedicationRequest',
  id: 'med-req-002',
};

const medicationResource3: Resource = {
  resourceType: 'MedicationRequest',
  id: 'med-req-003',
};

const conditionResource: Resource = {
  resourceType: 'Condition',
  id: 'condition-001',
};

// IPS LOINC section codes
const LOINC = 'http://loinc.org';

const allergiesCode = {
  coding: [{ system: LOINC, code: '48765-2', display: 'Allergies and adverse reactions Document' }],
};
const medicationsCode = {
  coding: [{ system: LOINC, code: '10160-0', display: 'History of Medication use Narrative' }],
};
const problemsCode = {
  coding: [{ system: LOINC, code: '11450-4', display: 'Problem list - Reported' }],
};

// Ba LOINC code bắt buộc theo IPS
const MANDATORY_CODES = ['10160-0', '48765-2', '11450-4'];

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Lấy Composition resource từ Bundle (entry[0]).
 * Throws nếu không phải Composition.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getComposition(bundle: ReturnType<IPSBundleBuilder['build']>): any {
  const first = bundle.entry?.[0]?.resource;
  if (!first || first.resourceType !== 'Composition') {
    throw new Error(`Expected entry[0] to be Composition, got ${first?.resourceType}`);
  }
  return first;
}

/** Trả về LOINC code của mỗi section trong Composition */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sectionCodes(composition: any): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return composition.section.map((s: any) => s.code.coding[0].code);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IPSBundleBuilder', () => {
  let builder: IPSBundleBuilder;

  beforeEach(() => {
    builder = new IPSBundleBuilder(patient, authorRef);
  });

  // ── Bundle structure ─────────────────────────────────────────────────────────

  it('builds a Bundle with type = document', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const bundle = builder.build();
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('document');
  });

  it('entry[0] resource is Composition', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const bundle = builder.build();
    const firstEntry = bundle.entry?.[0];
    expect(firstEntry?.resource?.resourceType).toBe('Composition');
  });

  it('sets Bundle.identifier with system + urn:uuid value (bdl-9)', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const bundle = builder.build();
    expect(bundle.identifier).toBeDefined();
    expect(bundle.identifier?.system).toBe('urn:ietf:rfc:3986');
    expect(bundle.identifier?.value).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });

  it('stamps IPS profile on Bundle.meta and Composition.meta', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const bundle = builder.build();
    expect(bundle.meta?.profile).toContain(
      'http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips',
    );
    const composition = getComposition(bundle);
    expect(composition.meta.profile).toContain(
      'http://hl7.org/fhir/uv/ips/StructureDefinition/Composition-uv-ips',
    );
  });

  // ── Patient entry + subject resolution ───────────────────────────────────────

  it('adds the Patient as a Bundle entry (finding ips-builder:176)', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const bundle = builder.build();
    const patientEntry = (bundle.entry ?? []).find((e) => e.resource?.resourceType === 'Patient');
    expect(patientEntry).toBeDefined();
    expect(patientEntry?.resource?.id).toBe('patient-ips-001');
    expect(patientEntry?.fullUrl).toMatch(/^urn:uuid:/);
  });

  it('Composition.subject resolves to the Patient entry via fullUrl', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const bundle = builder.build();
    const composition = getComposition(bundle);
    const subjectRef: string = composition.subject.reference;
    expect(subjectRef).toMatch(/^urn:uuid:/);

    const target = (bundle.entry ?? []).find((e) => e.fullUrl === subjectRef);
    expect(target).toBeDefined();
    expect(target?.resource?.resourceType).toBe('Patient');
    expect(target?.resource?.id).toBe('patient-ips-001');
  });

  it('Composition.author uses provided authorRef', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const composition = getComposition(builder.build());
    expect(composition.author).toEqual([authorRef]);
  });

  it('Composition.author defaults to FHIRBridge display when no authorRef provided', () => {
    const noAuthorBuilder = new IPSBundleBuilder(patient);
    noAuthorBuilder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const composition = getComposition(noAuthorBuilder.build());
    expect(composition.author[0].display).toMatch(/FHIRBridge/i);
  });

  it('Composition.status is final', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const composition = getComposition(builder.build());
    expect(composition.status).toBe('final');
  });

  it('Composition.type contains IPS document LOINC code 60591-5', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const composition = getComposition(builder.build());
    const coding = composition.type?.coding?.[0];
    expect(coding?.system).toBe('http://loinc.org');
    expect(coding?.code).toBe('60591-5');
  });

  it('Composition has a valid ISO date', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const composition = getComposition(builder.build());
    expect(typeof composition.date).toBe('string');
    expect(() => new Date(composition.date).toISOString()).not.toThrow();
  });

  // ── Narrative (IPS 1..1) ──────────────────────────────────────────────────────

  it('Composition.text is a generated XHTML narrative', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const composition = getComposition(builder.build());
    expect(composition.text.status).toBe('generated');
    expect(composition.text.div).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it('every section has a generated XHTML narrative', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const composition = getComposition(builder.build());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const section of composition.section as any[]) {
      expect(section.text.status).toBe('generated');
      expect(section.text.div).toContain(`xmlns="http://www.w3.org/1999/xhtml"`);
    }
  });

  // ── Mandatory IPS sections (Medications/Allergies/Problems 1..1) ──────────────

  it('always emits the 3 mandatory sections even when nothing is added', () => {
    // Không add section nào — cả 3 mandatory phải xuất hiện (empty)
    const composition = getComposition(builder.build());
    const codes = sectionCodes(composition);
    for (const mandatory of MANDATORY_CODES) {
      expect(codes).toContain(mandatory);
    }
    expect(composition.section).toHaveLength(3);
  });

  it('empty mandatory sections carry emptyReason "Nil Known" and no entries', () => {
    const composition = getComposition(builder.build());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const section of composition.section as any[]) {
      expect(section.emptyReason.coding[0].code).toBe('nilknown');
      expect(section.entry ?? []).toHaveLength(0);
    }
  });

  it('a populated mandatory section is NOT overwritten by the empty placeholder', () => {
    builder.addSection('Medications', medicationsCode, [medicationResource1]);
    const composition = getComposition(builder.build());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const medSection = (composition.section as any[]).find(
      (s) => s.code.coding[0].code === '10160-0',
    );
    expect(medSection.entry).toHaveLength(1);
    expect(medSection.emptyReason).toBeUndefined();
    // Vẫn chỉ có đúng 1 Medications section
    expect(sectionCodes(composition).filter((c) => c === '10160-0')).toHaveLength(1);
  });

  // ── Sections ─────────────────────────────────────────────────────────────────

  it('populated sections keep their entries; missing mandatory ones are appended empty', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1, allergyResource2]);
    builder.addSection('Medications', medicationsCode, [
      medicationResource1,
      medicationResource2,
      medicationResource3,
    ]);
    const composition = getComposition(builder.build());
    // Allergies + Medications populated, Problems appended empty → 3 sections
    expect(composition.section).toHaveLength(3);
    const codes = sectionCodes(composition);
    for (const mandatory of MANDATORY_CODES) {
      expect(codes).toContain(mandatory);
    }
  });

  it('section[0] preserves insertion order (allergies added first)', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1, allergyResource2]);
    builder.addSection('Medications', medicationsCode, [medicationResource1]);
    const composition = getComposition(builder.build());
    expect(composition.section[0].code.coding[0].code).toBe('48765-2');
    expect(composition.section[0].title).toBe('Allergies');
  });

  it('section entries contain urn:uuid references matching bundle entries', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1, allergyResource2]);
    const bundle = builder.build();
    const composition = getComposition(bundle);

    const bundleFullUrls = new Set((bundle.entry ?? []).map((e) => e.fullUrl));

    const sectionRefs: string[] = composition.section[0].entry.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ref: any) => ref.reference,
    );
    expect(sectionRefs).toHaveLength(2);
    for (const ref of sectionRefs) {
      expect(bundleFullUrls.has(ref)).toBe(true);
    }
  });

  it('all 5 resource IDs accessible via Composition section references', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1, allergyResource2]);
    builder.addSection('Medications', medicationsCode, [
      medicationResource1,
      medicationResource2,
      medicationResource3,
    ]);
    const bundle = builder.build();
    const composition = getComposition(bundle);

    const urlToResource = new Map<string, Resource>();
    for (const entry of bundle.entry ?? []) {
      if (entry.fullUrl && entry.resource) {
        urlToResource.set(entry.fullUrl, entry.resource);
      }
    }

    const allSectionRefs: string[] = composition.section.flatMap(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (s: any) => (s.entry ?? []).map((e: any) => e.reference),
    );
    expect(allSectionRefs).toHaveLength(5);

    for (const ref of allSectionRefs) {
      expect(urlToResource.has(ref)).toBe(true);
    }

    const resolvedIds = allSectionRefs.map((ref) => urlToResource.get(ref)?.id);
    expect(resolvedIds).toContain('allergy-001');
    expect(resolvedIds).toContain('allergy-002');
    expect(resolvedIds).toContain('med-req-001');
    expect(resolvedIds).toContain('med-req-002');
    expect(resolvedIds).toContain('med-req-003');
  });

  // ── Empty section behavior ───────────────────────────────────────────────────

  it('non-mandatory empty sections are not rendered, but mandatory ones always are', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    builder.addSection('Results', { coding: [{ system: LOINC, code: '30954-2' }] }, []); // empty non-mandatory
    builder.addSection('Problems', problemsCode, [conditionResource]);
    const composition = getComposition(builder.build());
    const codes = sectionCodes(composition);
    // Results (empty, non-mandatory) must NOT appear
    expect(codes).not.toContain('30954-2');
    // All three mandatory present (Medications appended empty)
    for (const mandatory of MANDATORY_CODES) {
      expect(codes).toContain(mandatory);
    }
  });

  // ── Deduplication ────────────────────────────────────────────────────────────

  it('same resource added to multiple sections is not duplicated in Bundle entries', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    builder.addSection('Results', { coding: [{ system: LOINC, code: '30954-2' }] }, [
      allergyResource1,
    ]);
    const bundle = builder.build();
    // allergyResource1 xuất hiện đúng 1 lần trong entries
    const allergyEntries = (bundle.entry ?? []).filter((e) => e.resource?.id === 'allergy-001');
    expect(allergyEntries).toHaveLength(1);
  });

  // ── Serialization ────────────────────────────────────────────────────────────

  it('serialize() returns valid JSON with Bundle.type = document', () => {
    builder.addSection('Allergies', allergiesCode, [allergyResource1]);
    const json = builder.serialize();
    const parsed = JSON.parse(json) as { type: string; resourceType: string };
    expect(parsed.resourceType).toBe('Bundle');
    expect(parsed.type).toBe('document');
  });

  // ── IPS_SECTION_CODES constant ───────────────────────────────────────────────

  it('IPS_SECTION_CODES exports correct LOINC codes', async () => {
    const { IPS_SECTION_CODES } = await import('../ips-builder.js');
    expect(IPS_SECTION_CODES.ALLERGIES).toBe('48765-2');
    expect(IPS_SECTION_CODES.MEDICATIONS).toBe('10160-0');
    expect(IPS_SECTION_CODES.PROBLEMS).toBe('11450-4');
    expect(IPS_SECTION_CODES.RESULTS).toBe('30954-2');
    expect(IPS_SECTION_CODES.PROCEDURES).toBe('47519-4');
    expect(IPS_SECTION_CODES.IMMUNIZATIONS).toBe('11369-6');
  });
});
