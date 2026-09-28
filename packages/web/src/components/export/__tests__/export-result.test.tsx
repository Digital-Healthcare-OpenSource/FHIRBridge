/**
 * Tests for ExportResult component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportResult } from '../export-result';
import type { ExportJob } from '../../../api/export-api';

vi.mock('../../../api/export-api', () => ({
  exportApi: {
    downloadBundle: vi.fn(),
  },
}));

const MOCK_JOB: ExportJob = {
  id: 'job-xyz',
  patientId: 'PATIENT-001',
  status: 'complete',
  progress: 100,
  resourceCount: 42,
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-15T10:05:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExportResult', () => {
  it('renders "Export complete" message', () => {
    render(<ExportResult job={MOCK_JOB} />);
    expect(screen.getByText('Export complete')).toBeInTheDocument();
  });

  it('renders the resource count', () => {
    render(<ExportResult job={MOCK_JOB} />);
    expect(screen.getByText(/42 resource/i)).toBeInTheDocument();
  });

  it('renders the Download FHIR Bundle button', () => {
    render(<ExportResult job={MOCK_JOB} />);
    expect(screen.getByRole('button', { name: /download fhir bundle/i })).toBeInTheDocument();
  });

  it('shows masked patient ID in summary line', () => {
    render(<ExportResult job={MOCK_JOB} />);
    // maskPatientId masks prefix, keeps last segment
    expect(screen.getByText(/patient id/i)).toBeInTheDocument();
  });

  it('download button triggers downloadBundle on click', async () => {
    const { exportApi } = await import('../../../api/export-api');
    const mockDownload = vi.mocked(exportApi.downloadBundle);
    mockDownload.mockResolvedValueOnce(new Blob(['{}']));

    // Mock URL.createObjectURL / revokeObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
    global.URL.revokeObjectURL = vi.fn();

    render(<ExportResult job={MOCK_JOB} />);
    const btn = screen.getByRole('button', { name: /download fhir bundle/i });
    btn.click();

    await vi.waitFor(() => {
      expect(mockDownload).toHaveBeenCalledWith('job-xyz');
    });
  });

  it('omits the date instead of printing "Invalid date" when the job has no timestamps', () => {
    render(<ExportResult job={{ ...MOCK_JOB, createdAt: undefined, updatedAt: undefined }} />);
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
    expect(screen.getByText(/42 resource/i)).toBeInTheDocument();
  });
});
