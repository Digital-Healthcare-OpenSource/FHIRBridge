/**
 * Summary Viewer E2E tests.
 * Covers: page load with export ID, redirect without ID, config panel,
 * and the AI feature flag gate (VITE_AI_ENABLED off in the e2e build).
 */

import { test, expect } from '@playwright/test';
import { SummaryViewerPage } from './pages/summary-viewer.page';

test.describe('Summary Viewer', () => {
  test('loads the summary viewer page', async ({ page }) => {
    const summary = new SummaryViewerPage(page);
    await summary.goto('test-export-123');
    await expect(page.getByRole('heading', { name: /summary viewer/i })).toBeVisible();
  });

  test('/app/summary without an export ID redirects to the dashboard', async ({ page }) => {
    await page.goto('/app/summary');
    // Route là /app/summary/:id — thiếu id rơi vào catch-all → dashboard
    await expect(page).toHaveURL(/\/app\/dashboard$/);
  });

  test('configuration section is visible', async ({ page }) => {
    const summary = new SummaryViewerPage(page);
    await summary.goto('test-export-123');
    await expect(summary.configSection).toBeVisible();
  });

  test('provider, language and detail level selects render', async ({ page }) => {
    const summary = new SummaryViewerPage(page);
    await summary.goto('test-export-123');
    await expect(page.locator('select#provider')).toBeVisible();
    await expect(page.locator('select#language')).toBeVisible();
    await expect(page.locator('select#detail')).toBeVisible();
  });

  test('generate button is present but gated by the AI feature flag', async ({ page }) => {
    const summary = new SummaryViewerPage(page);
    await summary.goto('test-export-123');
    // E2e build không set VITE_AI_ENABLED → nút hiện nhưng disabled + hint
    await expect(summary.generateButton).toBeVisible();
    await expect(summary.generateButton).toBeDisabled();
    await expect(page.getByText(/VITE_AI_ENABLED/)).toBeVisible();
  });

  test('page description references clinical summary', async ({ page }) => {
    const summary = new SummaryViewerPage(page);
    await summary.goto('test-export-123');
    await expect(page.getByText(/ai-powered clinical summary/i).first()).toBeVisible();
  });
});
