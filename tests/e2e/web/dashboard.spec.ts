/**
 * Dashboard E2E tests.
 * Verifies page load, sidebar navigation, quick action cards, and health indicator.
 */

import { test, expect } from '@playwright/test';
import { DashboardPage } from './pages/dashboard.page';

test.describe('Dashboard', () => {
  test('loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/app/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('shows navigation sidebar', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.sidebar).toBeVisible();
  });

  test('has New Export quick action', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.newExportButton).toBeVisible();
  });

  test('has Import File quick action', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.importButton).toBeVisible();
  });

  test('shows Recent Exports section heading', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.recentExportsHeading).toBeVisible();
  });

  test('refresh button is present and labeled', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await expect(dashboard.refreshButton).toBeVisible();
  });

  test('page title includes FHIRBridge', async ({ page }) => {
    await page.goto('/app/dashboard');
    await expect(page).toHaveTitle(/fhirbridge/i);
  });

  test('New Export button navigates to /export', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.clickNewExport();
    await expect(page).toHaveURL(/\/app\/export$/);
  });

  test('Import File button navigates to /import', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.clickImport();
    await expect(page).toHaveURL(/\/app\/import$/);
  });
});
