# Examples

Drop-in starter assets for self-host operators: column mappings for CSV / Excel
imports, and small **synthetic** sample files that match them exactly.

## Column-mapping configs

`column-mappings/` — JSON files that map an HIS export's column names onto FHIR R4
fields. Pick the one closest to your HIS, then edit the column names to match your
actual export. Every file is validated against
[`column-mappings/mapping.schema.json`](column-mappings/mapping.schema.json)
(editors such as VS Code pick it up through the `"$schema": "./mapping.schema.json"`
line).

| Mapping                                                                            | Sample data                                  | Source                                                                                 |
| ---------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| [column-mappings/csv-vneid-vn.json](column-mappings/csv-vneid-vn.json)             | [data/vn-hospital.csv](data/vn-hospital.csv) | Vietnamese hospital CSV, one row per encounter, citizen ID (CCCD/VNeID), ICD-10, LOINC |
| [column-mappings/csv-korea-hospital.json](column-mappings/csv-korea-hospital.json) | [data/kr-hospital.csv](data/kr-hospital.csv) | Korean hospital CSV, one row per encounter, RRN (주민등록번호), KCD/ICD-10, LOINC      |
| [column-mappings/csv-generic-hl7.json](column-mappings/csv-generic-hl7.json)       | [data/generic-hl7.csv](data/generic-hl7.csv) | Generic HL7-flavored CSV with `MRN`, `DOB`, `ICD10`, `LOINC` columns                   |
| [column-mappings/excel-japan-clinic.json](column-mappings/excel-japan-clinic.json) | [data/jp-clinic.xlsx](data/jp-clinic.xlsx)   | Japanese clinic `.xlsx` with two sheets: 患者 (patients) and 受診 (visits)             |

All names, IDs and RRNs in `data/` are fictitious placeholders (Nguyễn Văn A, 홍길동,
山田太郎, John Doe…). The Korean RRNs are checksum-valid on purpose so that the RRN
protection is exercised — they belong to no one. `data/jp-clinic.xlsx` is generated
by `node examples/data/generate-jp-clinic-xlsx.cjs`.

### Identifier systems (`patientId.system`)

`Patient.identifier.system` tells a receiving system _which_ numbering a patient ID belongs to.
The examples use the published national conventions where one exists:

| Country | `system` used in the example                                                   | Source                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vietnam | `http://fhir.ehealth.gov.vn/core/sid/national_id` (CCCD)                       | HL7 Vietnam VN Core IG — status **draft**, publisher Cục Công nghệ thông tin – Bộ Y tế ([NamingSystem SID-National-Id](https://github.com/hl7vn/vn-core-ig/blob/main/input/resources/NamingSystem.sid-national-id.xml)). The same IG defines `…/sid/insurance_number` (BHYT) and `…/sid/patient-internal-id` (hospital patient number). |
| Japan   | `urn:oid:1.2.392.100495.20.3.51.` + `1` + the clinic's 10-digit 医療機関コード | JP Core [JP_Patient](https://github.com/jami-fhir-jp-wg/jp-core-v1x/blob/main/input/fsh/profiles/JP_Patient.fsh). The example uses JP Core's own example code `1312345670` → `urn:oid:1.2.392.100495.20.3.51.11312345670`; **replace it with your clinic's code**.                                                                      |
| Korea   | placeholder `https://fhirbridge.example/identifiers/kr-hospital-mrn`           | KR Core [KRCore_Patient](https://github.com/hl7korea/krocre/blob/main/input/fsh/profiles/KRCore_Patient.fsh) requires `identifier.system` but defines no URI for a hospital patient number — use your hospital's own URI.                                                                                                               |

### File types: `.csv` and `.xlsx` only

Legacy Excel `.xls` (BIFF) files are rejected with a clear message. Open them in Excel or
LibreOffice Calc and save as `.xlsx` (Excel Workbook) first. FHIRBridge does not bundle an `.xls`
reader on purpose: the only JavaScript one, SheetJS `xlsx`, is frozen at 0.18.5 on npm with two
high-severity advisories for exactly this use — reading untrusted files
([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6),
[GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)); fixed builds are only
published outside the npm registry, which hospital mirrors and offline installs cannot reach.

## Running the examples

### CLI

From the repo root, after `pnpm install && pnpm build`:

```bash
pnpm fhirbridge import --file examples/data/vn-hospital.csv --mapping examples/column-mappings/csv-vneid-vn.json --output vn.bundle.json
pnpm fhirbridge import --file examples/data/kr-hospital.csv --mapping examples/column-mappings/csv-korea-hospital.json --output kr.bundle.json
pnpm fhirbridge import --file examples/data/generic-hl7.csv --mapping examples/column-mappings/csv-generic-hl7.json --output generic.bundle.json
pnpm fhirbridge import --file examples/data/jp-clinic.xlsx --mapping examples/column-mappings/excel-japan-clinic.json --output jp.bundle.json

# check the result with the repo's validators
pnpm fhirbridge validate --input vn.bundle.json
```

Options: `--format ndjson` (one resource per line), `--sheet <name>` (Excel: read every
resource type from that sheet, overriding the mapping), and no `--output` writes the
bundle to stdout (status lines go to stderr, so `> bundle.json` works).
Set `HMAC_SECRET` (the API reads it from `.env`; for the CLI export it in your shell) to HMAC-hash Korean RRNs instead of masking them.
`--mapping` is required; the command exits non-zero on an invalid mapping, when the
file's header matches none of the mapped columns, or when no resource is produced.

### API

The server expects a multipart upload: the data file in the part named `file`, the
mapping in the part named `mapping` — as a file part (`@`) or as a text field (`<`):

```bash
curl -sS -X POST http://localhost:3001/api/v1/connectors/import \
  -H "X-API-Key: $API_KEY" \
  -F "file=@examples/data/vn-hospital.csv" \
  -F "mapping=@examples/column-mappings/csv-vneid-vn.json"

curl -sS -X POST http://localhost:3001/api/v1/connectors/import \
  -H "X-API-Key: $API_KEY" \
  -F "file=@examples/data/jp-clinic.xlsx" \
  -F "mapping=<examples/column-mappings/excel-japan-clinic.json"
```

An optional text field `sheet` overrides the Excel sheet. The response is
`{ message, resourceCount, resourcesByType, rowsRead, warnings, warningCount, bundle }`.
Errors: `400` when no mapping is sent (the message points here), when the mapping is
invalid (`message` + `issues` list every problem) or the file content does not match
its type; `422` when the file's header matches none of the mapped columns or no
resource could be produced; `413` above the upload / 10,000-resource limits. The API
hashes RRNs with its `HMAC_SECRET`.

## Mapping format

```json
{
  "$schema": "./mapping.schema.json",
  "description": "free text",
  "patientId": { "column": "MRN", "system": "urn:oid:2.16.840.1.113883.19.5" },
  "timezone": "+07:00",
  "sheet": { "Patient": "Patients", "Encounter": "Visits" },
  "resourceTypes": ["Patient", "Encounter"],
  "fields": {
    "Patient.name.family": "LAST_NAME",
    "Patient.gender": { "column": "SEX", "transform": "lowercase", "valueMap": { "M": "male" } },
    "Encounter.period.start": {
      "column": "VISIT",
      "transform": "datetime",
      "format": "DD/MM/YYYY HH:mm"
    },
    "Encounter.class.code": { "column": "KIND", "valueMap": { "OPD": "AMB", "IPD": "IMP" } }
  }
}
```

**Top-level keys**

| Key             | Meaning                                                                                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`        | Required. `"<ResourceType>.<path>"` → column name, column spec, or literal (below).                                                                                                                                                                                                       |
| `patientId`     | Column (or `{column, system}`) that identifies the patient on every row. Its value becomes `Patient.identifier` (with `system`), deduplicates Patients across rows and links the other resources to them. Rows where it is empty are skipped. Without it every row is a separate patient. |
| `resourceTypes` | Types produced per row, in output order. Supported: `Patient`, `Encounter`, `Condition`, `Observation`, `Procedure`, `AllergyIntolerance`. Defaults to the types used in `fields`.                                                                                                        |
| `timezone`      | UTC offset (`"+07:00"`, `"+09:00"`, `"-05:00"`, `"Z"`) for datetimes that have a time but no offset. FHIR requires an offset whenever a time is present, so **without `timezone` such values are emitted as dates only** (with one warning per field). IANA names are not supported.      |
| `sheet`         | Excel only: one sheet name for all types, or `{ "<ResourceType>": "<sheet>" }` for every entry in `resourceTypes`. The Patient sheet is read first; rows on other sheets are linked to patients through the `patientId` column. Default: first sheet.                                     |
| `description`   | Free text. Keys starting with `$` (`$schema`, `$comment`) are ignored.                                                                                                                                                                                                                    |

**Paths.** Dotted FHIR paths below the resource. Repeating elements take `[]` or `[n]`;
without an index the first item is used, so `Patient.name.family` =
`Patient.name[0].family` and `Patient.name.given` → `"given": ["…"]`. All `[]` keys
of one element share one item (`telecom[].system` + `telecom[].value` → one
ContactPoint). Paths are checked against the FHIR R4 elements the importer supports
and typos are reported with the list of valid elements. Resource ids, `subject`,
`encounter` and `AllergyIntolerance.patient` are set by the importer and cannot be mapped.

**Field values**

- `"COLUMN"` — copy the column.
- `{ "column": "COLUMN", "valueMap": {…}, "transform": "…", "format": "…" }` — per cell:
  trim → `valueMap` lookup (exact, then case-insensitive; unmapped values pass through)
  → `transform` → conversion to the element's FHIR type.
- `{ "literal": value }` — a constant. It is emitted only when its element (the nearest
  `[]` item, else the top-level element) also received a column value in that row: a
  `coding[].system` literal appears only when `coding[].code` has a value, an
  `address.country` literal only when some address column is filled. Top-level
  literals such as `"Observation.status": { "literal": "preliminary" }` are always kept.

| `transform` | Result                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `lowercase` | text lowercased (after `valueMap`)                                                                                        |
| `uppercase` | text uppercased                                                                                                           |
| `trim`      | text with surrounding whitespace removed                                                                                  |
| `number`    | strict decimal (`142`, `-7.1`, `1e3`; `1,234` / `37,5` are rejected)                                                      |
| `date`      | FHIR `date` (`YYYY-MM-DD`); `format` tokens below, or auto-detected: `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYYMMDD`, `DD/MM/YYYY` |
| `datetime`  | FHIR `dateTime` `YYYY-MM-DDThh:mm:ss±hh:mm` (offset from the value's `Z` token, else `timezone`)                          |

`format` tokens: `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, `Z` (UTC offset in the value,
`Z`/`+07:00`/`+0700`); everything else is literal, e.g. `DD/MM/YYYY HH:mm`,
`YYYY-MM-DDTHH:mm:ssZ`. Real Excel date cells are read as dates whatever the format.
Even without a `transform`, values are converted to the element's type: `valueQuantity.value`
becomes a number, `birthDate` is normalized, booleans accept `true/false/yes/no/1/0`.
Codes with a FHIR-required value set (`Patient.gender`, `telecom.system`, statuses…)
that are not valid are dropped with a warning — map them with `valueMap`.

**Rows → resources**

- **Patient** — created on the first row of each `patientId` (that row's Patient columns win).
- **Other types** — created only when at least one of their own mapped columns has a
  value in the row. A column mapped by several types (e.g. a visit date used for both
  `Encounter.period.start` and `Observation.effectiveDateTime`) creates the Encounter
  but never, on its own, a Condition/Observation.
- **References** — `Encounter/Condition/Observation/Procedure.subject` and
  `AllergyIntolerance.patient` → the row's Patient; `Condition/Observation/…encounter`
  → the Encounter created from the same row.
- **Defaults** (unless mapped) — `Encounter.status` `finished`, `Encounter.class.system`
  v3-ActCode (no class code → v3-NullFlavor `UNK`), `Observation.status` `final`,
  `Procedure.status` `completed`, `Condition.clinicalStatus` / `AllergyIntolerance.clinicalStatus`
  `active` (HL7 systems), `Condition.category` `encounter-diagnosis` when the row has an Encounter.
- **Ids** — deterministic UUIDs derived from the file's SHA-256 and the row / patient
  order (never from identifier values); `fullUrl` = `urn:uuid:<id>`, references use it.
- **Validation** — every resource is checked with the repo's validators; invalid ones
  (e.g. a Patient without a family name, an Observation without a code) are dropped
  and reported, together with the resources of a dropped Patient.

**Privacy.** Korean RRNs (주민등록번호) found in any cell are HMAC-hashed in
identifiers when a secret is configured and masked (`######-*******`) otherwise — a
raw RRN never reaches the output. Vietnamese citizen IDs (CCCD/VNeID) are regular
identifiers and are written as-is. Warnings and errors name rows and columns but
never contain cell values.

**Legacy formats** are still accepted and converted (the CLI prints a notice, the API
returns `mappingNotices`): `{ "mappings": [{ sourceColumn, fhirPath, resourceType,
transform, codeSystem, valueMappings }] }`, the same list under `"columns"` or as a
bare array, and the flat `{ "<column>": "<fhirPath>" }` form (unprefixed paths use
the CLI's `--resource-type`, default `Patient`). A `fhirPath` of `id` becomes
`patientId`.

## Synthetic test data

`tests/fixtures/synthea/` (in the test tree, not here) ships pre-generated synthetic FHIR Bundles that exercise every supported resource type. They contain no real PHI. Use them to smoke-test an end-to-end export → summary flow without touching a real HIS.

## Contributing examples

If your HIS export differs from these and you want others to benefit, open a PR adding a new `column-mappings/<vendor>.json` file (with `"$schema": "./mapping.schema.json"`) and a matching synthetic sample in `data/`. Anonymize column names in your sample so the file does not leak vendor-specific schema details that you do not own. See [CONTRIBUTING.md](../CONTRIBUTING.md).
