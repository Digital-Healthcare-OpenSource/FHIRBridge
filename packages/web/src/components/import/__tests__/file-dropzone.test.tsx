/**
 * Tests for FileDropzone component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileDropzone } from '../file-dropzone';

function makeFile(name: string, type: string, size = 1024): File {
  return new File(['x'.repeat(size)], name, { type });
}

describe('FileDropzone', () => {
  it('renders the drop zone with upload instruction', () => {
    render(<FileDropzone onFilesAccepted={vi.fn()} />);
    expect(screen.getByText(/drag & drop or click to upload/i)).toBeInTheDocument();
  });

  it('renders accepted file types hint', () => {
    render(<FileDropzone onFilesAccepted={vi.fn()} />);
    expect(screen.getByText(/csv or xlsx/i)).toBeInTheDocument();
  });

  it('renders file upload input', () => {
    render(<FileDropzone onFilesAccepted={vi.fn()} />);
    expect(screen.getByLabelText(/file upload/i)).toBeInTheDocument();
  });

  it('shows selected file name when selectedFile is provided', () => {
    const file = makeFile(
      'patients.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    render(<FileDropzone onFilesAccepted={vi.fn()} selectedFile={file} />);
    expect(screen.getByText('patients.xlsx')).toBeInTheDocument();
  });

  it('shows file size when selectedFile is provided', () => {
    const file = makeFile('data.csv', 'text/csv', 2560);
    render(<FileDropzone onFilesAccepted={vi.fn()} selectedFile={file} />);
    expect(screen.getByText('2.5 KB')).toBeInTheDocument();
  });

  it('renders remove button when selectedFile and onClearFile provided', () => {
    const file = makeFile('data.csv', 'text/csv');
    render(<FileDropzone onFilesAccepted={vi.fn()} selectedFile={file} onClearFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: /remove file/i })).toBeInTheDocument();
  });

  it('calls onClearFile when remove button is clicked', async () => {
    const file = makeFile('data.csv', 'text/csv');
    const onClearFile = vi.fn();
    render(
      <FileDropzone onFilesAccepted={vi.fn()} selectedFile={file} onClearFile={onClearFile} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /remove file/i }));
    expect(onClearFile).toHaveBeenCalledTimes(1);
  });

  it('calls onFilesAccepted when a valid CSV file is dropped', async () => {
    const onFilesAccepted = vi.fn();
    render(<FileDropzone onFilesAccepted={onFilesAccepted} />);

    const input = screen.getByLabelText(/file upload/i);
    const csvFile = makeFile('test.csv', 'text/csv');

    await waitFor(() => {
      fireEvent.change(input, { target: { files: [csvFile] } });
    });

    await waitFor(() => {
      expect(onFilesAccepted).toHaveBeenCalledWith(expect.arrayContaining([csvFile]));
    });
  });

  it('renders in disabled state when disabled prop is true', () => {
    const { container } = render(<FileDropzone onFilesAccepted={vi.fn()} disabled />);
    const dropzone = container.firstChild as HTMLElement;
    expect(dropzone.className).toContain('opacity-50');
    expect(dropzone.className).toContain('cursor-not-allowed');
  });
});
