/**
 * Tests for format utility functions.
 * test-setup ép UI về 'en' — locale khác truyền tường minh hoặc đổi ngôn ngữ trong test.
 */

import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../../i18n';
import {
  currentLocale,
  formatDate,
  formatFileSize,
  formatNumber,
  maskPatientId,
  formatResourceType,
  formatResourceCount,
  formatStatus,
} from '../format-utils';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('formatDate', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDate('2024-01-15T10:30:00.000Z');
    // Should include the year and month abbreviation
    expect(result).toContain('2024');
    expect(result).toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
  });

  it('returns "Invalid date" for an invalid string', () => {
    expect(formatDate('not-a-date')).toBe('Invalid date');
  });

  it('returns "Invalid date" for an empty string', () => {
    expect(formatDate('')).toBe('Invalid date');
  });

  it('includes day, month, and year', () => {
    const result = formatDate('2023-06-15T12:00:00.000Z');
    expect(result).toContain('2023');
  });

  it('follows the active UI language instead of hardcoded en-US', async () => {
    await i18n.changeLanguage('ja');
    const result = formatDate('2024-01-15T10:30:00.000Z');
    expect(result).toContain('2024年');
    expect(result).not.toMatch(/Jan/);
  });

  it('uses an explicit locale when provided', () => {
    expect(formatDate('2024-01-15T10:30:00.000Z', 'ko')).toContain('2024년');
  });

  it('translates the invalid-date label', () => {
    expect(formatDate('nope', 'vi')).toBe('Ngày không hợp lệ');
  });
});

describe('currentLocale', () => {
  it('returns the active supported language', async () => {
    expect(currentLocale()).toBe('en');
    await i18n.changeLanguage('ko');
    expect(currentLocale()).toBe('ko');
  });
});

describe('formatNumber', () => {
  it('uses locale grouping separators', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
    expect(formatNumber(1234567, 'vi')).toBe('1.234.567');
  });
});

describe('formatFileSize', () => {
  it('formats 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes correctly', () => {
    // parseFloat strips trailing .0, so 512 B not 512.0 B
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('formats kilobytes correctly', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
  });

  it('formats 2.5 KB correctly', () => {
    expect(formatFileSize(2560)).toBe('2.5 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
  });

  it('formats 50 MB', () => {
    expect(formatFileSize(50 * 1024 * 1024)).toBe('50 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('uses the locale decimal separator', () => {
    expect(formatFileSize(2560, 'vi')).toBe('2,5 KB');
  });
});

describe('maskPatientId', () => {
  it('shows last 4 characters with **** prefix', () => {
    expect(maskPatientId('PATIENT-001')).toBe('****-001');
  });

  it('returns **** for IDs of 4 chars or fewer', () => {
    expect(maskPatientId('P001')).toBe('****');
    expect(maskPatientId('ABC')).toBe('****');
    expect(maskPatientId('')).toBe('****');
  });

  it('masks a UUID-style ID correctly', () => {
    const result = maskPatientId('550e8400-e29b-41d4-a716-446655440000');
    expect(result).toBe('****0000');
  });

  it('shows exactly the last 4 chars', () => {
    expect(maskPatientId('12345678')).toBe('****5678');
  });
});

describe('formatResourceType', () => {
  it('capitalizes the first letter', () => {
    expect(formatResourceType('patient')).toBe('Patient');
  });

  it('lowercases the rest', () => {
    expect(formatResourceType('OBSERVATION')).toBe('Observation');
  });

  it('handles empty string', () => {
    expect(formatResourceType('')).toBe('');
  });
});

describe('formatResourceCount', () => {
  it('uses singular label for count of 1 (en)', () => {
    expect(formatResourceCount(1)).toBe('1 resource');
  });

  it('pluralises for other counts (en)', () => {
    expect(formatResourceCount(5)).toBe('5 resources');
    expect(formatResourceCount(0)).toBe('0 resources');
  });

  it('formats large counts with locale separators', () => {
    expect(formatResourceCount(12345)).toBe('12,345 resources');
  });

  it('uses the plural-less form for vi / ja / ko', () => {
    expect(formatResourceCount(1, 'vi')).toBe('1 tài nguyên');
    expect(formatResourceCount(3, 'ja')).toBe('3 件のリソース');
    expect(formatResourceCount(3, 'ko')).toBe('리소스 3개');
  });
});

describe('formatStatus', () => {
  it('converts snake_case to Title Case', () => {
    expect(formatStatus('in_progress')).toBe('In Progress');
  });

  it('handles single word', () => {
    expect(formatStatus('complete')).toBe('Complete');
  });

  it('converts multiple underscores', () => {
    expect(formatStatus('not_yet_started')).toBe('Not Yet Started');
  });

  it('lowercases words after the first letter', () => {
    expect(formatStatus('ERROR_STATE')).toBe('Error State');
  });
});
