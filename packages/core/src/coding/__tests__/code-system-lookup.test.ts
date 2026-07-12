/**
 * Tests for code-system-lookup: lookupCode, isKnownCode, getCodesForSystem.
 */

import { describe, it, expect } from 'vitest';
import { lookupCode, isKnownCode, getCodesForSystem } from '../code-system-lookup.js';
import { LOINC_SYSTEM, SNOMED_SYSTEM, RXNORM_SYSTEM } from '../code-systems.js';

describe('lookupCode', () => {
  it('returns CodeInfo for a known LOINC code', () => {
    const result = lookupCode(LOINC_SYSTEM, '29463-7');
    expect(result).toBeDefined();
    expect(result!.display).toBe('Body weight');
    expect(result!.system).toBe(LOINC_SYSTEM);
    expect(result!.code).toBe('29463-7');
  });

  it('returns CodeInfo for a known SNOMED code', () => {
    const result = lookupCode(SNOMED_SYSTEM, '44054006');
    expect(result).toBeDefined();
    expect(result!.display).toBe('Diabetes mellitus type 2');
  });

  it('returns CodeInfo for a known RxNorm code', () => {
    // 198440 = Acetaminophen 500 MG (verified via RxNav) — bảng cũ gán nhầm là Metformin
    const result = lookupCode(RXNORM_SYSTEM, '198440');
    expect(result).toBeDefined();
    expect(result!.display).toContain('Acetaminophen');
  });

  it('returns undefined for an unknown code in known system', () => {
    const result = lookupCode(LOINC_SYSTEM, '99999-9');
    expect(result).toBeUndefined();
  });

  it('returns undefined for an entirely unknown system', () => {
    const result = lookupCode('http://example.com/unknown-system', '29463-7');
    expect(result).toBeUndefined();
  });
});

describe('isKnownCode', () => {
  it('returns true for a known LOINC code', () => {
    expect(isKnownCode(LOINC_SYSTEM, '8310-5')).toBe(true);
  });

  it('returns true for a known SNOMED code', () => {
    expect(isKnownCode(SNOMED_SYSTEM, '38341003')).toBe(true);
  });

  it('returns true for a known RxNorm code', () => {
    expect(isKnownCode(RXNORM_SYSTEM, '311702')).toBe(true);
  });

  it('returns false for an unknown code', () => {
    expect(isKnownCode(LOINC_SYSTEM, 'NOT-A-CODE')).toBe(false);
  });

  it('returns false for unknown system', () => {
    expect(isKnownCode('http://unknown.org', '29463-7')).toBe(false);
  });
});

describe('getCodesForSystem', () => {
  it('returns non-empty array for LOINC system', () => {
    const codes = getCodesForSystem(LOINC_SYSTEM);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes[0]).toMatchObject({ system: LOINC_SYSTEM });
  });

  it('returns non-empty array for SNOMED system', () => {
    const codes = getCodesForSystem(SNOMED_SYSTEM);
    expect(codes.length).toBeGreaterThan(0);
  });

  it('returns non-empty array for RxNorm system', () => {
    const codes = getCodesForSystem(RXNORM_SYSTEM);
    expect(codes.length).toBeGreaterThan(0);
  });

  it('returns empty array for unknown system', () => {
    const codes = getCodesForSystem('http://unknown.org');
    expect(codes).toEqual([]);
  });

  it('each code entry has system, code, and display', () => {
    const codes = getCodesForSystem(LOINC_SYSTEM);
    for (const entry of codes) {
      expect(entry.system).toBe(LOINC_SYSTEM);
      expect(typeof entry.code).toBe('string');
      expect(typeof entry.display).toBe('string');
    }
  });
});

// ── Corrected code→display mappings (finding C7) ──────────────────────────────
// Bảng RxNorm cũ gán sai gần như toàn bộ mã. Displays dưới đây xác minh từ RxNav.

describe('RxNorm displays are corrected against authoritative RxNav values', () => {
  it('429503 is hydrochlorothiazide, NOT lisinopril', () => {
    const result = lookupCode(RXNORM_SYSTEM, '429503');
    expect(result!.display.toLowerCase()).toContain('hydrochlorothiazide');
    expect(result!.display.toLowerCase()).not.toContain('lisinopril');
  });

  it('311702 is midazolam, NOT aspirin', () => {
    const result = lookupCode(RXNORM_SYSTEM, '311702');
    expect(result!.display.toLowerCase()).toContain('midazolam');
    expect(result!.display.toLowerCase()).not.toContain('aspirin');
  });

  it('197380 is atenolol, NOT metoprolol', () => {
    const result = lookupCode(RXNORM_SYSTEM, '197380');
    expect(result!.display.toLowerCase()).toContain('atenolol');
    expect(result!.display.toLowerCase()).not.toContain('metoprolol');
  });

  it('1049502 is oxycodone ER, NOT hydrocodone/acetaminophen', () => {
    const result = lookupCode(RXNORM_SYSTEM, '1049502');
    expect(result!.display.toLowerCase()).toContain('oxycodone');
    expect(result!.display.toLowerCase()).not.toContain('hydrocodone');
  });

  it('keeps the two entries that were already correct', () => {
    expect(lookupCode(RXNORM_SYSTEM, '197361')!.display).toContain('Amlodipine');
    expect(lookupCode(RXNORM_SYSTEM, '309362')!.display).toContain('Clopidogrel');
  });
});

// ── SNOMED SCTID Verhoeff check-digit validation (finding C7) ─────────────────
// Mọi SCTID phải vượt qua Verhoeff check. Bảng cũ chứa mã không hợp lệ
// (160303002, 415068001) — test này chặn regression.

/** Verhoeff check-digit validation (standard SNOMED CT SCTID algorithm). */
function isValidSctid(sctid: string): boolean {
  const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
  ];
  if (!/^\d+$/.test(sctid)) return false;
  let c = 0;
  const reversed = sctid.split('').reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = d[c][p[i % 8][parseInt(reversed[i], 10)]];
  }
  return c === 0;
}

describe('SNOMED SCTID Verhoeff integrity', () => {
  it('sanity: Verhoeff accepts a known-valid SCTID and rejects a known-invalid one', () => {
    expect(isValidSctid('44054006')).toBe(true); // Diabetes mellitus type 2
    expect(isValidSctid('160303002')).toBe(false); // removed — invalid check digit
    expect(isValidSctid('415068001')).toBe(false); // removed — invalid check digit
  });

  it('every embedded SNOMED SCTID passes the Verhoeff check', () => {
    const codes = getCodesForSystem(SNOMED_SYSTEM);
    const invalid = codes.filter((c) => !isValidSctid(c.code));
    expect(invalid).toEqual([]);
  });

  it('removed the unverifiable / invalid family-history codes', () => {
    expect(lookupCode(SNOMED_SYSTEM, '160303001')).toBeUndefined();
    expect(lookupCode(SNOMED_SYSTEM, '160303002')).toBeUndefined();
    expect(lookupCode(SNOMED_SYSTEM, '415068001')).toBeUndefined();
  });
});
