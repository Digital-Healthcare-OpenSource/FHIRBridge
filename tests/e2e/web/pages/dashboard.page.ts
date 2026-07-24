/**
 * DashboardPage — Page Object Model for the dashboard route (/).
 * Reflects actual DOM: quick-action buttons, nav sidebar, health strip, exports table.
 */

import type { Page, Locator } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly healthIndicator: Locator;
  readonly newExportButton: Locator;
  readonly importButton: Locator;
  readonly exportsTable: Locator;
  readonly sidebar: Locator;
  readonly refreshButton: Locator;
  readonly recentExportsHeading: Locator;

  constructor(page: Page) {
    this.page = page;
    // Health strip: "API status: ok" text
    this.healthIndicator = page
      .locator('[data-testid="health-indicator"]')
      .or(page.getByText(/api status/i).first());
    // Quick action card — navigates to /app/export (role duy nhất, tránh strict-mode)
    this.newExportButton = page.getByRole('button', { name: /new export/i });
    // Quick action card — navigates to /app/import
    this.importButton = page.getByRole('button', { name: /import file/i });
    // Exports table rendered when jobs exist
    this.exportsTable = page.locator('table').or(page.getByRole('table'));
    // App sidebar nav element
    this.sidebar = page.locator('nav').first();
    // Refresh button (aria-label="Refresh")
    this.refreshButton = page.getByRole('button', { name: /refresh/i });
    // Section heading
    this.recentExportsHeading = page.getByText(/recent exports/i);
  }

  async goto() {
    await this.page.goto('/app/dashboard');
  }

  async clickNewExport() {
    await this.newExportButton.click();
  }

  async clickImport() {
    await this.importButton.click();
  }

  async clickRefresh() {
    await this.refreshButton.click();
  }
}
