/**
 * Tests for ImportPage component.
 *
 * Server /connectors/import xử lý đồng bộ → UI một bước: upload → importing →
 * done/error. Không có preview/column-mapping stage (xem import-page.tsx).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportPage } from '../import-page';

// Mock API
vi.mock('../../api/connector-api', () => ({
  connectorApi: {
    importFile: vi.fn(),
  },
}));

// Mock FileDropzone — captures onFilesAccepted for interaction tests
vi.mock('../../components/import/file-dropzone', () => ({
  FileDropzone: ({
    onFilesAccepted,
    selectedFile,
    onClearFile,
  }: {
    onFilesAccepted: (f: File[]) => void;
    selectedFile?: File | null;
    onClearFile?: () => void;
  }) => (
    <div data-testid="file-dropzone">
      <span>{selectedFile ? selectedFile.name : 'Drop files here'}</span>
      <button type="button" onClick={() => onFilesAccepted([new File(['csv'], 'data.csv')])}>
        Accept File
      </button>
      {onClearFile && (
        <button type="button" onClick={onClearFile}>
          Clear
        </button>
      )}
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImportPage', () => {
  it('renders page title "Import File"', () => {
    render(<ImportPage />);
    expect(screen.getByText('Import File')).toBeInTheDocument();
  });

  it('renders the file dropzone in initial upload stage', () => {
    render(<ImportPage />);
    expect(screen.getByTestId('file-dropzone')).toBeInTheDocument();
  });

  it('shows drop files placeholder in initial state', () => {
    render(<ImportPage />);
    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
  });

  it('renders page description', () => {
    render(<ImportPage />);
    expect(screen.getByText(/upload csv/i)).toBeInTheDocument();
  });

  it('shows done stage with resource count after synchronous import', async () => {
    // Server thật trả {message, resourceCount} — client hiển thị số resource.
    const { connectorApi } = await import('../../api/connector-api');
    vi.mocked(connectorApi.importFile).mockResolvedValueOnce({
      message: 'Import complete',
      resourceCount: 3,
    });

    render(<ImportPage />);
    screen.getByRole('button', { name: /accept file/i }).click();

    expect(await screen.findByText(/import complete — 3 resources processed/i)).toBeInTheDocument();
    // File name của file vừa chọn hiển thị trong done box
    expect(screen.getByText('data.csv')).toBeInTheDocument();
  });

  it('shows the error stage when the import request fails', async () => {
    const { connectorApi } = await import('../../api/connector-api');
    vi.mocked(connectorApi.importFile).mockRejectedValueOnce(
      new Error('Authentication required'),
    );

    render(<ImportPage />);
    screen.getByRole('button', { name: /accept file/i }).click();

    expect(await screen.findByText(/import failed/i)).toBeInTheDocument();
    expect(screen.getByText(/authentication required/i)).toBeInTheDocument();
  });
});
