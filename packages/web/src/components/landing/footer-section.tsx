/**
 * footer-section — 4-column landing page footer with navigation links and copyright.
 */

import { Link } from 'react-router-dom';
import { ROUTES } from '../../lib/constants';

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Self-host guide', href: `${ROUTES.GITHUB}#quickstart`, external: true },
      { label: 'CLI', href: ROUTES.GITHUB, external: true },
      { label: 'REST API', href: ROUTES.GITHUB, external: true },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Documentation', href: `${ROUTES.GITHUB}/wiki`, external: true },
      { label: 'GitHub', href: ROUTES.GITHUB, external: true },
      { label: 'Changelog', href: `${ROUTES.GITHUB}/releases`, external: true },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '#' },
      { label: 'Terms of Service', href: '#' },
    ],
  },
  {
    heading: 'Connect',
    links: [
      { label: 'GitHub', href: ROUTES.GITHUB, external: true },
      { label: 'Twitter / X', href: '#', external: true },
    ],
  },
];

export function FooterSection() {
  return (
    <footer className="bg-slate-950 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 lg:gap-16 mb-12">
          {/* Brand col */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4" aria-label="FHIRBridge home">
              <span className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white text-sm font-bold">
                F
              </span>
              <span className="text-xl font-bold text-white">
                FHIR<span className="text-teal-500">Bridge</span>
              </span>
            </Link>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">
              Open standard patient data portability for Vietnam, Japan, and beyond.
            </p>
          </div>

          {/* Nav columns */}
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">
                {col.heading}
              </h4>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {'external' in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-slate-400 hover:text-teal-400 transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <a
                        href={link.href}
                        className="text-sm text-slate-400 hover:text-teal-400 transition-colors"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-400">
            &copy; {new Date().getFullYear()} FHIRBridge. Open source under MIT License.
          </p>
          <p className="text-xs text-slate-400">
            Built with FHIR R4 &middot; HL7 &middot; TypeScript
          </p>
        </div>
      </div>
    </footer>
  );
}
