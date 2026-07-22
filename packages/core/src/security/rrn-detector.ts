/**
 * RRN detector — phát hiện & che số đăng ký cư dân Hàn Quốc (주민등록번호).
 * PRIVACY CRITICAL (PIPA): RRN không bao giờ được đi qua pipeline dạng raw —
 * PIPA Art. 24-2 cấm xử lý RRN trừ khi luật cho phép cụ thể.
 *
 * Format: YYMMDD-GNNNNNC (13 digits, dấu gạch tùy chọn)
 * - YYMMDD: ngày sinh
 * - G: giới tính + thế kỷ (1-4 công dân 1900s/2000s, 5-8 người nước ngoài)
 * - NNNNN: serial
 * - C: check digit mod-11 (weights 2,3,4,5,6,7,8,9,2,3,4,5)
 *
 * Known limitations (documented, chấp nhận theo plan phase-02):
 * - RRN cấp từ 10/2020 có 6 số cuối ngẫu nhiên (bỏ check digit) → không match
 *   checksum. Checksum vẫn BẮT BUỘC để tránh false positive với số điện thoại /
 *   mã bệnh án 13 chữ số (risk note trong plan). Deidentifier vẫn hash mọi
 *   identifier.value nên RRN mới không leak qua đường identifier.
 * - 외국인등록번호 (foreigner, G=5-8) cấp trước 10/2020 dùng biến thể checksum
 *   (+2 offset) — validator này áp dụng thuật toán chuẩn cho mọi G, một số số
 *   foreigner cũ có thể không match.
 */

/** Chuỗi thay thế khi che RRN — giữ hình dạng để người đọc biết đã bị mask. */
export const RRN_MASK = '######-*******';

/**
 * Candidate pattern: 6 digits + separator tùy chọn (- hoặc space) + 7 digits.
 * Lookaround chặn match giữa chuỗi số dài hơn (số thẻ 16 digits, v.v.).
 */
const RRN_CANDIDATE = /(?<!\d)(\d{6})[-\s]?(\d{7})(?!\d)/g;

/** Trọng số check digit chuẩn cho 12 chữ số đầu. */
const CHECKSUM_WEIGHTS = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5] as const;

/**
 * Validate 13 digits RRN: ngày sinh hợp lệ + gender digit 1-8 + checksum mod-11.
 * Nhận chuỗi đã strip separator (đúng 13 chữ số).
 */
export function isValidRrn(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;

  // Ngày sinh: tháng 01-12, ngày 01-31 (đủ chặt để loại số ngẫu nhiên,
  // không cần chính xác theo từng tháng)
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  // Gender/century digit: 1-8 (9/0 là thế kỷ 1800s — không còn người sống)
  const gender = digits[6]!;
  if (gender < '1' || gender > '8') return false;

  // Check digit mod-11
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * CHECKSUM_WEIGHTS[i]!;
  }
  const expected = (11 - (sum % 11)) % 10;
  return Number(digits[12]) === expected;
}

/**
 * Kiểm tra một chuỗi bất kỳ có chứa RRN hợp lệ (checksum-valid) hay không.
 */
export function containsRrn(text: string): boolean {
  for (const match of text.matchAll(RRN_CANDIDATE)) {
    if (isValidRrn(match[1]! + match[2]!)) return true;
  }
  return false;
}

/**
 * Che mọi RRN hợp lệ trong chuỗi bằng RRN_MASK.
 * Candidate không qua checksum được GIỮ NGUYÊN (tránh phá số điện thoại /
 * mã khác dạng 6-7 digits — risk note trong plan phase-02).
 */
export function maskRrn(text: string): string {
  return text.replace(RRN_CANDIDATE, (full, head: string, tail: string) =>
    isValidRrn(head + tail) ? RRN_MASK : full,
  );
}
