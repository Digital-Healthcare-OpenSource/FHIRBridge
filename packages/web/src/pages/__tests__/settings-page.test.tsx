/**
 * Tests for SettingsPage component.
 *
 * Credential = FHIRBridge API key (API_KEYS trong .env server) hoặc JWT — không phải
 * key của nhà cung cấp AI. e2e auth helper (tests/e2e/web/helpers/auth.ts) dựa vào:
 * input[type=password] ĐẦU TIÊN, nút /save settings/i và chữ "Saved!" (locale en).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../i18n';
import { SettingsPage } from '../settings-page';

// Mock setAuthToken to avoid side effects between tests
vi.mock('../../api/api-client', () => ({
  setAuthToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

function credentialInput(): HTMLInputElement {
  return screen.getByLabelText(/api key or access token/i) as HTMLInputElement;
}

describe('SettingsPage', () => {
  it('renders the Settings page title', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  it('labels the credential as the FHIRBridge API key / access token', () => {
    render(<SettingsPage />);
    expect(
      screen.getByRole('heading', { name: /fhirbridge api key \/ access token/i }),
    ).toBeInTheDocument();
  });

  it('explains the credential comes from API_KEYS in the server .env (pnpm run setup)', () => {
    const { container } = render(<SettingsPage />);
    const codes = Array.from(container.querySelectorAll('code')).map((c) => c.textContent);
    expect(codes).toEqual(expect.arrayContaining(['API_KEYS', '.env', 'pnpm run setup']));
    expect(screen.getByText(/not an ai provider key/i)).toBeInTheDocument();
    expect(screen.getByText(/kept in memory only/i)).toBeInTheDocument();
  });

  it('does not use the misleading "sk-…" AI provider key placeholder', () => {
    render(<SettingsPage />);
    expect(screen.queryByPlaceholderText(/sk-/i)).not.toBeInTheDocument();
  });

  it('credential input is the first password input on the page', () => {
    const { container } = render(<SettingsPage />);
    const first = container.querySelector('input[type="password"]');
    expect(first).toBe(credentialInput());
  });

  it('show/hide toggle changes input type to text', () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /show api key/i }));
    expect(credentialInput()).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide api key/i })).toBeInTheDocument();
  });

  it('no longer renders the dead provider / summary-language selectors', () => {
    render(<SettingsPage />);
    expect(screen.queryByText(/default ai provider/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /spanish/i })).not.toBeInTheDocument();
  });

  it('renders an interface language selector with all 4 languages', () => {
    render(<SettingsPage />);
    const select = document.getElementById('default-language') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['vi', 'en', 'ja', 'ko']);
  });

  it('changing the interface language switches the UI language', async () => {
    render(<SettingsPage />);
    const select = document.getElementById('default-language') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'ko' } });
    expect(await screen.findByRole('heading', { level: 1, name: '설정' })).toBeInTheDocument();
    expect(i18n.language).toBe('ko');
  });

  it('renders theme toggle button', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('button', { name: /toggle dark mode/i })).toBeInTheDocument();
  });

  it('renders Save Settings button', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('button', { name: /save settings/i })).toBeInTheDocument();
  });

  it('typing in the credential input updates its value', () => {
    render(<SettingsPage />);
    fireEvent.change(credentialInput(), { target: { value: 'test-key-free' } });
    expect(credentialInput().value).toBe('test-key-free');
  });

  it('calls setAuthToken when Save Settings is clicked', async () => {
    const { setAuthToken } = await import('../../api/api-client');
    render(<SettingsPage />);
    fireEvent.change(credentialInput(), { target: { value: 'my-api-key' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    expect(setAuthToken).toHaveBeenCalledWith('my-api-key');
  });

  it('shows Saved! confirmation after saving', async () => {
    vi.useFakeTimers();
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
