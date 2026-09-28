/**
 * Locale parity — mọi namespace của vi / ja / ko phải có ĐÚNG bộ key như en
 * (key phẳng, kể cả phần tử mảng) và cùng {{placeholder}} / <tag> ở mỗi key.
 * Drift (thiếu key, thừa key, lệch placeholder) → CI đỏ.
 *
 * Plural: i18next chọn hậu tố theo Intl.PluralRules của từng ngôn ngữ — en cần
 * `_one` + `_other`, còn vi / ja / ko chỉ có `_other`. Test so theo key gốc (bỏ
 * hậu tố plural) và yêu cầu locale nào cũng có dạng `_other`.
 */

import { describe, it, expect } from 'vitest';
import { NAMESPACES, SUPPORTED_LANGUAGES } from '../index';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// Tự thu thập mọi file locale — namespace mới thêm vào cũng được kiểm tra
const files = import.meta.glob<{ default: Json }>('../locales/*/*.json', { eager: true });

const REFERENCE = 'en';
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** { lng: { ns: json } } */
const bundles: Record<string, Record<string, Json>> = {};
for (const [path, mod] of Object.entries(files)) {
  const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const [, lng, ns] = match as unknown as [string, string, string];
  (bundles[lng] ??= {})[ns] = mod.default;
}

function flatten(value: Json, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      flatten(v as Json, prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, String(value));
  }
  return out;
}

/** Placeholder {{name, format}} và tag <code>/<0> — so sánh dạng đã chuẩn hoá. */
function tokens(text: string): string[] {
  const placeholders = (text.match(/{{[^}]+}}/g) ?? []).map((p) => p.replace(/\s+/g, ''));
  const tags = text.match(/<\/?[a-zA-Z0-9]+\s*\/?>/g) ?? [];
  return [...placeholders, ...tags].sort();
}

/** Gom key plural về key gốc; giá trị = hợp các token của mọi dạng plural. */
function normalise(flat: Map<string, string>) {
  const keys = new Map<string, { forms: Set<string>; tokens: Set<string> }>();
  for (const [key, text] of flat) {
    const base = key.replace(PLURAL_SUFFIX, '');
    const form = PLURAL_SUFFIX.exec(key)?.[1] ?? '';
    const entry = keys.get(base) ?? { forms: new Set<string>(), tokens: new Set<string>() };
    entry.forms.add(form);
    tokens(text).forEach((tk) => entry.tokens.add(tk));
    keys.set(base, entry);
  }
  return keys;
}

describe('locale parity', () => {
  it('every supported language has a locale folder and vice versa', () => {
    expect(Object.keys(bundles).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('every language ships exactly the registered namespaces', () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      expect(Object.keys(bundles[lng] ?? {}).sort(), lng).toEqual([...NAMESPACES].sort());
    }
  });

  for (const ns of NAMESPACES) {
    describe(`namespace "${ns}"`, () => {
      const ref = normalise(flatten(bundles[REFERENCE]?.[ns] ?? {}));

      it(`${REFERENCE} reference has no empty strings`, () => {
        const empty = [...flatten(bundles[REFERENCE]?.[ns] ?? {})]
          .filter(([, v]) => v.trim() === '')
          .map(([k]) => k);
        expect(empty).toEqual([]);
      });

      for (const lng of SUPPORTED_LANGUAGES.filter((l) => l !== REFERENCE)) {
        it(`${lng} has the same keys as ${REFERENCE}`, () => {
          const flat = flatten(bundles[lng]?.[ns] ?? {});
          const cur = normalise(flat);
          const missing = [...ref.keys()].filter((k) => !cur.has(k));
          const extra = [...cur.keys()].filter((k) => !ref.has(k));
          expect({ missing, extra }).toEqual({ missing: [], extra: [] });

          const empty = [...flat].filter(([, v]) => v.trim() === '').map(([k]) => k);
          expect(empty, `${lng}/${ns} empty values`).toEqual([]);
        });

        it(`${lng} uses the same {{placeholders}} and <tags> as ${REFERENCE}`, () => {
          const cur = normalise(flatten(bundles[lng]?.[ns] ?? {}));
          const mismatched: string[] = [];
          for (const [key, entry] of ref) {
            const other = cur.get(key);
            if (!other) continue; // báo ở test key parity
            const a = [...entry.tokens].sort().join(' ');
            const b = [...other.tokens].sort().join(' ');
            if (a !== b) mismatched.push(`${key}: ${REFERENCE}[${a}] ≠ ${lng}[${b}]`);
          }
          expect(mismatched).toEqual([]);
        });

        it(`${lng} plural keys include the _other form`, () => {
          const cur = normalise(flatten(bundles[lng]?.[ns] ?? {}));
          const pluralBases = [...ref].filter(([, e]) => !e.forms.has('')).map(([k]) => k);
          const missingOther = pluralBases.filter((k) => !cur.get(k)?.forms.has('other'));
          expect(missingOther).toEqual([]);
        });
      }
    });
  }
});
