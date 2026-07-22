/**
 * Tests for LanguageSwitcher component.
 *
 * - Default renders VI selected
 * - Switch to EN updates i18n.language
 * - Persistence: localStorage written on change
 * - Cả 4 locale thị trường (VI / EN / JA / KO) đều được render
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n/index';
import { LanguageSwitcher } from '../language-switcher';

// Wrapper với I18nextProvider
function renderSwitcher() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LanguageSwitcher />
    </I18nextProvider>,
  );
}

describe('LanguageSwitcher', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('vi');
  });

  it('renders a select element', () => {
    renderSwitcher();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows all 4 market locales: VI, EN, JA, KO', () => {
    renderSwitcher();
    expect(screen.getByRole('option', { name: 'Tiếng Việt' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '日本語' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '한국어' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('selecting KO calls i18n.changeLanguage("ko")', async () => {
    renderSwitcher();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ko' } });
    await waitFor(() => {
      expect(i18n.language).toBe('ko');
    });
  });

  it('VI is selected by default', async () => {
    renderSwitcher();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('vi');
  });

  it('selecting EN calls i18n.changeLanguage("en")', async () => {
    renderSwitcher();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'en' } });
    await waitFor(() => {
      expect(i18n.language).toBe('en');
    });
  });

  it('selecting EN persists to localStorage', async () => {
    renderSwitcher();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'en' } });
    await waitFor(() => {
      expect(localStorage.getItem('fhirbridge.lang')).toBe('en');
    });
  });

  it('has accessible aria-label', () => {
    renderSwitcher();
    const select = screen.getByRole('combobox');
    expect(select).toHaveAttribute('aria-label');
  });
});
