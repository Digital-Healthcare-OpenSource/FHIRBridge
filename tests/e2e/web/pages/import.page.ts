/**
 * ImportPage — Page Object Model for /import.
 * Stages: upload → preview → mapping → exporting → done/error.
 */

import type { Page, Locator } from '@playwright/test';
import * as path from 'path';

export class ImportPage {
  readonly page: Page;
  readonly dropzone: Locator;
  readonly fileInput: Locator;
  readonly previewHeading: Locator;
  readonly previewTable: Locator;
  readonly mapperArea: Locator;
  readonly startImportButton: Locator;
  readonly cancelButton: Locator;
  readonly successBanner: Locator;
  readonly errorBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    // FileDropzone — rendered as a div with role or distinctive class
    this.dropzone = page
      .locator('[data-testid="file-dropzone"]')
      .or(page.locator('[class*="dropzone"]'))
      .or(page.getByText(/drag.*drop|click to upload/i).first());
    // File input — aria-label="File upload" (set by react-dropzone via getInputProps)
    this.fileInput = page
      .locator('input[aria-label="File upload"]')
      .or(page.locator('input[type="file"]'))
      .first();
    // Preview section heading
    this.previewHeading = page.getByText(/preview/i).first();
    // Preview table
    this.previewTable = page.locator('table').first();
    // Column mapper area heading
    this.mapperArea = page.getByText(/map columns to fhir/i);
    // Start import button
    this.startImportButton = page.getByRole('button', { name: /start import/i });
    // Cancel button
    this.cancelButton = page.getByRole('button', { name: /cancel/i });
    // Success state
    this.successBanner = page.getByText(/import started/i);
    // Error state
    this.errorBanner = page.getByText(/import failed/i);
  }

  async goto() {
    await this.page.goto('/app/import');
  }

  /** Upload a file via the hidden <input type="file"> element. */
  async uploadFile(filePath: string) {
    await this.fileInput.setInputFiles(filePath);
  }

  /** Upload a file using the resolved absolute path relative to fixtures dir. */
  async uploadFixture(filename: string) {
    const fixturePath = path.join(__dirname, '..', 'fixtures', filename);
    await this.fileInput.setInputFiles(fixturePath);
  }
}
