/**
 * Tests for DashboardPage component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../dashboard-page';

// Mock the API modules
vi.mock('../../api/export-api', () => ({
  exportApi: {
    listExports: vi.fn(),
  },
}));

vi.mock('../../api/health-api', () => ({
  healthApi: {
    checkHealth: vi.fn(),
  },
}));

import { exportApi } from '../../api/export-api';
import { healthApi } from '../../api/health-api';

const mockExportApi = vi.mocked(exportApi);
const mockHealthApi = vi.mocked(healthApi);

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExportApi.listExports.mockResolvedValue([]);
  mockHealthApi.checkHealth.mockResolvedValue({
    status: 'ok',
    checkedAt: new Date().toISOString(),
  });
});

describe('DashboardPage', () => {
  it('renders the dashboard title', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('renders the page description', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/recent activity and quick actions/i)).toBeInTheDocument();
    });
  });

  it('renders quick action cards for New Export and Import File', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('New Export')).toBeInTheDocument();
      expect(screen.getByText('Import File')).toBeInTheDocument();
    });
  });

  it('renders the Recent Exports section heading', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Recent Exports')).toBeInTheDocument();
    });
  });

  it('shows empty state when there are no exports', async () => {
    mockExportApi.listExports.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/no exports yet/i)).toBeInTheDocument();
    });
  });

  it('renders export rows when exports are returned', async () => {
    mockExportApi.listExports.mockResolvedValue([
      {
        id: 'job-1',
        patientId: 'PATIENT-001',
        status: 'complete',
        progress: 100,
        resourceCount: 42,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:01:00.000Z',
      },
    ]);

    renderDashboard();

    await waitFor(() => {
      // Masked patient ID
      expect(screen.getByText('****-001')).toBeInTheDocument();
      // Resource count
      expect(screen.getByText('42 resources')).toBeInTheDocument();
      // Status enum → translated label
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });
  });

  it('renders table headers when exports exist', async () => {
    mockExportApi.listExports.mockResolvedValue([
      {
        id: 'job-1',
        patientId: 'P001',
        status: 'complete',
        progress: 100,
        resourceCount: 10,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:01:00.000Z',
      },
    ]);

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getByText('Patient ID')).toBeInTheDocument();
      expect(screen.getByText('Resources')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });
  });

  it('renders health status when API responds', async () => {
    mockHealthApi.checkHealth.mockResolvedValue({
      status: 'ok',
      checkedAt: new Date().toISOString(),
    });
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByText(/api status/i)).toBeInTheDocument();
      // Trạng thái health được dịch ('ok' → 'OK'), không hiển thị enum thô
      expect(screen.getByText('OK')).toBeInTheDocument();
    });
  });

  it('renders Refresh button', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });
  });
});
