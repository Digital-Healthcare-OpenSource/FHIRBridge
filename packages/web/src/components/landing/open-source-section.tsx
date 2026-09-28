/**
 * open-source-section — "Built in the open" section with GitHub link and tech stack badges.
 */

import { useScrollAnimation } from '../../hooks/use-scroll-animation';
import { ROUTES } from '../../lib/constants';
import { useTranslation } from '../../i18n/use-translation';

const TECH_STACK = [
  {
    label: 'TypeScript',
    color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  },
  {
    label: 'Node.js',
    color: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  },
  { label: 'React', color: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
  { label: 'Fastify', color: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
  {
    label: 'Tailwind CSS',
    color: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-400',
  },
  {
    label: 'FHIR R4',
    color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  },
  { label: 'Vite', color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
  {
    label: 'pnpm',
    color: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  },
];

export function OpenSourceSection() {
  const { t } = useTranslation('landing');
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section
      id="open-source"
      ref={ref as React.RefObject<HTMLElement>}
      className={`py-20 lg:py-28 bg-white dark:bg-slate-950 transition-all duration-700 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* GitHub icon */}
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-8 h-8 text-slate-800 dark:text-white"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        </div>

        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white mb-4">
          {t('open_source.title')}
        </h2>
        <p className="text-lg text-slate-500 dark:text-slate-400 mb-10 max-w-2xl mx-auto">
          {t('open_source.subtitle')}
        </p>

        {/* Tech stack badges */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {TECH_STACK.map((tech) => (
            <span
              key={tech.label}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${tech.color}`}
            >
              {tech.label}
            </span>
          ))}
        </div>

        <a
          href={ROUTES.GITHUB}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900 font-semibold transition-all hover:scale-[1.02] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          {t('open_source.cta_github')}
        </a>
      </div>
    </section>
  );
}
