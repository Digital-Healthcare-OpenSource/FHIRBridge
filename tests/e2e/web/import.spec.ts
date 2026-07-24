/**
 * Import Page E2E tests.
 * Covers: page load, dropzone, accept types, unauthenticated error state,
 * and an authenticated CSV upload round trip against the real API.
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
    await expect(page.getByText(/upload csv, xlsx or fhir json/i).first()).toBeVisible();
  });

  test('file dropzone input is attached', async ({ page }) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached();
  });

  test('file input accepts CSV, XLSX and JSON types', async ({ page }) => {
    await page.goto('/app/import');
    const fileInput = page.locator('input[type="file"]').first();
    const accept = await fileInput.getAttribute('accept');
    expect(accept?.toLowerCase()).toMatch(/csv/);
    expect(accept?.toLowerCase()).toMatch(/xlsx|spreadsheet/);
    expect(accept?.toLowerCase()).toMatch(/json/);
  });

  test('uploading without credentials surfaces the error state', async ({ page }) => {
    const importPage = new ImportPage(page);
    await importPage.goto();
    await importPage.uploadFixture('test-patients.csv');
    // Server rejects with 401 → UI switches to the error stage
    await expect(page.getByText(/import failed/i)).toBeVisible();
    await expect(page.getByText(/authentication required/i)).toBeVisible();
    // "Try again" resets back to the upload stage
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(page.locator('input[type="file"]').first()).toBeAttached();
  });

  test('authenticated CSV upload round-trips through the real API', async ({ page }) => {
    // Sign in qua Settings UI (token in-memory) rồi điều hướng bằng click SPA
    await signInViaSettings(page);
    await page.getByRole('link', { name: 'Import', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/import$/);

    const importPage = new ImportPage(page);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/connectors/import')),
      importPage.uploadFixture('test-patients.csv'),
    ]);
    expect(response.status()).toBe(200);
    // Server xử lý đồng bộ → UI chuyển sang done stage với resource count
    await expect(page.getByText(/import complete — \d+ resources processed/i)).toBeVisible();
    await expect(page.getByText('test-patients.csv')).toBeVisible();
    await expect(page.getByText(/import failed/i)).toBeHidden();
  });

  test('API-key sign-in routes via x-api-key and uploads successfully', async ({ page }) => {
    // API key (không phải JWT) — client phải gửi x-api-key, không phải Bearer
    await signInViaSettings(page, 'test-key-free');
    await page.getByRole('link', { name: 'Import', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/import$/);

    const importPage = new ImportPage(page);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/connectors/import')),
      importPage.uploadFixture('test-patients.csv'),
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
