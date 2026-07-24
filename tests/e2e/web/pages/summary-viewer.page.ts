/**
 * SummaryViewerPage — Page Object Model for /summary/:id.
 * Shows config panel (provider, language, detail level), generate button,
 * and summary output with disclaimer.
 */

import type { Page, Locator } from '@playwright/test';

export class SummaryViewerPage {
  readonly page: Page;
  readonly configSection: Locator;
  readonly providerSelect: Locator;
  readonly languageSelect: Locator;
  readonly detailLevelSelect: Locator;
  readonly generateButton: Locator;
  readonly markdownContent: Locator;
  readonly disclaimerBanner: Locator;
  readonly noExportIdWarning: Locator;
  readonly downloadButtons: Locator;

  constructor(page: Page) {
    this.page = page;
    // Config section heading
    this.configSection = page.getByText(/configuration/i).first();
    // Provider select — rendered inside SummaryConfig component
    this.providerSelect = page
      .locator('select')
      .filter({ hasText: /openai|anthropic|google/i })
      .first();
    // Language select
    this.languageSelect = page
      .locator('select')
      .filter({ hasText: /english|spanish|french/i })
      .first();
    // Detail level select
    this.detailLevelSelect = page
      .locator('select')
      .filter({ hasText: /standard|brief|detailed/i })
      .first();
    // Generate button — text changes based on state
    this.generateButton = page.getByRole('button', {
      name: /generate summary|starting|generating/i,
    });
    // Rendered markdown content area
    this.markdownContent = page
      .locator('[data-testid="summary-content"]')
      .or(page.locator('[class*="prose"]'))
      .first();
    // Disclaimer banner — SummaryDisplay renders medical disclaimer
    this.disclaimerBanner = page.getByText(/disclaimer|not a substitute|medical advice/i).first();
    // Warning when no export ID
    this.noExportIdWarning = page.getByText(/no export id provided/i);
    // Download buttons in SummaryActions
    this.downloadButtons = page.getByRole('button', { name: /download|copy/i });
  }

  async goto(exportId = '') {
    const path = exportId ? `/app/summary/${exportId}` : '/app/summary';
    await this.page.goto(path);
  }

  async selectProvider(value: 'openai' | 'anthropic' | 'google') {
    await this.providerSelect.selectOption(value);
  }

  async selectLanguage(value: string) {
    await this.languageSelect.selectOption(value);
  }

  async clickGenerate() {
    await this.generateButton.click();
  }
}
