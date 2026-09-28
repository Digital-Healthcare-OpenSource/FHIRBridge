/**
 * Tests for ExportProgress component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExportProgress } from '../export-progress';

// Mock the polling hook to control data without real timers
vi.mock('../../../hooks/use-polling', () => ({
  usePolling: vi.fn(),
}));

import { usePolling } from '../../../hooks/use-polling';
const mockUsePolling = vi.mocked(usePolling);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no data yet
  mockUsePolling.mockReturnValue({ data: null, error: null, loading: true });
});

function renderProgress(overrides?: Partial<Parameters<typeof ExportProgress>[0]>) {
  return render(
    <ExportProgress jobId="job-1" onComplete={vi.fn()} onError={vi.fn()} {...overrides} />,
  );
}

describe('ExportProgress', () => {
  it('renders "Progress" label', () => {
    renderProgress();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('shows 0% when no job data yet', () => {
    renderProgress();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders all 5 step labels', () => {
    renderProgress();
    expect(screen.getByText('Connecting to source')).toBeInTheDocument();
    expect(screen.getByText('Fetching patient data')).toBeInTheDocument();
    expect(screen.getByText('Mapping to FHIR R4')).toBeInTheDocument();
    expect(screen.getByText('Creating bundle')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('shows current progress percentage from job data', () => {
    mockUsePolling.mockReturnValue({
      data: {
        id: 'job-1',
        patientId: 'P1',
        status: 'running',
        progress: 50,
        resourceCount: 0,
        createdAt: '',
        updatedAt: '',
      },
      error: null,
      loading: false,
    });
    renderProgress();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('calls onComplete when job status is complete', () => {
    const onComplete = vi.fn();
    const completedJob = {
      id: 'job-1',
      patientId: 'P1',
      status: 'complete' as const,
      progress: 100,
      resourceCount: 42,
      createdAt: '',
      updatedAt: '',
    };
    mockUsePolling.mockReturnValue({ data: completedJob, error: null, loading: false });
    renderProgress({ onComplete });
    expect(onComplete).toHaveBeenCalledWith(completedJob);
  });

  it('calls onError when job status is error', () => {
    const onError = vi.fn();
    mockUsePolling.mockReturnValue({
      data: {
        id: 'job-1',
        patientId: 'P1',
        status: 'error' as const,
        progress: 30,
        resourceCount: 0,
        createdAt: '',
        updatedAt: '',
        error: 'Source unreachable',
      },
      error: null,
      loading: false,
    });
    renderProgress({ onError });
    expect(onError).toHaveBeenCalledWith('Source unreachable');
  });

  it('calls onError when polling itself errors', () => {
    const onError = vi.fn();
    mockUsePolling.mockReturnValue({ data: null, error: 'Network error', loading: false });
    renderProgress({ onError });
    expect(onError).toHaveBeenCalledWith('Network error');
  });

  it('shows error message text when job has error status', () => {
    mockUsePolling.mockReturnValue({
      data: {
        id: 'job-1',
        patientId: 'P1',
        status: 'error' as const,
        progress: 30,
        resourceCount: 0,
        createdAt: '',
        updatedAt: '',
        error: 'Source unreachable',
      },
      error: null,
      loading: false,
    });
    renderProgress();
    expect(screen.getByText('Source unreachable')).toBeInTheDocument();
  });

  it('ticks every step (no spinner) once the export is complete', () => {
    mockUsePolling.mockReturnValue({
      data: { id: 'job-1', status: 'complete' as const, progress: 100, resourceCount: 6 },
      error: null,
      loading: false,
    });
    const { container } = renderProgress();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
