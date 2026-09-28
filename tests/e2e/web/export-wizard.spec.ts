/**
 * Export Wizard E2E tests.
 * Covers: page load, step indicator, connector selection, patient ID gate.
 */

import { test, expect } from '@playwright/test';
import { ExportWizardPage } from './pages/export-wizard.page';

test.describe('Export Wizard', () => {
  test('loads the export page', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await expect(page.getByText(/export fhir bundle/i)).toBeVisible();
  });

  test('step indicator is visible', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await expect(wizard.stepIndicator).toBeVisible();
  });

  test('step 1 shows connector type cards', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await expect(wizard.fhirEndpointCard).toBeVisible();
    await expect(wizard.fileUploadCard).toBeVisible();
  });

  test('selecting FHIR Endpoint advances to step 2', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await wizard.selectFhirEndpoint();
    // Step 2 heading
    await expect(page.getByText(/fhir connection/i)).toBeVisible();
  });

  test('back button on step 2 returns to step 1', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await wizard.selectFhirEndpoint();
    await wizard.clickBack();
    await expect(wizard.fhirEndpointCard).toBeVisible();
  });

  test('selecting File Upload opens the Import page (CSV / Excel are converted there)', async ({
    page,
  }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await wizard.selectFileUpload();
    await expect(page).toHaveURL(/\/app\/import$/);
    await expect(page.locator('select#mapping-preset')).toBeVisible();
  });

  test('Next button on step 2 (FHIR) advances to patient ID step', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await wizard.selectFhirEndpoint();
    await wizard.clickNext();
    await expect(page.getByText(/patient id/i).first()).toBeVisible();
  });

  test('Next button disabled on patient ID step when field is empty', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await wizard.selectFhirEndpoint();
    await wizard.clickNext();
    // Next button should be disabled when patientId is empty
    const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
    await expect(nextBtn).toBeDisabled();
  });

  test('Next button on step 3 enabled after filling patient ID', async ({ page }) => {
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    await wizard.selectFhirEndpoint();
    await wizard.clickNext();
    await wizard.fillPatientId('patient-001');
    const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
    await expect(nextBtn).toBeEnabled();
  });

  test('step indicator labels are visible on larger viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const wizard = new ExportWizardPage(page);
    await wizard.goto();
    // At least the first step label should be visible at desktop width
    await expect(page.getByText('Connector')).toBeVisible();
  });
});
