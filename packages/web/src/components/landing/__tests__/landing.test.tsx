/**
 * Tests for the public landing page — i18n, language switcher, links.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../../i18n';
import { LandingPage } from '../../../pages/landing-page';
import { LandingNavbar } from '../landing-navbar';
import { ROUTES } from '../../../lib/constants';

const REPO = 'https://github.com/Digital-Healthcare-OpenSource/FHIRBridge';

beforeAll(() => {
  // jsdom không có IntersectionObserver (useScrollAnimation)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

function renderInRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('LandingNavbar', () => {
  it('mounts the language switcher on desktop with all 4 languages', () => {
    renderInRouter(<LandingNavbar />);
    const selects = screen.getAllByRole('combobox', { name: 'Language' });
    expect(selects).toHaveLength(1);
    const labels = Array.from((selects[0] as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toEqual(['Tiếng Việt', 'English', '日本語', '한국어']);
  });

  it('also offers the language switcher inside the mobile menu', () => {
    renderInRouter(<LandingNavbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getAllByRole('combobox', { name: 'Language' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('Docs points at the README and GitHub at the org repo (no wiki, no old URL)', () => {
    renderInRouter(<LandingNavbar />);
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', `${REPO}#readme`);
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', REPO);
    expect(ROUTES.GITHUB).toBe(REPO);
  });

  it('switching language translates the navbar', async () => {
    renderInRouter(<LandingNavbar />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ko' } });
    expect(await screen.findByRole('link', { name: '시작하기' })).toBeInTheDocument();
  });
});

describe('LandingPage', () => {
  it('advertises 4 languages (VI/EN/JA/KO), not 3', () => {
    renderInRouter(<LandingPage />);
    const label = screen.getByText('Languages');
    expect(label.previousElementSibling).toHaveTextContent('4');
    expect(screen.getByText(/Korean \(한국어\)/)).toBeInTheDocument();
    expect(screen.getByText(/English, Vietnamese, Japanese, or Korean/)).toBeInTheDocument();
  });

  it('renders translated copy in Vietnamese', async () => {
    await i18n.changeLanguage('vi');
    renderInRouter(<LandingPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /Dữ liệu y tế của bạn/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Bảo mật & Tuân thủ')).toBeInTheDocument();
  });

  it('renders translated copy in Japanese and Korean', async () => {
    await i18n.changeLanguage('ja');
    const { unmount } = renderInRouter(<LandingPage />);
    expect(screen.getByRole('heading', { level: 2, name: /臨床現場のために設計/ })).toBeTruthy();
    unmount();

    await i18n.changeLanguage('ko');
    renderInRouter(<LandingPage />);
    expect(screen.getByRole('heading', { level: 2, name: /임상 환경을 위한 설계/ })).toBeTruthy();
  });

  it('has an #open-source anchor for the Self-host nav link', () => {
    const { container } = renderInRouter(<LandingPage />);
    expect(container.querySelector('#open-source')).not.toBeNull();
    expect(container.querySelector('#features')).not.toBeNull();
  });

  it('footer links point at the org repo and the copyright year is interpolated', () => {
    renderInRouter(<LandingPage />);
    const footer = screen.getByRole('contentinfo');
    const hrefs = within(footer)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('tranhoangtu-it') || h.includes('/wiki'))).toBe(false);
    expect(within(footer).getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      `${REPO}#readme`,
    );
    expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} FHIRBridge`);
  });

  it('does not use the Outfit web font anywhere', () => {
    const { container } = renderInRouter(<LandingPage />);
    expect(container.innerHTML).not.toMatch(/Outfit/);
  });
});
