/**
 * hero-section — Split hero layout with headline, CTAs, and animated FHIR JSON terminal mockup.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../lib/constants';
import { useTranslation } from '../../i18n/use-translation';
import { SUPPORTED_LANGUAGES } from '../../i18n/index';

// Terminal mockup = output CLI thật → giữ nguyên tiếng Anh (không dịch).

const FHIR_LINES = [
  '$ fhirbridge export --patient P-10291 --format R4',
  '',
  '{',
  '  "resourceType": "Bundle",',
  '  "type": "collection",',
  '  "entry": [',
  '    {',
  '      "resource": {',
  '        "resourceType": "Patient",',
  '        "id": "P-10291",',
  '        "name": [{ "family": "Nguyen", "given": ["An"] }],',
  '        "gender": "male",',
  '        "birthDate": "1985-04-12"',
  '      }',
  '    },',
  '    {',
  '      "resource": {',
  '        "resourceType": "Condition",',
  '        "code": { "text": "Hypertension" },',
  '        "clinicalStatus": "active"',
  '      }',
  '    }',
  '  ]',
  '}',
  '',
  '✓ Exported 8 resources in 1.2s',
];

function TerminalMockup() {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    if (visibleLines >= FHIR_LINES.length) return;
    const delay = visibleLines === 0 ? 600 : visibleLines < 2 ? 80 : 45;
    const t = setTimeout(() => setVisibleLines((v) => v + 1), delay);
    return () => clearTimeout(t);
  }, [visibleLines]);

  return (
    <div className="relative w-full max-w-lg mx-auto lg:mx-0" aria-hidden="true">
      {/* Glow backdrop */}
      <div className="absolute -inset-4 bg-teal-500/10 rounded-2xl blur-2xl" />
      <div className="relative rounded-xl overflow-hidden border border-slate-700 shadow-2xl bg-slate-900">
        {/* Terminal title bar */}
        <div className="flex items-center gap-1.5 px-4 py-3 bg-slate-800 border-b border-slate-700">
          <span className="w-3 h-3 rounded-full bg-red-500/80" />
          <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <span className="w-3 h-3 rounded-full bg-green-500/80" />
          <span className="ml-3 text-xs text-slate-400 font-mono">fhirbridge — bash</span>
        </div>
        {/* Terminal body */}
        <div className="p-4 font-mono text-xs leading-relaxed min-h-[320px] overflow-hidden">
          {FHIR_LINES.slice(0, visibleLines).map((line, i) => {
            const isCommand = line.startsWith('$');
            const isSuccess = line.startsWith('✓');
            const isKey = line.includes('"resourceType"') || line.includes('"type"');
            const isString = !isCommand && !isSuccess && line.includes('"') && !isKey;
            return (
              <div
                key={i}
                className={`${
                  isCommand
                    ? 'text-teal-400'
                    : isSuccess
                      ? 'text-green-400'
                      : isKey
                        ? 'text-blue-300'
                        : isString
                          ? 'text-amber-300'
                          : 'text-slate-300'
                } whitespace-pre`}
              >
                {line || '\u00A0'}
              </div>
            );
          })}
          {visibleLines < FHIR_LINES.length && (
            <span className="inline-block w-2 h-4 bg-teal-400 animate-pulse ml-0.5" />
          )}
        </div>
      </div>
    </div>
  );
}

const STATS = [
  // Resource types có type + validator trong packages/types/src/fhir (README: FHIR R4 Export)
  { value: 15, labelKey: 'hero.stat_resources' },
  // Số ngôn ngữ UI + tóm tắt AI thực tế (VI/EN/JA/KO)
  { value: SUPPORTED_LANGUAGES.length, labelKey: 'hero.stat_languages' },
  { value: 0, labelKey: 'hero.stat_phi' },
] as const;

export function HeroSection() {
  const { t } = useTranslation('landing');
  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden bg-white dark:bg-slate-950">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(#0d9488 1px, transparent 1px), linear-gradient(to right, #0d9488 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      {/* Radial gradient */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
        <div className="grid lg:grid-cols-[60%_40%] gap-12 lg:gap-16 items-center">
          {/* Left: text */}
          <div className="flex flex-col gap-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-sm font-medium w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
              {t('hero.badge')}
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-slate-900 dark:text-white leading-[1.1] tracking-tight">
              {t('hero.title_lead')}{' '}
              <span className="text-teal-600 dark:text-teal-400">{t('hero.title_highlight')}</span>
            </h1>

            <p className="text-lg md:text-xl text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
              {t('hero.subtitle')}
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                to={ROUTES.DASHBOARD}
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-base transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-teal-500/25 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                {t('hero.cta_start')}
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </Link>
              <a
                href={ROUTES.GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl border-2 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-teal-500 dark:hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-400 font-semibold text-base transition-all focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                {t('hero.cta_github')}
              </a>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-6 pt-2">
              {STATS.map((stat, i) => (
                <div key={stat.labelKey} className="flex items-center gap-6">
                  {i > 0 && <div className="w-px h-8 bg-slate-200 dark:bg-slate-800" />}
                  <div className="text-center">
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">
                      {stat.value}
                    </div>
                    <div className="text-xs text-slate-500">{t(stat.labelKey)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: terminal mockup */}
          <div className="lg:flex justify-end">
            <TerminalMockup />
          </div>
        </div>
      </div>
    </section>
  );
}
