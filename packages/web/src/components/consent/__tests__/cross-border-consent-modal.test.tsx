/**
 * Tests for CrossBorderConsentModal — PIPA Art. 28-8: modal phải hiện đủ 5 mục
 * disclosure + decline path hoạt động.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n/index';
import { CrossBorderConsentModal } from '../cross-border-consent-modal';

function renderModal(overrides: Partial<Parameters<typeof CrossBorderConsentModal>[0]> = {}) {
  const onAccept = vi.fn();
  const onDecline = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <CrossBorderConsentModal
        providerName="Claude (Anthropic)"
        onAccept={onAccept}
        onDecline={onDecline}
        open={true}
        {...overrides}
      />
    </I18nextProvider>,
  );
  return { onAccept, onDecline };
}

describe('CrossBorderConsentModal — PIPA 5 mục', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('renders all 5 PIPA disclosure items', () => {
    renderModal();
    // 1. Data transferred
    expect(screen.getByText('Data transferred')).toBeInTheDocument();
    // 2. Destination + transfer method
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(screen.getByText(/TLS-encrypted API call/)).toBeInTheDocument();
    // 3. Recipient + contact
    expect(screen.getByText('AI Provider')).toBeInTheDocument();
    expect(screen.getByText(/Claude \(Anthropic\) — privacy contact/)).toBeInTheDocument();
    // 4. Purpose + retention
    expect(screen.getByText('Purpose of use')).toBeInTheDocument();
    expect(screen.getByText('Retention policy')).toBeInTheDocument();
    // 5. Refusal + consequences
    expect(screen.getByText('Your rights')).toBeInTheDocument();
    expect(screen.getByText(/AI summary will be disabled for this session/)).toBeInTheDocument();
  });

  it('renders 5 items in Korean locale (한국어)', async () => {
    await i18n.changeLanguage('ko');
    renderModal();
    expect(screen.getByText('전송되는 데이터')).toBeInTheDocument();
    expect(screen.getByText('전송 목적지')).toBeInTheDocument();
    expect(screen.getByText('AI 제공업체')).toBeInTheDocument();
    expect(screen.getByText('이용 목적')).toBeInTheDocument();
    expect(screen.getByText('보관 정책')).toBeInTheDocument();
    expect(screen.getByText('귀하의 권리')).toBeInTheDocument();
  });

  it('decline button calls onDecline', () => {
    const { onDecline, onAccept } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('accept button calls onAccept with remember=false by default', () => {
    const { onAccept } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Accept and continue' }));
    expect(onAccept).toHaveBeenCalledWith(false);
  });

  it('renders nothing when open=false', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
