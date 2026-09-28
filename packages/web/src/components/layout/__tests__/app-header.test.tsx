/**
 * Tests for AppHeader — translated breadcrumb + mounted LanguageSwitcher.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../../i18n';
import { AppHeader } from '../app-header';

function renderHeader(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader />
    </MemoryRouter>,
  );
}

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

describe('AppHeader', () => {
  it('shows a translated "AI Summary" crumb for /app/summary/:id instead of the raw id', () => {
    renderHeader('/app/summary/exp-8f3a2c');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('AI Summary');
    expect(nav).not.toHaveTextContent('exp-8f3a2c');
  });

  it('translates breadcrumbs to the active language', async () => {
    await i18n.changeLanguage('ja');
    renderHeader('/app/export');
    expect(screen.getByRole('link', { name: 'ダッシュボード' })).toBeInTheDocument();
    expect(screen.getByText('データエクスポート')).toHaveAttribute('aria-current', 'page');
  });

  it('mounts the language switcher with all 4 native labels', () => {
    renderHeader('/app/dashboard');
    const select = screen.getByRole('combobox', { name: 'Language' });
    const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(['Tiếng Việt', 'English', '日本語', '한국어']);
  });

  it('switching language from the header re-renders translated crumbs', async () => {
    renderHeader('/app/settings');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'vi' } });
    expect(await screen.findByText('Cài đặt')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('vi');
  });

  it('settings shortcut has a translated accessible name', async () => {
    await i18n.changeLanguage('ko');
    renderHeader('/app/dashboard');
    expect(screen.getByRole('link', { name: '설정' })).toHaveAttribute('href', '/app/settings');
  });
});
