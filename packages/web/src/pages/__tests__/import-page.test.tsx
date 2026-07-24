/**
 * Tests for ImportPage component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportPage } from '../import-page';

// Mock API
vi.mock('../../api/connector-api', () => ({
  connectorApi: {
    uploadFile: vi.fn(),
  },
}));

vi.mock('../../api/export-api', () => ({
  exportApi: {
    startExport: vi.fn(),
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

// Mock PreviewTable and ColumnMapper
vi.mock('../../components/import/preview-table', () => ({
  PreviewTable: () => <div data-testid="preview-table" />,
}));

vi.mock('../../components/import/column-mapper', () => ({
  ColumnMapper: () => <div data-testid="column-mapper" />,
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

  it('transitions to preview stage after file accepted', async () => {
    const { connectorApi } = await import('../../api/connector-api');
    vi.mocked(connectorApi.uploadFile).mockResolvedValueOnce({
      id: 'file-1',
      filename: 'data.csv',
      columns: ['name', 'dob'],
      rowCount: 10,
    });

    render(<ImportPage />);
    screen.getByRole('button', { name: /accept file/i }).click();

    await screen.findByTestId('preview-table');
    expect(screen.getByTestId('preview-table')).toBeInTheDocument();
  });

  it('renders column mapper after upload with columns', async () => {
    const { connectorApi } = await import('../../api/connector-api');
    vi.mocked(connectorApi.uploadFile).mockResolvedValueOnce({
      id: 'file-1',
      filename: 'data.csv',
      columns: ['name', 'dob'],
      rowCount: 10,
    });

    render(<ImportPage />);
    screen.getByRole('button', { name: /accept file/i }).click();

    await screen.findByTestId('column-mapper');
    expect(screen.getByTestId('column-mapper')).toBeInTheDocument();
  });

  it('shows done stage with resource count when server processes synchronously (no columns)', async () => {
    // Server thật trả {message, resourceCount, bundle} — không có columns
    const { connectorApi } = await import('../../api/connector-api');
    vi.mocked(connectorApi.uploadFile).mockResolvedValueOnce({
      message: 'Import complete',
      resourceCount: 3,
    } as never);

    render(<ImportPage />);
    screen.getByRole('button', { name: /accept file/i }).click();

    expect(await screen.findByText(/import complete — 3 resources processed/i)).toBeInTheDocument();
    // File name của file vừa chọn hiển thị trong done box
    expect(screen.getByText('data.csv')).toBeInTheDocument();
  });
});
