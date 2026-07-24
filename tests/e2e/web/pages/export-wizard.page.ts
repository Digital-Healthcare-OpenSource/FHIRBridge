/**
 * ExportWizardPage — Page Object Model for /export.
 * 6-step wizard: Connector → Configure → Patient → Options → Review → Progress.
 */

import type { Page, Locator } from '@playwright/test';

export class ExportWizardPage {
  readonly page: Page;
  readonly stepIndicator: Locator;
  readonly nextButton: Locator;
  readonly backButton: Locator;
  readonly startExportButton: Locator;
  // Step 1 — connector type cards
  readonly fhirEndpointCard: Locator;
  readonly fileUploadCard: Locator;
  // Step 2 — FHIR connection form
  readonly endpointUrlInput: Locator;
  // Step 3 — patient ID
  readonly patientIdInput: Locator;
  // Step 4 — options
  readonly formatSelect: Locator;
  readonly includeSummaryCheckbox: Locator;

  constructor(page: Page) {
    this.page = page;
    // Step indicator nav
    this.stepIndicator = page.getByRole('navigation', { name: /export wizard steps/i });
    // Navigation buttons
    this.nextButton = page.getByRole('button', { name: /next/i }).first();
    this.backButton = page.getByRole('button', { name: /back/i }).first();
    this.startExportButton = page.getByRole('button', { name: /start export/i });
    // Connector type cards
    this.fhirEndpointCard = page.getByRole('button', { name: /fhir endpoint/i });
    this.fileUploadCard = page.getByRole('button', { name: /file upload/i });
    // FHIR URL input
    this.endpointUrlInput = page
      .locator('input[placeholder*="http"]')
      .or(page.getByLabel(/fhir.*url|endpoint url/i))
      .first();
    // Patient ID input — id="patient-id"
    this.patientIdInput = page.locator('#patient-id').or(page.getByLabel(/patient identifier/i));
    // Format select
    this.formatSelect = page
      .locator('select')
      .filter({ hasText: /fhir bundle|ndjson/i })
      .first();
    // Include summary checkbox
    this.includeSummaryCheckbox = page.getByRole('checkbox', { name: /generate ai summary/i });
  }

  async goto() {
    await this.page.goto('/app/export');
  }

  async selectFhirEndpoint() {
    await this.fhirEndpointCard.click();
  }

  async selectFileUpload() {
    await this.fileUploadCard.click();
  }

  async fillPatientId(id: string) {
    await this.patientIdInput.fill(id);
  }

  async clickNext() {
    await this.nextButton.click();
  }

  async clickBack() {
    await this.backButton.click();
  }
}
