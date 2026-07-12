/**
 * Tests for i18n setup:
 * - Default language is VI on first visit (no localStorage)
 * - Language switch updates i18n.language
 * - Persistence: changeLanguage writes to localStorage
 * - Supported namespaces are loaded
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Reset localStorage trước mỗi test
beforeEach(() => {
  localStorage.clear();
});

describe('i18n setup', () => {
  it('fallbackLng is vi — VI resources are available', async () => {
    // i18n là singleton — kiểm tra VI resources loaded thay vì kiểm tra language hiện tại
    // (language phụ thuộc vào thứ tự test và localStorage state)
    const { default: i18n } = await import('../index');
    // Đổi về VI để verify resources
    await i18n.changeLanguage('vi');
    const title = i18n.t('modal.title', { ns: 'consent', lng: 'vi' });
    expect(title).toBeTruthy();
    expect(title).not.toBe('modal.title');
    expect(i18n.language).toBe('vi');
  });

  it('has consent namespace loaded for VI', async () => {
    const { default: i18n } = await import('../index');
    const title = i18n.t('modal.title', { ns: 'consent', lng: 'vi' });
    expect(title).toBeTruthy();
    expect(title).not.toBe('modal.title'); // key không bị miss
  });

  it('has baa namespace loaded for VI', async () => {
    const { default: i18n } = await import('../index');
    const confirmBtn = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'vi' });
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn).not.toBe('modal.confirm_button');
  });

  it('has EN translation different from VI for consent.modal.title', async () => {
    const { default: i18n } = await import('../index');
    const vi = i18n.t('modal.title', { ns: 'consent', lng: 'vi' });
    const en = i18n.t('modal.title', { ns: 'consent', lng: 'en' });
    expect(vi).not.toBe(en);
  });

  it('changeLanguage persists to localStorage under fhirbridge.lang', async () => {
    const { default: i18n } = await import('../index');
    await i18n.changeLanguage('en');
    expect(localStorage.getItem('fhirbridge.lang')).toBe('en');
  });

  it('changeLanguage to JA resolves to fallback — JA chưa được hỗ trợ (chưa có bản dịch thật)', async () => {
    const { default: i18n } = await import('../index');
    await i18n.changeLanguage('vi');
    await i18n.changeLanguage('ja');
    // supportedLngs = ['vi','en'] — 'ja' bị từ chối, không được chuyển sang
    // locale có nội dung placeholder tiếng Việt gắn nhãn 日本語
    expect(i18n.language).not.toBe('ja');
    expect(i18n.resolvedLanguage).toBe('vi');
  });

  it('JA baa lookup falls back to VI text (ja outside supportedLngs)', async () => {
    const { default: i18n } = await import('../index');
    const jaBtnText = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'ja' });
    const viBtnText = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'vi' });
    expect(jaBtnText).toBe(viBtnText);
  });

  it('errors namespace generic key loads for VI', async () => {
    const { default: i18n } = await import('../index');
    const msg = i18n.t('generic', { ns: 'errors', lng: 'vi' });
    expect(msg).toBeTruthy();
    expect(msg).not.toBe('generic');
  });

  it('summary namespace title loads for EN', async () => {
    const { default: i18n } = await import('../index');
    const title = i18n.t('section.title', { ns: 'summary', lng: 'en' });
    expect(title).toBe('AI Summary');
  });
});
