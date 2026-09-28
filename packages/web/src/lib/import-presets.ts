/**
 * Ready-made column mappings + matching synthetic sample files from examples/,
 * bundled into the UI so an import can be tried without writing a mapping first.
 * Mappings are embedded as text (sent verbatim to the API); sample files are
 * emitted as static assets and fetched on demand — `no-inline` because Vite would
 * otherwise inline small files as data: URLs, which the CSP (connect-src 'self') blocks.
 */

import vnMapping from '../../../../examples/column-mappings/csv-vneid-vn.json?raw';
import krMapping from '../../../../examples/column-mappings/csv-korea-hospital.json?raw';
import jpMapping from '../../../../examples/column-mappings/excel-japan-clinic.json?raw';
import genericMapping from '../../../../examples/column-mappings/csv-generic-hl7.json?raw';
import vnSampleUrl from '../../../../examples/data/vn-hospital.csv?url&no-inline';
import krSampleUrl from '../../../../examples/data/kr-hospital.csv?url&no-inline';
import jpSampleUrl from '../../../../examples/data/jp-clinic.xlsx?url&no-inline';
import genericSampleUrl from '../../../../examples/data/generic-hl7.csv?url&no-inline';

export type PresetId = 'vn' | 'kr' | 'jp' | 'generic';

export interface ImportPreset {
  id: PresetId;
  /** Key in common.json → import.preset.<id> */
  labelKey: `import.preset.${PresetId}`;
  mapping: string;
  sample: { url: string; name: string; type: string };
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const IMPORT_PRESETS: readonly ImportPreset[] = [
  {
    id: 'vn',
    labelKey: 'import.preset.vn',
    mapping: vnMapping,
    sample: { url: vnSampleUrl, name: 'vn-hospital.csv', type: 'text/csv' },
  },
  {
    id: 'kr',
    labelKey: 'import.preset.kr',
    mapping: krMapping,
    sample: { url: krSampleUrl, name: 'kr-hospital.csv', type: 'text/csv' },
  },
  {
    id: 'jp',
    labelKey: 'import.preset.jp',
    mapping: jpMapping,
    sample: { url: jpSampleUrl, name: 'jp-clinic.xlsx', type: XLSX_TYPE },
  },
  {
    id: 'generic',
    labelKey: 'import.preset.generic',
    mapping: genericMapping,
    sample: { url: genericSampleUrl, name: 'generic-hl7.csv', type: 'text/csv' },
  },
];

/** Pick the preset matching the UI language (vi → VN, ko → KR, ja → JP, else generic). */
export function defaultPresetFor(language: string | undefined): PresetId {
  if (language?.startsWith('vi')) return 'vn';
  if (language?.startsWith('ko')) return 'kr';
  if (language?.startsWith('ja')) return 'jp';
  return 'generic';
}

/** Download a bundled sample file as a File ready for upload. */
export async function loadSampleFile(preset: ImportPreset): Promise<File> {
  const res = await fetch(preset.sample.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], preset.sample.name, { type: preset.sample.type });
}
