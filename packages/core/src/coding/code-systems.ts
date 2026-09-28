/**
 * FHIR R4 code system URI constants.
 * These are the canonical URIs used to identify terminology systems.
 */

/** LOINC — Logical Observation Identifiers Names and Codes */
export const LOINC_SYSTEM = 'http://loinc.org' as const;

/** SNOMED CT — Systematized Nomenclature of Medicine Clinical Terms */
export const SNOMED_SYSTEM = 'http://snomed.info/sct' as const;

/** RxNorm — normalized drug nomenclature system */
export const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm' as const;

/** ICD-10-CM — International Classification of Diseases, 10th Revision, Clinical Modification */
export const ICD10_CM_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm' as const;

/**
 * ICD-10 — WHO International Classification of Diseases, 10th Revision.
 * Dùng cho mã chẩn đoán VN/KR/JP. Các biến thể quốc gia (KCD-8 Hàn Quốc,
 * ICD-10 bản Bộ Y tế VN, bảng mã bệnh danh Nhật) và JLAC chưa có URI FHIR
 * chính thức được hỗ trợ ở đây — cố ý không tự đặt URI cho chúng.
 */
export const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10' as const;

/** ICD-10-PCS — Procedure Coding System */
export const ICD10_PCS_SYSTEM = 'http://www.cms.gov/Medicare/Coding/ICD10' as const;

/** CPT — Current Procedural Terminology */
export const CPT_SYSTEM = 'http://www.ama-assn.org/go/cpt' as const;

/** HL7 encounter class codes */
export const HL7_ACT_CODE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ActCode' as const;

/** HL7 condition clinical status codes */
export const CONDITION_CLINICAL_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-clinical' as const;

/** HL7 condition verification status codes */
export const CONDITION_VER_STATUS_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-ver-status' as const;

/** HL7 condition category codes (problem-list-item, encounter-diagnosis) */
export const CONDITION_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-category' as const;

/** HL7 v3 NullFlavor (e.g. UNK = unknown) */
export const V3_NULL_FLAVOR_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-NullFlavor' as const;

/** HL7 allergy intolerance clinical status codes */
export const ALLERGY_CLINICAL_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical' as const;

/** HL7 allergy intolerance verification status codes */
export const ALLERGY_VER_STATUS_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification' as const;

/** HL7 observation category codes */
export const OBSERVATION_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/observation-category' as const;

/** Set of all known FHIR terminology system URIs */
export const KNOWN_SYSTEMS = new Set([
  LOINC_SYSTEM,
  SNOMED_SYSTEM,
  RXNORM_SYSTEM,
  ICD10_SYSTEM,
  ICD10_CM_SYSTEM,
  ICD10_PCS_SYSTEM,
  CPT_SYSTEM,
  HL7_ACT_CODE_SYSTEM,
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VER_STATUS_SYSTEM,
  CONDITION_CATEGORY_SYSTEM,
  V3_NULL_FLAVOR_SYSTEM,
  ALLERGY_CLINICAL_SYSTEM,
  ALLERGY_VER_STATUS_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
]);
