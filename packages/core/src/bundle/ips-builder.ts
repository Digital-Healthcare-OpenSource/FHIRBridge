/**
 * IPS (International Patient Summary) Bundle builder.
 *
 * Theo chuẩn HL7 IPS: https://hl7.org/fhir/uv/ips/
 * - Bundle type phải là 'document'
 * - Entry đầu tiên PHẢI là Composition resource (document root)
 * - Composition.subject → Patient (phải resolve được trong Bundle)
 * - Composition.section[] chứa các clinical category entries
 * - Ba section Medications (10160-0), Allergies (48765-2), Problems (11450-4)
 *   là BẮT BUỘC (cardinality 1..1) — luôn phát ra, dùng emptyReason khi rỗng.
 * - Composition.text và mỗi section.text là narrative bắt buộc (1..1).
 *
 * FHIR R4 §Composition: https://hl7.org/fhir/r4/composition.html
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Resource,
  Bundle,
  BundleEntry,
  Reference,
  CodeableConcept,
  Coding,
  Narrative,
} from '@fhirbridge/types';

// ── Minimal Composition type (inline — tránh edit packages/types) ───────────

/** FHIR R4 Composition.section */
interface CompositionSection {
  title: string;
  code: CodeableConcept;
  /** Narrative bắt buộc theo IPS (1..1) */
  text: Narrative;
  /** Reference tới resources trong Bundle entries (bỏ trống khi section rỗng) */
  entry?: Reference[];
  /** Lý do rỗng — bắt buộc khi section không có entry (FHIR cmp-2) */
  emptyReason?: CodeableConcept;
}

/** FHIR R4 Composition resource — minimal IPS-required fields */
interface Composition extends Resource {
  readonly resourceType: 'Composition';
  status: 'preliminary' | 'final' | 'amended' | 'entered-in-error';
  /** IPS document type: LOINC 60591-5 */
  type: CodeableConcept;
  subject: Reference;
  date: string;
  author: Reference[];
  title: string;
  /** Narrative bắt buộc theo IPS (1..1) */
  text: Narrative;
  section: CompositionSection[];
}

// ── IPS Section LOINC codes (per HL7 IPS profile) ───────────────────────────

/**
 * LOINC codes cho IPS sections theo chuẩn HL7 IPS:
 * https://hl7.org/fhir/uv/ips/StructureDefinition-Composition-uv-ips.html
 */
export const IPS_SECTION_CODES = {
  /** Allergies and Intolerances — LOINC 48765-2 */
  ALLERGIES: '48765-2',
  /** Medications — LOINC 10160-0 */
  MEDICATIONS: '10160-0',
  /** Problems / Conditions — LOINC 11450-4 */
  PROBLEMS: '11450-4',
  /** Results (Observations, DiagnosticReports) — LOINC 30954-2 */
  RESULTS: '30954-2',
  /** Procedures — LOINC 47519-4 */
  PROCEDURES: '47519-4',
  /** Immunizations — LOINC 11369-6 */
  IMMUNIZATIONS: '11369-6',
} as const;

const LOINC_SYSTEM = 'http://loinc.org';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** IPS canonical profiles (StructureDefinition) */
const COMPOSITION_IPS_PROFILE = 'http://hl7.org/fhir/uv/ips/StructureDefinition/Composition-uv-ips';
const BUNDLE_IPS_PROFILE = 'http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips';

/** IPS document type Coding */
const IPS_DOCUMENT_TYPE_CODING: Coding = {
  system: LOINC_SYSTEM,
  code: '60591-5',
  display: 'Patient summary Document',
};

/** "Nil Known" empty reason cho mandatory section rỗng (FHIR list-empty-reason) */
const NIL_KNOWN_EMPTY_REASON: CodeableConcept = {
  coding: [
    {
      system: 'http://terminology.hl7.org/CodeSystem/list-empty-reason',
      code: 'nilknown',
      display: 'Nil Known',
    },
  ],
};

/**
 * Ba section bắt buộc theo IPS (cardinality 1..1). Luôn có mặt trong Composition
 * — khi rỗng phát ra kèm emptyReason "Nil Known" thay vì bị drop.
 */
const IPS_MANDATORY_SECTIONS: ReadonlyArray<{
  code: string;
  display: string;
  title: string;
  nilText: string;
}> = [
  {
    code: IPS_SECTION_CODES.MEDICATIONS,
    display: 'History of Medication use Narrative',
    title: 'Medications',
    nilText: 'No known medications',
  },
  {
    code: IPS_SECTION_CODES.ALLERGIES,
    display: 'Allergies and adverse reactions Document',
    title: 'Allergies and Intolerances',
    nilText: 'No known allergies',
  },
  {
    code: IPS_SECTION_CODES.PROBLEMS,
    display: 'Problem list - Reported',
    title: 'Problem List',
    nilText: 'No known problems',
  },
];

// ── Narrative helpers ────────────────────────────────────────────────────────

/** Escape các ký tự XML để nhúng an toàn vào XHTML narrative div */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Tạo Narrative XHTML tối thiểu (status=generated) từ nội dung <p> đã escape */
function makeNarrative(innerHtml: string): Narrative {
  return {
    status: 'generated',
    div: `<div xmlns="${XHTML_NS}">${innerHtml}</div>`,
  };
}

/** Lấy LOINC code của section (fallback về coding đầu tiên) */
function sectionLoincCode(code: CodeableConcept): string | undefined {
  const coding = code.coding ?? [];
  const loinc = coding.find((c) => c.system === LOINC_SYSTEM);
  if (loinc && loinc.code) return loinc.code;
  return coding.length > 0 ? coding[0].code : undefined;
}

// ── Nội bộ: theo dõi một section ────────────────────────────────────────────

interface PendingSection {
  title: string;
  code: CodeableConcept;
  resources: Resource[];
  fullUrls: string[];
}

// ── IPSBundleBuilder ─────────────────────────────────────────────────────────

/**
 * Xây dựng FHIR R4 Bundle theo IPS (International Patient Summary) profile.
 *
 * Cách dùng:
 * ```ts
 * const patient = { resourceType: 'Patient', id: 'p1' };
 * const builder = new IPSBundleBuilder(patient);
 * builder.addSection('Allergies', { coding: [{ system: LOINC_SYSTEM, code: '48765-2' }] }, allergyResources);
 * builder.addSection('Medications', { coding: [{ system: LOINC_SYSTEM, code: '10160-0' }] }, medResources);
 * const bundle = builder.build();
 * ```
 */
export class IPSBundleBuilder {
  private readonly pendingSections: PendingSection[] = [];
  /** Tất cả non-Composition entries (Patient trước, rồi clinical resources) */
  private readonly resourceEntries: BundleEntry[] = [];
  /** Map từ resource → fullUrl (để Composition references, tránh duplicate) */
  private readonly resourceFullUrlMap = new Map<Resource, string>();
  private readonly timestamp: string;
  /** fullUrl của Patient — Composition.subject trỏ tới đây */
  private readonly patientFullUrl: string;

  /**
   * @param patient   - Patient resource. BẮT BUỘC — được add vào Bundle và làm
   *                    Composition.subject (qua urn:uuid fullUrl resolve được).
   * @param authorRef - Reference tới author (practitioner/system). Default: FHIRBridge display ref
   */
  constructor(
    private readonly patient: Resource,
    private readonly authorRef?: Reference,
  ) {
    this.timestamp = new Date().toISOString();
    // Patient luôn nằm trong Bundle, subject resolve được (finding ips-builder:176)
    this.patientFullUrl = `urn:uuid:${uuidv4()}`;
    this.resourceFullUrlMap.set(patient, this.patientFullUrl);
    this.resourceEntries.push({ fullUrl: this.patientFullUrl, resource: patient });
  }

  /**
   * Thêm một section vào IPS Bundle.
   *
   * Section rỗng (0 resources) KHÔNG được thêm vào pending. Tuy nhiên ba section
   * bắt buộc (Medications/Allergies/Problems) vẫn luôn được phát ra khi build()
   * — kèm emptyReason "Nil Known" nếu không có dữ liệu (per IPS profile 1..1).
   *
   * @param sectionTitle - Tiêu đề hiển thị của section
   * @param sectionCode  - CodeableConcept (LOINC code theo IPS spec)
   * @param resources    - Danh sách FHIR resources trong section này
   */
  addSection(sectionTitle: string, sectionCode: CodeableConcept, resources: Resource[]): void {
    if (resources.length === 0) {
      // Section rỗng không đi vào pending; mandatory section sẽ được bù ở build().
      return;
    }

    // Gán fullUrl cho mỗi resource, tránh duplicate nếu resource được add nhiều section
    const fullUrls: string[] = [];
    for (const resource of resources) {
      if (!this.resourceFullUrlMap.has(resource)) {
        const fullUrl = `urn:uuid:${uuidv4()}`;
        this.resourceFullUrlMap.set(resource, fullUrl);
        this.resourceEntries.push({ fullUrl, resource });
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      fullUrls.push(this.resourceFullUrlMap.get(resource)!);
    }

    this.pendingSections.push({
      title: sectionTitle,
      code: sectionCode,
      resources,
      fullUrls,
    });
  }

  /**
   * Build Bundle IPS document.
   * Bundle.type = 'document'
   * entry[0] = Composition, entry[1] = Patient, entry[2..] = clinical resources
   */
  build(): Bundle {
    const compositionId = uuidv4();
    const compositionFullUrl = `urn:uuid:${compositionId}`;

    // 1) Sections từ pendingSections (đã có resources) — kèm narrative
    const sections: CompositionSection[] = this.pendingSections.map((ps) => {
      const count = ps.fullUrls.length;
      return {
        title: ps.title,
        code: ps.code,
        text: makeNarrative(
          `<p>${escapeXml(ps.title)}: ${count} entr${count === 1 ? 'y' : 'ies'}.</p>`,
        ),
        entry: ps.fullUrls.map((fullUrl) => ({ reference: fullUrl })),
      };
    });

    // 2) Bù các mandatory section còn thiếu (Medications/Allergies/Problems 1..1)
    const presentCodes = new Set(
      this.pendingSections
        .map((ps) => sectionLoincCode(ps.code))
        .filter((c): c is string => c !== undefined),
    );
    for (const mandatory of IPS_MANDATORY_SECTIONS) {
      if (presentCodes.has(mandatory.code)) continue;
      sections.push({
        title: mandatory.title,
        code: {
          coding: [{ system: LOINC_SYSTEM, code: mandatory.code, display: mandatory.display }],
        },
        text: makeNarrative(`<p>${escapeXml(mandatory.nilText)}.</p>`),
        emptyReason: NIL_KNOWN_EMPTY_REASON,
      });
    }

    const composition: Composition = {
      resourceType: 'Composition',
      id: compositionId,
      meta: { profile: [COMPOSITION_IPS_PROFILE] },
      status: 'final',
      type: {
        coding: [IPS_DOCUMENT_TYPE_CODING],
      },
      // subject trỏ tới Patient entry trong Bundle (resolve được, finding :176)
      subject: { reference: this.patientFullUrl },
      date: this.timestamp,
      author: [this.authorRef ?? { display: 'FHIRBridge Auto-Summary' }],
      title: 'Patient Summary',
      text: makeNarrative(
        `<p>International Patient Summary generated by FHIRBridge on ` +
          `${escapeXml(this.timestamp)}. Contains ${sections.length} section(s).</p>`,
      ),
      section: sections,
    };

    const compositionEntry: BundleEntry = {
      fullUrl: compositionFullUrl,
      resource: composition as Resource,
    };

    return {
      resourceType: 'Bundle',
      id: uuidv4(),
      meta: { profile: [BUNDLE_IPS_PROFILE] },
      // Bundle.identifier bắt buộc cho document bundle (bdl-9)
      identifier: { system: 'urn:ietf:rfc:3986', value: `urn:uuid:${uuidv4()}` },
      type: 'document',
      timestamp: this.timestamp,
      entry: [compositionEntry, ...this.resourceEntries],
    };
  }

  /**
   * Serialize Bundle thành JSON string.
   * Alias tiện lợi cho JSON.stringify + formatting.
   */
  serialize(): string {
    return JSON.stringify(this.build(), null, 2);
  }
}
