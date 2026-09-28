/**
 * Tests for i18n setup:
 * - fallbackLng is EN (browser locales outside VI/EN/JA/KO → English)
 * - Detection order: localStorage (fhirbridge.lang) → navigator
 * - Language switch updates i18n.language and <html lang>
 * - Persistence: changeLanguage writes to localStorage
 * - All namespaces are loaded for all 4 locales
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import i18n, { i18nOptions, NAMESPACES, SUPPORTED_LANGUAGES, toSupportedLanguage } from '../index';

// Reset localStorage trước mỗi test
beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

/** Dựng instance mới với cùng options + detector để kiểm tra detect/fallback lúc khởi tạo. */
async function initFreshInstance(navigatorLanguages: string[]) {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(navigatorLanguages);
  vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(navigatorLanguages[0] ?? '');
  const instance = i18next.createInstance();
  await instance.use(LanguageDetector).init({ ...i18nOptions });
  return instance;
}

describe('i18n setup — fallback & detection', () => {
  it('fallbackLng is en (international default)', () => {
    expect(i18n.options.fallbackLng).toEqual(['en']);
  });

  it('keeps supportedLngs to exactly vi / en / ja / ko', () => {
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(['en', 'ja', 'ko', 'vi']);
    const supported = (i18n.options.supportedLngs || []).filter((l) => l !== 'cimode');
    expect([...supported].sort()).toEqual(['en', 'ja', 'ko', 'vi']);
  });

  it('detection order is localStorage → navigator, cached under fhirbridge.lang', () => {
    expect(i18nOptions.detection).toMatchObject({
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'fhirbridge.lang',
    });
  });

  it('unsupported browser language (fr, zh) falls back to English', async () => {
    const fr = await initFreshInstance(['fr-FR', 'fr']);
    expect(fr.resolvedLanguage).toBe('en');
    expect(fr.t('nav.dashboard')).toBe('Dashboard');

    localStorage.clear();
    const zh = await initFreshInstance(['zh-CN', 'zh']);
    expect(zh.resolvedLanguage).toBe('en');
  });

  it('supported regional browser language (ko-KR) resolves to ko', async () => {
    const ko = await initFreshInstance(['ko-KR', 'ko']);
    expect(ko.resolvedLanguage).toBe('ko');
  });

  it('localStorage choice wins over navigator', async () => {
    localStorage.setItem('fhirbridge.lang', 'ja');
    const inst = await initFreshInstance(['vi-VN', 'vi']);
    expect(inst.resolvedLanguage).toBe('ja');
  });

  it('toSupportedLanguage normalises region codes and unsupported locales', () => {
    expect(toSupportedLanguage('vi-VN')).toBe('vi');
    expect(toSupportedLanguage('JA')).toBe('ja');
    expect(toSupportedLanguage('fr')).toBe('en');
    expect(toSupportedLanguage(undefined)).toBe('en');
  });
});

describe('i18n setup — switching', () => {
  it('changeLanguage persists to localStorage under fhirbridge.lang', async () => {
    await i18n.changeLanguage('vi');
    expect(localStorage.getItem('fhirbridge.lang')).toBe('vi');
  });

  it('updates <html lang> on every language change', async () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      await i18n.changeLanguage(lng);
      expect(document.documentElement.lang).toBe(lng);
    }
  });

  it('<html lang> is en for an unsupported language', async () => {
    await i18n.changeLanguage('fr');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('changeLanguage to JA switches — JA đã có bản dịch thật', async () => {
    await i18n.changeLanguage('vi');
    await i18n.changeLanguage('ja');
    expect(i18n.language).toBe('ja');
    expect(i18n.resolvedLanguage).toBe('ja');
  });

  it('changeLanguage to KO switches — KO đã có bản dịch thật', async () => {
    await i18n.changeLanguage('vi');
    await i18n.changeLanguage('ko');
    expect(i18n.language).toBe('ko');
    expect(i18n.resolvedLanguage).toBe('ko');
  });
});

describe('i18n setup — resources', () => {
  it('has consent namespace loaded for VI', () => {
    const title = i18n.t('modal.title', { ns: 'consent', lng: 'vi' });
    expect(title).toBeTruthy();
    expect(title).not.toBe('modal.title'); // key không bị miss
  });

  it('has EN translation different from VI for consent.modal.title', () => {
    const vi = i18n.t('modal.title', { ns: 'consent', lng: 'vi' });
    const en = i18n.t('modal.title', { ns: 'consent', lng: 'en' });
    expect(vi).not.toBe(en);
  });

  it('JA/KO baa text is real translation, không fallback về VI', () => {
    const vi = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'vi' });
    const ja = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'ja' });
    const ko = i18n.t('modal.confirm_button', { ns: 'baa', lng: 'ko' });
    expect(ja).not.toBe(vi);
    expect(ko).not.toBe(vi);
    expect(ja).not.toBe(ko);
  });

  it('JA/KO không còn placeholder tiếng Việt trong consent (nội dung pháp lý)', () => {
    const viTitle = i18n.t('modal.title', { ns: 'consent', lng: 'vi' });
    expect(i18n.t('modal.title', { ns: 'consent', lng: 'ja' })).not.toBe(viTitle);
    expect(i18n.t('modal.title', { ns: 'consent', lng: 'ko' })).not.toBe(viTitle);
  });

  it('registers every namespace, including landing', () => {
    expect([...NAMESPACES].sort()).toEqual(
      ['baa', 'common', 'consent', 'errors', 'landing', 'summary'].sort(),
    );
    expect(i18n.options.ns).toEqual(expect.arrayContaining([...NAMESPACES]));
  });

  it('mọi locale trong SUPPORTED_LANGUAGES đều resolve được mọi namespace', () => {
    const probes: Array<[string, string]> = [
      ['common', 'nav.dashboard'],
      ['consent', 'modal.title'],
      ['baa', 'modal.confirm_button'],
      ['summary', 'section.title'],
      ['errors', 'generic'],
      ['landing', 'hero.title_lead'],
    ];
    for (const lng of SUPPORTED_LANGUAGES) {
      for (const [ns, key] of probes) {
        expect(i18n.exists(key, { ns, lng }), `${lng}/${ns}:${key}`).toBe(true);
        const value = i18n.t(key, { ns, lng });
        expect(value, `${lng}/${ns}:${key}`).toBeTruthy();
        expect(value, `${lng}/${ns}:${key}`).not.toBe(key);
      }
    }
  });

  it('landing copy advertises all 4 languages including Korean', () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      const desc = i18n.t('features.multilang.desc', { ns: 'landing', lng });
      expect(desc, lng).toMatch(/한국어|Korean|tiếng Hàn|韓国語/);
    }
  });

  it('summary namespace title loads for EN', () => {
    expect(i18n.t('section.title', { ns: 'summary', lng: 'en' })).toBe('AI Summary');
  });
});
