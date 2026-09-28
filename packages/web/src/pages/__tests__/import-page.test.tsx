/**
 * Tests for ImportPage component.
 *
 * Server /connectors/import xử lý đồng bộ (file + mapping → bundle) → UI:
 * chọn mapping + file → importing → done (tải bundle) / error (kèm cảnh báo).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImportPage } from '../import-page';
import { ApiError } from '../../api/api-client';

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
  }: {
    onFilesAccepted: (f: File[]) => void;
    selectedFile?: File | null;
  }) => (
    <div data-testid="file-dropzone">
      <span>{selectedFile ? selectedFile.name : 'Drop files here'}</span>
      <button type="button" onClick={() => onFilesAccepted([new File(['csv'], 'data.csv')])}>
        Accept File
      </button>
    </div>
  ),
}));

const { connectorApi } = await import('../../api/connector-api');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function chooseFileAndImport() {
  fireEvent.click(screen.getByRole('button', { name: /accept file/i }));
  fireEvent.click(screen.getByRole('button', { name: /^import$/i }));
}

describe('ImportPage', () => {
  it('renders title, description and the data-file dropzone', () => {
    render(<ImportPage />);
    expect(screen.getByText('Import File')).toBeInTheDocument();
    expect(screen.getByText(/csv or excel export/i)).toBeInTheDocument();
    expect(screen.getByTestId('file-dropzone')).toBeInTheDocument();
  });

  it('offers the VN / KR / JP / international example mappings plus a custom one', () => {
    render(<ImportPage />);
    const select = screen.getByLabelText(/column mapping/i) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      'vn',
      'kr',
      'jp',
      'generic',
      'custom',
    ]);
    // English UI → international example by default
    expect(select.value).toBe('generic');
  });

  it('sends the chosen example mapping with the file and shows the result', async () => {
    vi.mocked(connectorApi.importFile).mockResolvedValueOnce({
      message: 'Import complete',
      resourceCount: 3,
      warnings: ['Row 4: birthDate "31/02/1990" is not a valid date — skipped'],
      bundle: { resourceType: 'Bundle', type: 'collection', entry: [] },
    });

    render(<ImportPage />);
    fireEvent.change(screen.getByLabelText(/column mapping/i), { target: { value: 'kr' } });
    chooseFileAndImport();

    expect(await screen.findByText(/import complete — 3 resources processed/i)).toBeInTheDocument();
    const [file, mapping] = vi.mocked(connectorApi.importFile).mock.calls[0]!;
    expect(file.name).toBe('data.csv');
    expect(JSON.parse(mapping)).toHaveProperty('resourceTypes');
    expect(screen.getByText(/not a valid date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download fhir bundle/i })).toBeInTheDocument();
  });

  it('asks for a data file before importing', () => {
    render(<ImportPage />);
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/choose a csv or excel file/i);
    expect(connectorApi.importFile).not.toHaveBeenCalled();
  });

  it('requires a mapping file when "custom" is selected', () => {
    render(<ImportPage />);
    fireEvent.change(screen.getByLabelText(/column mapping/i), { target: { value: 'custom' } });
    chooseFileAndImport();
    expect(screen.getByRole('alert')).toHaveTextContent(/choose a column mapping/i);
  });

  it('rejects a custom mapping that is not JSON', async () => {
    render(<ImportPage />);
    fireEvent.change(screen.getByLabelText(/column mapping/i), { target: { value: 'custom' } });
    const mappingFile = new File(['not json'], 'mine.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/mapping file/i), { target: { files: [mappingFile] } });
    expect(await screen.findByText('mine.json')).toBeInTheDocument();
    chooseFileAndImport();
    expect(screen.getByRole('alert')).toHaveTextContent(/not valid json/i);
  });

  it('loads the bundled sample file for the selected example', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['a,b\n1,2']) }),
    );
    render(<ImportPage />);
    fireEvent.click(screen.getByRole('button', { name: /try with sample data/i }));
    expect(await screen.findByText('generic-hl7.csv')).toBeInTheDocument();
  });

  it('shows the server message and its warnings when the import fails', async () => {
    vi.mocked(connectorApi.importFile).mockRejectedValueOnce(
      new ApiError(422, 'No FHIR resources were produced from 2 row(s).', {
        warnings: ['Column "환자ID" not found in file header'],
      }),
    );

    render(<ImportPage />);
    chooseFileAndImport();

    expect(await screen.findByText(/import failed/i)).toBeInTheDocument();
    expect(screen.getByText(/no fhir resources were produced/i)).toBeInTheDocument();
    expect(screen.getByText(/not found in file header/i)).toBeInTheDocument();
  });
});
