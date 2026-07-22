/**
 * RRN detector tests — checksum validation, edge dates, masking behavior.
 * Mọi RRN trong file này là SYNTHETIC (serial tùy ý, chỉ checksum hợp lệ).
 */

import { describe, it, expect } from 'vitest';
import { isValidRrn, containsRrn, maskRrn, RRN_MASK } from '../rrn-detector.js';

// Synthetic, checksum-valid vectors (mod-11, weights 2..9,2..5):
// 800101-1234560: sum=122 → 122%11=1 → check=(11-1)%10=0
// 900202-2345679: sum=167 → 167%11=2 → check=9
// 800101-5234561: G=5 (foreigner range), sum=154 → 154%11=0 → check=1
const VALID_RRN = '800101-1234560';
const VALID_RRN_2 = '900202-2345679';
const VALID_RRN_FOREIGNER = '800101-5234561';

describe('isValidRrn', () => {
  it('accepts checksum-valid synthetic RRNs', () => {
    expect(isValidRrn('8001011234560')).toBe(true);
    expect(isValidRrn('9002022345679')).toBe(true);
    expect(isValidRrn('8001015234561')).toBe(true);
  });

  it('rejects wrong check digit', () => {
    expect(isValidRrn('8001011234561')).toBe(false);
    expect(isValidRrn('8001011234569')).toBe(false);
  });

  it('rejects impossible birth dates (month 13, day 00, day 32)', () => {
    expect(isValidRrn('8013011234560')).toBe(false);
    expect(isValidRrn('8001001234560')).toBe(false);
    expect(isValidRrn('8001321234560')).toBe(false);
  });

  it('rejects gender/century digit 0 and 9 (thế kỷ 1800s)', () => {
    expect(isValidRrn('8001010234560')).toBe(false);
    expect(isValidRrn('8001019234560')).toBe(false);
  });

  it('rejects non-13-digit input', () => {
    expect(isValidRrn('800101123456')).toBe(false);
    expect(isValidRrn('80010112345601')).toBe(false);
    expect(isValidRrn('800101-1234560')).toBe(false); // separator phải strip trước
    expect(isValidRrn('')).toBe(false);
  });
});

describe('containsRrn', () => {
  it('detects RRN embedded in free text (hyphen, space, no separator)', () => {
    expect(containsRrn(`환자 주민등록번호: ${VALID_RRN} 입원`)).toBe(true);
    expect(containsRrn('id 800101 1234560 end')).toBe(true);
    expect(containsRrn('raw 8001011234560 raw')).toBe(true);
  });

  it('does not flag phone numbers or checksum-invalid candidates', () => {
    expect(containsRrn('phone 010-1234-5678')).toBe(false);
    expect(containsRrn('candidate 800101-1234561 invalid')).toBe(false);
    expect(containsRrn('no digits here')).toBe(false);
  });

  it('does not match inside longer digit runs (thẻ 16 số, mã vạch)', () => {
    expect(containsRrn('4111800101123456012')).toBe(false);
    expect(containsRrn('98001011234560')).toBe(false);
  });
});

describe('maskRrn', () => {
  it('masks every valid RRN, giữ nguyên phần còn lại', () => {
    const input = `A ${VALID_RRN} B ${VALID_RRN_2} C`;
    const masked = maskRrn(input);
    expect(masked).toBe(`A ${RRN_MASK} B ${RRN_MASK} C`);
    expect(masked).not.toContain(VALID_RRN);
    expect(masked).not.toContain(VALID_RRN_2);
  });

  it('masks foreigner-range (G=5-8) RRN with standard checksum', () => {
    expect(maskRrn(VALID_RRN_FOREIGNER)).toBe(RRN_MASK);
  });

  it('leaves checksum-invalid candidates untouched (false-positive guard)', () => {
    expect(maskRrn('order 800101-1234561')).toBe('order 800101-1234561');
    expect(maskRrn('010-1234-5678')).toBe('010-1234-5678');
  });

  it('masks no-separator RRN', () => {
    expect(maskRrn('8001011234560')).toBe(RRN_MASK);
  });
});
