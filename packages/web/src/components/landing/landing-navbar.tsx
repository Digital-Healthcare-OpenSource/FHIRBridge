/**
 * landing-navbar — Sticky top navbar for the landing page.
 * Transparent on top, gains blur + background on scroll. Mobile hamburger menu.
 * Có LanguageSwitcher ở cả desktop lẫn menu mobile.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../lib/constants';
import { useTranslation } from '../../i18n/use-translation';
import { LanguageSwitcher } from '../shared/language-switcher';

const NAV_LINKS = [
  { labelKey: 'nav.features', href: '#features', external: false },
  { labelKey: 'nav.self_host', href: '#open-source', external: false },
  { labelKey: 'nav.docs', href: ROUTES.DOCS, external: true },
  { labelKey: 'nav.github', href: ROUTES.GITHUB, external: true },
] as const;

const SWITCHER_SELECT_CLASS =
  'border-slate-300 bg-white/80 text-slate-700 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200';

export function LandingNavbar() {
  const { t } = useTranslation('landing');
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-white/80 dark:bg-slate-950/80 backdrop-blur-md shadow-sm border-b border-slate-200/60 dark:border-slate-800/60'
          : 'bg-transparent'
      }`}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group" aria-label={t('nav.home_aria')}>
          <span className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white text-sm font-bold">
            F
          </span>
          <span className="text-xl font-bold text-slate-900 dark:text-white">
            FHIR<span className="text-teal-600">Bridge</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.labelKey}
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
            >
              {t(link.labelKey)}
            </a>
          ))}
          <LanguageSwitcher selectClassName={SWITCHER_SELECT_CLASS} />
          <Link
            to={ROUTES.DASHBOARD}
            className="ml-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-all hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
          >
            {t('nav.get_started')}
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="md:hidden p-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? t('nav.close_menu') : t('nav.open_menu')}
          aria-expanded={menuOpen}
        >
          {menuOpen ? (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile slide-down panel */}
      {menuOpen && (
        <div className="md:hidden bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 px-4 py-4 flex flex-col gap-4">
          {NAV_LINKS.map((link) => (
            <a
              key={link.labelKey}
              href={link.href}
              {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-teal-600 transition-colors py-1"
              onClick={() => setMenuOpen(false)}
            >
              {t(link.labelKey)}
            </a>
          ))}
          <LanguageSwitcher selectClassName={`w-full py-2 ${SWITCHER_SELECT_CLASS}`} />
          <Link
            to={ROUTES.DASHBOARD}
            className="mt-2 px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold text-center transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500"
            onClick={() => setMenuOpen(false)}
          >
            {t('nav.get_started')}
          </Link>
        </div>
      )}
    </header>
  );
}
