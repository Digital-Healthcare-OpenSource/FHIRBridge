/**
 * Error States E2E tests.
 * Covers: route fallbacks (top-level → landing, /app/* → dashboard) and
 * export wizard form validation gates.
 */

import { test, expect } from '@playwright/test';

test.describe('Error States', () => {
  test('unknown top-level route falls back to the public landing page', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    // App.tsx: top-level catch-all → <Navigate to={ROUTES.LANDING} replace />
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('unknown route inside /app falls back to the dashboard', async ({ page }) => {
    await page.goto('/app/some/deeply/nested/path');
    // AppShell: nested catch-all → <Navigate to={ROUTES.DASHBOARD} replace />
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('export page loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/app/export');
    await expect(page.getByRole('heading', { name: /export fhir bundle/i })).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('import page loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/app/import');
    await expect(page.getByRole('heading', { name: /import file/i })).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('settings page loads without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/app/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('export step 3 Next button blocked when patient ID empty', async ({ page }) => {
    await page.goto('/app/export');
    // Step 1: pick FHIR endpoint
    await page.getByRole('button', { name: /fhir endpoint/i }).click();
    // Step 2: click Next
    await page
      .getByRole('button', { name: /^next$/i })
      .first()
      .click();
    // Step 3: Next should be disabled
    const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
    await expect(nextBtn).toBeDisabled();
  });

  test('export Next button enabled after patient ID filled', async ({ page }) => {
    await page.goto('/app/export');
    await page.getByRole('button', { name: /fhir endpoint/i }).click();
    await page
      .getByRole('button', { name: /^next$/i })
      .first()
      .click();
    await page.locator('#patient-id').fill('patient-999');
    const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
    await expect(nextBtn).toBeEnabled();
  });
});
