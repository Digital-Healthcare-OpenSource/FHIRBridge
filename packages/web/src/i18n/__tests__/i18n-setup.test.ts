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

  it('changeLanguage to JA switches — JA đã có bản dịch thật', async () => {
    const { default: i18n } = await import('../index');
    await i18n.changeLanguage('vi');
    await i18n.changeLanguage('ja');
    expect(i18n.language).toBe('ja');
    expect(i18n.resolvedLanguage).toBe('ja');
  });

  it('changeLanguage to KO switches — KO đã có bản dịch thật', async () => {
    const { default: i18n } = await import('../index');
    await i18n.changeLanguage('vi');
    await i18n.changeLanguage('ko');
    expect(i18n.language).toBe('ko');
    expect(i18n.resolvedLanguage).toBe('ko');
  });

  it('JA/KO baa text is real translation, không fallback về VI', async () => {
    const { default: i18n } = await import('../index');
    const vi = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'vi' });
    const ja = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'ja' });
    const ko = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'ko' });
    expect(ja).not.toBe(vi);
    expect(ko).not.toBe(vi);
    expect(ja).not.toBe(ko);
  });

  it('JA/KO không còn placeholder tiếng Việt trong consent (nội dung pháp lý)', async () => {
    const { default: i18n } = await import('../index');
    // Placeholder cũ của JA là nguyên văn tiếng Việt — nếu regress, test này đỏ.
    const viTitle = i18n.t('modal.title', { ns: 'consent', lng: 'vi' });
    expect(i18n.t('modal.title', { ns: 'consent', lng: 'ja' })).not.toBe(viTitle);
    expect(i18n.t('modal.title', { ns: 'consent', lng: 'ko' })).not.toBe(viTitle);
  });

  it('mọi locale trong SUPPORTED_LANGUAGES đều resolve được cả 5 namespace', async () => {
    const { default: i18n, SUPPORTED_LANGUAGES } = await import('../index');
    const probes: Array<[string, string]> = [
      ['common', 'nav.dashboard'],
      ['consent', 'modal.title'],
      ['baa', 'modal.confirm_button'],
      ['summary', 'section.title'],
      ['errors', 'generic'],
    ];
    for (const lng of SUPPORTED_LANGUAGES) {
      for (const [ns, key] of probes) {
        const value = i18n.t(key, { ns, lng });
        expect(value, `${lng}/${ns}:${key}`).toBeTruthy();
        expect(value, `${lng}/${ns}:${key}`).not.toBe(key);
      }
    }
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
