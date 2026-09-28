/**
 * footer-section — 4-column landing page footer with navigation links and copyright.
 */

import { Link } from 'react-router-dom';
import { ROUTES } from '../../lib/constants';
import { useTranslation } from '../../i18n/use-translation';

interface FooterLink {
  labelKey:
    | 'footer.features'
    | 'footer.self_host_guide'
    | 'footer.cli'
    | 'footer.rest_api'
    | 'footer.documentation'
    | 'footer.github'
    | 'footer.changelog'
    | 'footer.license'
    | 'footer.security_policy'
    | 'footer.issues';
  href: string;
  external?: boolean;
}

const COLUMNS: Array<{
  headingKey: 'footer.product' | 'footer.resources' | 'footer.legal' | 'footer.connect';
  links: FooterLink[];
}> = [
  {
    headingKey: 'footer.product',
    links: [
      { labelKey: 'footer.features', href: '#features' },
      {
        labelKey: 'footer.self_host_guide',
        href: `${ROUTES.GITHUB}#self-host-deployment`,
        external: true,
      },
      { labelKey: 'footer.cli', href: `${ROUTES.GITHUB}#cli-usage`, external: true },
      { labelKey: 'footer.rest_api', href: `${ROUTES.GITHUB}#api-endpoints`, external: true },
    ],
  },
  {
    headingKey: 'footer.resources',
    links: [
      { labelKey: 'footer.documentation', href: ROUTES.DOCS, external: true },
      { labelKey: 'footer.github', href: ROUTES.GITHUB, external: true },
      { labelKey: 'footer.changelog', href: `${ROUTES.GITHUB}/releases`, external: true },
    ],
  },
  {
    headingKey: 'footer.legal',
    links: [
      { labelKey: 'footer.license', href: `${ROUTES.GITHUB}/blob/main/LICENSE`, external: true },
      {
        labelKey: 'footer.security_policy',
        href: `${ROUTES.GITHUB}/security/policy`,
        external: true,
      },
    ],
  },
  {
    headingKey: 'footer.connect',
    links: [
      { labelKey: 'footer.github', href: ROUTES.GITHUB, external: true },
      { labelKey: 'footer.issues', href: `${ROUTES.GITHUB}/issues`, external: true },
    ],
  },
];

export function FooterSection() {
  const { t } = useTranslation('landing');

  return (
    <footer className="bg-slate-950 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-16 mb-12">
          {/* Brand col */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4" aria-label={t('nav.home_aria')}>
              <span className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white text-sm font-bold">
                F
              </span>
              <span className="text-xl font-bold text-white">
                FHIR<span className="text-teal-500">Bridge</span>
              </span>
            </Link>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">{t('footer.tagline')}</p>
          </div>

          {/* Nav columns */}
          {COLUMNS.map((col) => (
            <div key={col.headingKey}>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
                {t(col.headingKey)}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.labelKey}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="text-sm text-slate-400 hover:text-teal-400 transition-colors"
                    >
                      {t(link.labelKey)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            {t('footer.copyright', { year: new Date().getFullYear() })}
          </p>
          <p className="text-xs text-slate-400">{t('footer.built_with')}</p>
        </div>
      </div>
    </footer>
  );
}
