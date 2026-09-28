/**
 * ImportPage — Page Object Model for /import.
 * Stages: upload (mapping + data file) → importing → done/error (one synchronous request).
 */

import type { Page, Locator } from '@playwright/test';
import * as path from 'path';

export class ImportPage {
  readonly page: Page;
  readonly dropzone: Locator;
  readonly fileInput: Locator;
  readonly successBanner: Locator;
  readonly errorBanner: Locator;
  readonly mappingSelect: Locator;
  readonly useSampleButton: Locator;
  readonly importButton: Locator;

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
    // Done state — "Import complete — N resources processed"
    this.successBanner = page.getByText(/import complete/i);
    // Error state
    this.errorBanner = page.getByText(/import failed/i);
    // Column mapping preset (vn | kr | jp | generic | custom)
    this.mappingSelect = page.locator('select#mapping-preset');
    // Loads the bundled synthetic sample matching the selected preset
    this.useSampleButton = page.getByRole('button', { name: /try with sample data/i });
    this.importButton = page.getByRole('button', { name: 'Import', exact: true });
  }

  async goto() {
    await this.page.goto('/app/import');
  }

  /** Submit the selected mapping + data file. */
  async importNow() {
    await this.importButton.click();
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
