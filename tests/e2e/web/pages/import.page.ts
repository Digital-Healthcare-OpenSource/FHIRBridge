/**
 * ImportPage — Page Object Model for /import.
 * Stages: upload → importing → done/error (server xử lý đồng bộ một request).
 */

import type { Page, Locator } from '@playwright/test';
import * as path from 'path';

export class ImportPage {
  readonly page: Page;
  readonly dropzone: Locator;
  readonly fileInput: Locator;
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
    // Done state — "Import complete — N resources processed"
    this.successBanner = page.getByText(/import complete/i);
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
