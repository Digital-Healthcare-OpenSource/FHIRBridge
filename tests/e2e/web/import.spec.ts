/**
 * Import Page E2E tests.
 * Covers: page load, dropzone, accept types, example mappings, unauthenticated error
 * state, and authenticated imports (bundled sample data) against the real API.
 */

import { test, expect } from '@playwright/test';
import { ImportPage } from './pages/import.page';
import { signInViaSettings } from './helpers/auth';

test.describe('Import Page', () => {
  test('loads the import page', async ({ page }) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    await expect(page.getByRole('heading', { name: /import file/i })).toBeVisible();
  });

  test('shows page description text', async ({ page }) => {
    await page.goto('/app/import');
    await expect(page.getByText(/csv or excel export/i).first()).toBeVisible();
  });

  test('file dropzone input is attached', async ({ page }) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
  });

  test('data file input accepts CSV and Excel (the API rejects anything else)', async ({
    page,
  }) => {
    await page.goto('/app/import');
    const fileInput = page.locator('input[type="file"]').first();
    const accept = await fileInput.getAttribute('accept');
    expect(accept?.toLowerCase()).toMatch(/csv/);
    expect(accept?.toLowerCase()).toMatch(/xlsx|spreadsheet/);
    expect(accept?.toLowerCase()).not.toMatch(/json/);
  });

  test('offers VN / KR / JP / international example mappings', async ({ page }) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    // evaluateAll does not auto-wait — wait until the select is rendered
    await expect(importPage.mappingSelect.locator('option')).toHaveCount(5);
    const values = await importPage.mappingSelect
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    expect(values).toEqual(['vn', 'kr', 'jp', 'generic', 'custom']);
  });

  test('uploading without credentials surfaces the error state', async ({ page }) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    await importPage.uploadFixture('test-patients.csv');
    await importPage.importNow();
    // Server rejects with 401 → UI switches to the error stage
    await expect(page.getByText(/import failed/i)).toBeVisible();
    await expect(page.getByText(/authentication required/i)).toBeVisible();
    // "Try again" resets back to the upload stage
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
  });

  test('authenticated import of each example round-trips through the real API', async ({
    page,
  }) => {
    // Sign in qua Settings UI (token in-memory) rồi điều hướng bằng click SPA
    await signInViaSettings(page);
    await page.getByRole('link', { name: 'Import', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/import$/);

    const importPage = new ImportPage(page);
    for (const preset of ['vn', 'kr', 'jp', 'generic']) {
      await importPage.mappingSelect.selectOption(preset);
      await importPage.useSampleButton.click();
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/connectors/import')),
        importPage.importNow(),
      ]);
      expect(response.status(), `preset ${preset}`).toBe(200);
      await expect(page.getByText(/import complete — \d+ resources? processed/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /download fhir bundle/i })).toBeVisible();
      await page.getByRole('button', { name: /import another file/i }).click();
    }
  });

  test('API-key sign-in routes via x-api-key and uploads successfully', async ({ page }) => {
    // API key (không phải JWT) — client phải gửi x-api-key, không phải Bearer
    await signInViaSettings(page, 'test-key-free');
    await page.getByRole('link', { name: 'Import', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/import$/);

    const importPage = new ImportPage(page);
    await importPage.useSampleButton.click();
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/connectors/import')),
      importPage.importNow(),
    ]);
    expect(response.status()).toBe(200);
    expect(response.request().headers()['x-api-key']).toBe('test-key-free');
    await expect(page.getByText(/import complete/i)).toBeVisible();
  });

  test('sidebar navigation is present', async ({ page }) => {
    await page.goto('/app/import');
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
  });
});
