/**
 * Accessibility tests — automated axe-core scan.
 * Checks each page for critical/serious WCAG violations.
 *
 * NOTE: Playwright tests — NOT runnable without a running web server.
 * Run separately via: pnpm test:e2e:a11y
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = [
  '/',
  '/app/dashboard',
  '/app/export',
  '/app/import',
  '/app/summary/test-export-123',
  '/app/settings',
];

for (const pagePath of pages) {
  test(`${pagePath} has no critical a11y violations @a11y`, async ({ page }) => {
    await page.goto(pagePath);

    // Wait for main content to be rendered before scanning
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      // Only flag WCAG 2.1 Level AA rules — production baseline
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    // Surface actionable failure details in the test output
    if (critical.length > 0) {
      const summary = critical.map((v) => `[${v.impact}] ${v.id}: ${v.description}`).join('\n');
      console.error(`Accessibility violations on ${pagePath}:\n${summary}`);
    }

    expect(critical).toHaveLength(0);
  });
}
