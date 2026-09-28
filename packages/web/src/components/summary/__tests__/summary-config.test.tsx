/**
 * Tests for SummaryConfig component.
 * Giá trị option phải khớp enum server: provider {claude, openai}, language {en, vi, ja, ko}.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import {
  SummaryConfig,
  defaultSummaryLanguage,
  providerLabel,
  type SummaryConfigValue,
} from '../summary-config';

const DEFAULT_CONFIG: SummaryConfigValue = {
  provider: 'claude',
  language: 'en',
  detailLevel: 'standard',
};

function renderConfig(overrides: Partial<Parameters<typeof SummaryConfig>[0]> = {}) {
  const onChange = vi.fn();
  render(<SummaryConfig value={DEFAULT_CONFIG} onChange={onChange} {...overrides} />);
  return { onChange };
}

function optionValues(label: RegExp): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.value);
}

function optionLabels(label: RegExp): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('SummaryConfig', () => {
  it('renders AI Provider selector', () => {
    renderConfig();
    expect(screen.getByLabelText(/ai provider/i)).toBeInTheDocument();
  });

  it('renders Summary language selector', () => {
    renderConfig();
    expect(screen.getByLabelText(/summary language/i)).toBeInTheDocument();
  });

  it('renders Detail level selector', () => {
    renderConfig();
    expect(screen.getByLabelText(/detail level/i)).toBeInTheDocument();
  });

  it('provider values are exactly the server enum (claude, openai)', () => {
    renderConfig();
    expect(optionValues(/ai provider/i)).toEqual(['claude', 'openai']);
    expect(optionLabels(/ai provider/i)).toEqual(['Claude (Anthropic)', 'GPT (OpenAI)']);
  });

  it('language values are exactly the server enum with native labels', () => {
    renderConfig();
    expect(optionValues(/summary language/i)).toEqual(['en', 'vi', 'ja', 'ko']);
    expect(optionLabels(/summary language/i)).toEqual([
      'English',
      'Tiếng Việt',
      '日本語',
      '한국어',
    ]);
  });

  it('detail level values are brief/standard/detailed with translated labels', async () => {
    await i18n.changeLanguage('ko');
    renderConfig();
    expect(optionValues(/상세 수준/)).toEqual(['brief', 'standard', 'detailed']);
    expect(optionLabels(/상세 수준/)).toEqual(['간략', '표준', '상세']);
  });

  it('does not render a model selector (server ignores model)', () => {
    renderConfig();
    expect(screen.queryByLabelText(/model/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
  });

  it('calls onChange when provider changes', () => {
    const { onChange } = renderConfig();
    fireEvent.change(screen.getByLabelText(/ai provider/i), { target: { value: 'openai' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }));
  });

  it('calls onChange when language changes', () => {
    const { onChange } = renderConfig();
    fireEvent.change(screen.getByLabelText(/summary language/i), { target: { value: 'ja' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: 'ja' }));
  });

  it('disables all selects when disabled prop is true', () => {
    renderConfig({ disabled: true });
    const selects = screen.getAllByRole('combobox');
    selects.forEach((select) => expect(select).toBeDisabled());
  });

  it('reflects current provider value', () => {
    renderConfig({ value: { ...DEFAULT_CONFIG, provider: 'openai' } });
    const select = screen.getByLabelText(/ai provider/i) as HTMLSelectElement;
    expect(select.value).toBe('openai');
  });
});

describe('defaultSummaryLanguage', () => {
  it('uses the UI language when the server supports it', () => {
    expect(defaultSummaryLanguage('vi')).toBe('vi');
    expect(defaultSummaryLanguage('ko')).toBe('ko');
  });

  it('falls back to en otherwise', () => {
    expect(defaultSummaryLanguage('fr')).toBe('en');
    expect(defaultSummaryLanguage(undefined)).toBe('en');
  });
});

describe('providerLabel', () => {
  it('maps provider codes to display names', () => {
    expect(providerLabel('claude')).toBe('Claude (Anthropic)');
    expect(providerLabel('openai')).toBe('GPT (OpenAI)');
    expect(providerLabel('other')).toBe('other');
  });
});
