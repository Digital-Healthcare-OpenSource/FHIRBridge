/**
 * Tests for SummaryViewerPage.
 * - Cấu hình mặc định: provider 'claude', ngôn ngữ = ngôn ngữ UI (nếu server hỗ trợ)
 * - Lỗi server hiển thị tiêu đề đã dịch + message nguyên văn (503 chưa cấu hình, 502 thất bại)
 * - Poll dừng ở lỗi khác 409
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18n from '../../i18n';
import { ApiError } from '../../api/api-client';
import type * as PageModule from '../summary-viewer-page';

// AI_FEATURE_ENABLED đọc lúc load module → stub env TRƯỚC khi import động
vi.stubEnv('VITE_AI_ENABLED', 'true');

vi.mock('../../api/summary-api', () => ({
  summaryApi: {
    generateSummary: vi.fn(),
    getStatus: vi.fn(),
    downloadMarkdown: vi.fn(),
  },
}));

vi.mock('../../hooks/use-consent', () => ({
  useConsent: () => ({
    hasConsent: true,
    requestConsent: vi.fn().mockResolvedValue(true),
    modalOpen: false,
    handleModalAccept: vi.fn(),
    handleModalDecline: vi.fn(),
  }),
}));

vi.mock('../../hooks/use-baa-acknowledgment', () => ({
  useBaaAcknowledgment: () => ({
    acknowledged: true,
    requestAcknowledgment: vi.fn().mockResolvedValue(true),
    isModalOpen: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }),
}));

vi.mock('../../components/baa', () => ({ BaaDisclaimerModal: () => null }));
vi.mock('../../components/consent', () => ({
  CrossBorderConsentModal: ({ providerName }: { providerName: string }) => (
    <div data-testid="consent-modal" data-provider={providerName} />
  ),
}));

let SummaryViewerPage: typeof PageModule.SummaryViewerPage;

beforeAll(async () => {
  ({ SummaryViewerPage } = await import('../summary-viewer-page'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function api() {
  const { summaryApi } = await import('../../api/summary-api');
  return vi.mocked(summaryApi);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/summary/exp-1']}>
      <Routes>
        <Route path="/app/summary/:id" element={<SummaryViewerPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  vi.useRealTimers();
  await i18n.changeLanguage('en');
});

describe('SummaryViewerPage', () => {
  it('defaults to provider claude and the current UI language', async () => {
    await i18n.changeLanguage('ko');
    renderPage();
    expect((document.getElementById('provider') as HTMLSelectElement).value).toBe('claude');
    expect((document.getElementById('language') as HTMLSelectElement).value).toBe('ko');
    expect(screen.getByTestId('consent-modal')).toHaveAttribute(
      'data-provider',
      'Claude (Anthropic)',
    );
  });

  it('sends server enum codes and no model field', async () => {
    const summaryApi = await api();
    summaryApi.generateSummary.mockResolvedValueOnce({ id: 'sum-1', status: 'processing' });
    summaryApi.getStatus.mockResolvedValue({ id: 'sum-1', status: 'processing' });
    await i18n.changeLanguage('vi');
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Tạo tóm tắt' }));
    await waitFor(() => expect(summaryApi.generateSummary).toHaveBeenCalledTimes(1));
    const req = summaryApi.generateSummary.mock.calls[0]![0];
    expect(req).toEqual({
      exportId: 'exp-1',
      provider: 'claude',
      language: 'vi',
      detailLevel: 'standard',
    });
    expect(req).not.toHaveProperty('model');
  });

  it('503 "not configured" shows a translated heading plus the server message', async () => {
    const summaryApi = await api();
    const serverMsg =
      'AI summaries are not configured on this server: set ANTHROPIC_API_KEY or OPENAI_API_KEY';
    summaryApi.generateSummary.mockRejectedValueOnce(new ApiError(503, serverMsg));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('AI summaries are not configured on this server');
    expect(alert).toHaveTextContent(serverMsg);
    expect(summaryApi.getStatus).not.toHaveBeenCalled();

    // Tiêu đề lỗi đổi theo ngôn ngữ (lưu key, không lưu chuỗi đã dịch)
    await i18n.changeLanguage('ja');
    expect(
      await screen.findByText('このサーバーでは AI 要約が構成されていません'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(serverMsg);
  });

  it('other start failures use the generic "could not start" heading', async () => {
    const summaryApi = await api();
    summaryApi.generateSummary.mockRejectedValueOnce(new ApiError(400, 'body/exportId invalid'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not start summary generation');
    expect(alert).toHaveTextContent('body/exportId invalid');
  });

  it('502 generation failure shows heading + server message and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const summaryApi = await api();
    summaryApi.generateSummary.mockResolvedValueOnce({ id: 'sum-9', status: 'processing' });
    summaryApi.getStatus.mockResolvedValue({
      id: 'sum-9',
      status: 'error',
      error: 'Summary generation failed: provider returned 401',
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Summary generation failed');
    expect(alert).toHaveTextContent('provider returned 401');
    expect(summaryApi.getStatus).toHaveBeenCalledTimes(1);

    // Không poll lại sau lỗi terminal
    await vi.advanceTimersByTimeAsync(10_000);
    expect(summaryApi.getStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /generate summary/i })).toBeEnabled();
  });
});
