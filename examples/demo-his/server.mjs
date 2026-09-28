#!/usr/bin/env node
/**
 * Demo HIS — a tiny, dependency-free FHIR R4 server with SYNTHETIC patients, so
 * you can try the full export → summary flow without a real hospital system or
 * internet access. Every name, ID and value below is fictional.
 *
 *   node examples/demo-his/server.mjs            # http://127.0.0.1:8090/fhir
 *   pnpm demo                                    # FHIRBridge + this server together
 *
 * Endpoints: GET /fhir/metadata, GET /fhir/Patient, GET /fhir/Patient/:id,
 *            GET /fhir/Patient/:id/$everything
 *
 * Never point FHIRBridge at this in production — it exists for evaluation only.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';

const ICD10 = 'http://hl7.org/fhir/sid/icd-10';
const LOINC = 'http://loinc.org';
const SNOMED = 'http://snomed.info/sct';
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const UCUM = 'http://unitsofmeasure.org';
const IDENTIFIER_SYSTEM = 'https://fhirbridge.example/demo-his/mrn';

/** One synthetic patient per market, each with a few clinical resources. */
const PATIENTS = [
  {
    id: 'demo-vn-001',
    name: { family: 'Nguyễn', given: ['Văn', 'An'] },
    gender: 'male',
    birthDate: '1975-04-12',
    address: { city: 'Hà Nội', country: 'VN' },
    condition: { code: 'I10', display: 'Tăng huyết áp vô căn (nguyên phát)' },
    medication: { code: '17767', display: 'Amlodipine' },
    allergy: { code: '91936005', display: 'Allergy to penicillin' },
    systolic: 148,
    diastolic: 92,
  },
  {
    id: 'demo-kr-001',
    name: { family: '김', given: ['민준'] },
    gender: 'male',
    birthDate: '1982-09-03',
    address: { city: '서울특별시', country: 'KR' },
    condition: { code: 'E11', display: '2형 당뇨병' },
    medication: { code: '6809', display: 'Metformin' },
    allergy: null,
    systolic: 132,
    diastolic: 84,
  },
  {
    id: 'demo-jp-001',
    name: { family: '山田', given: ['花子'] },
    gender: 'female',
    birthDate: '1968-01-25',
    address: { city: '東京都', country: 'JP' },
    condition: { code: 'J45', display: '喘息' },
    medication: { code: '435', display: 'Albuterol' },
    allergy: { code: '300913006', display: 'Shellfish allergy' },
    systolic: 118,
    diastolic: 76,
  },
  {
    id: 'demo-en-001',
    name: { family: 'Doe', given: ['Jane'] },
    gender: 'female',
    birthDate: '1990-06-30',
    address: { city: 'Springfield', country: 'US' },
    condition: { code: 'E78.5', display: 'Hyperlipidemia, unspecified' },
    medication: { code: '36567', display: 'Simvastatin' },
    allergy: null,
    systolic: 121,
    diastolic: 79,
  },
];

function patientResource(p) {
  return {
    resourceType: 'Patient',
    id: p.id,
    meta: { tag: [{ system: 'https://fhirbridge.example/tags', code: 'synthetic' }] },
    identifier: [{ system: IDENTIFIER_SYSTEM, value: p.id.toUpperCase() }],
    name: [{ use: 'official', family: p.name.family, given: p.name.given }],
    gender: p.gender,
    birthDate: p.birthDate,
    address: [{ city: p.address.city, country: p.address.country }],
  };
}

function clinicalResources(p) {
  const subject = { reference: `Patient/${p.id}` };
  const encounter = { reference: `Encounter/${p.id}-enc-1` };
  const date = '2026-03-02T09:30:00+00:00';
  const resources = [
    {
      resourceType: 'Encounter',
      id: `${p.id}-enc-1`,
      status: 'finished',
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: 'AMB',
        display: 'ambulatory',
      },
      subject,
      period: { start: date, end: '2026-03-02T10:00:00+00:00' },
    },
    {
      resourceType: 'Condition',
      id: `${p.id}-cond-1`,
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
          },
        ],
      },
      code: {
        coding: [{ system: ICD10, code: p.condition.code, display: p.condition.display }],
        text: p.condition.display,
      },
      subject,
      encounter,
      onsetDateTime: '2021-05-10',
    },
    {
      resourceType: 'Observation',
      id: `${p.id}-bp-1`,
      status: 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
            },
          ],
        },
      ],
      code: { coding: [{ system: LOINC, code: '85354-9', display: 'Blood pressure panel' }] },
      subject,
      encounter,
      effectiveDateTime: date,
      component: [
        {
          code: { coding: [{ system: LOINC, code: '8480-6', display: 'Systolic blood pressure' }] },
          valueQuantity: { value: p.systolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' },
        },
        {
          code: {
            coding: [{ system: LOINC, code: '8462-4', display: 'Diastolic blood pressure' }],
          },
          valueQuantity: { value: p.diastolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' },
        },
      ],
    },
    {
      resourceType: 'MedicationRequest',
      id: `${p.id}-med-1`,
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: {
        coding: [{ system: RXNORM, code: p.medication.code, display: p.medication.display }],
      },
      subject,
      encounter,
      authoredOn: '2026-03-02',
    },
  ];
  if (p.allergy) {
    resources.push({
      resourceType: 'AllergyIntolerance',
      id: `${p.id}-allergy-1`,
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
            code: 'active',
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
            code: 'confirmed',
          },
        ],
      },
      code: { coding: [{ system: SNOMED, code: p.allergy.code, display: p.allergy.display }] },
      patient: subject,
    });
  }
  return resources;
}

function searchset(baseUrl, resources) {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total: resources.length,
    entry: resources.map((resource) => ({
      fullUrl: `${baseUrl}/${resource.resourceType}/${resource.id}`,
      resource,
      search: { mode: 'match' },
    })),
  };
}

const CAPABILITY_STATEMENT = {
  resourceType: 'CapabilityStatement',
  status: 'active',
  date: '2026-01-01',
  kind: 'instance',
  fhirVersion: '4.0.1',
  format: ['application/fhir+json'],
  software: { name: 'FHIRBridge Demo HIS (synthetic data)' },
  rest: [{ mode: 'server', resource: [{ type: 'Patient' }] }],
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/fhir+json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function operationOutcome(status, text) {
  return {
    resourceType: 'OperationOutcome',
    issue: [
      { severity: 'error', code: status === 404 ? 'not-found' : 'invalid', diagnostics: text },
    ],
  };
}

/** Create (but do not start) the demo HIS server. */
export function createDemoHis() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://demo-his.local');
    const baseUrl = `http://${req.headers.host ?? 'localhost'}/fhir`;
    if (req.method !== 'GET') return send(res, 405, operationOutcome(405, 'Read-only demo'));

    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/fhir/metadata') return send(res, 200, CAPABILITY_STATEMENT);
    if (path === '/fhir/Patient') {
      return send(res, 200, searchset(baseUrl, PATIENTS.map(patientResource)));
    }

    const match = path.match(/^\/fhir\/Patient\/([^/]+)(\/\$everything)?$/);
    const patient = match && PATIENTS.find((p) => p.id === decodeURIComponent(match[1]));
    if (!patient) {
      return send(res, 404, operationOutcome(404, `Unknown resource. Try /fhir/Patient`));
    }
    if (!match[2]) return send(res, 200, patientResource(patient));
    return send(
      res,
      200,
      searchset(baseUrl, [patientResource(patient), ...clinicalResources(patient)]),
    );
  });
}

export const DEMO_PATIENT_IDS = PATIENTS.map((p) => p.id);

// Run directly: node examples/demo-his/server.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.DEMO_HIS_PORT || 8090);
  const host = process.env.DEMO_HIS_HOST || '127.0.0.1'; // 0.0.0.0 inside Docker
  createDemoHis().listen(port, host, () => {
    console.log(`Demo HIS (synthetic data) → http://localhost:${port}/fhir`);
    console.log(`Patient IDs: ${DEMO_PATIENT_IDS.join(', ')}`);
    console.log(`FHIRBridge needs CONNECTOR_ALLOWED_HOSTS=localhost:${port} to reach it.`);
  });
}
