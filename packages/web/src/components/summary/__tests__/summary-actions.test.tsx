/**
 * Tests for SummaryActions component.
 * Server chỉ xuất Markdown — chỉ có một nút tải, không có nút "PDF" gây hiểu nhầm.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryActions } from '../summary-actions';

vi.mock('../../../api/summary-api', () => ({
  summaryApi: {
    downloadMarkdown: vi.fn(),
    downloadPdf: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
  global.URL.revokeObjectURL = vi.fn();
});

describe('SummaryActions', () => {
  it('renders a single Download Markdown button', () => {
    render(<SummaryActions summaryId="sum-1" />);
    expect(screen.getByRole('button', { name: /download markdown/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('does not offer a PDF download (server has no PDF export)', () => {
    render(<SummaryActions summaryId="sum-1" />);
    expect(screen.queryByRole('button', { name: /pdf/i })).not.toBeInTheDocument();
  });

  it('clicking Download Markdown downloads summary-<id>.md', async () => {
    const { summaryApi } = await import('../../../api/summary-api');
    vi.mocked(summaryApi.downloadMarkdown).mockResolvedValueOnce(new Blob(['# md']));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<SummaryActions summaryId="sum-1" />);
    screen.getByRole('button', { name: /download markdown/i }).click();

    await vi.waitFor(() => {
      expect(summaryApi.downloadMarkdown).toHaveBeenCalledWith('sum-1');
      expect(clickSpy).toHaveBeenCalled();
    });
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('summary-sum-1.md');
    expect(summaryApi.downloadPdf).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
