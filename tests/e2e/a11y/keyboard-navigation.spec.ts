/**
 * Accessibility tests — keyboard navigation.
 * Verifies interactive elements on critical pages are reachable via Tab,
 * have a visible focus indicator, and respond correctly to Enter.
 *
 * NOTE: Playwright tests — run via `pnpm test:a11y` (grep @a11y) or as part
 * of `pnpm test:e2e`.
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Export page — full keyboard flow
// ---------------------------------------------------------------------------

test('export page: all interactive elements reachable via Tab @a11y', async ({
  page,
  browserName,
}) => {
  await page.goto('/app/export');
  await page.waitForLoadState('networkidle');

  // WebKit theo hành vi Safari: links KHÔNG nằm trong tab order — chỉ đếm
  // form controls; Chromium/Firefox tab qua tất cả (links + controls).
  const focusableSelector =
    browserName === 'webkit'
      ? 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
      : 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusable = page.locator(focusableSelector);

  const count = await focusable.count();
  expect(count).toBeGreaterThan(0);

  // Tab through every focusable element and verify each receives focus
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? '');
    // Focused element must be a real interactive element, not body/html
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DIV', 'SPAN']).toContain(
      focused.toUpperCase(),
    );
  }
});

test('export page: focused elements have visible focus indicator @a11y', async ({ page }) => {
  await page.goto('/app/export');
  await page.waitForLoadState('networkidle');

  // Tab to the first interactive element (the skip link)
  await page.keyboard.press('Tab');

  // The focused element must have a visible outline or box-shadow
  const outlineStyle = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const styles = window.getComputedStyle(el);
    return {
      outline: styles.outline,
      outlineWidth: styles.outlineWidth,
      boxShadow: styles.boxShadow,
    };
  });

  expect(outlineStyle).not.toBeNull();

  // A visible focus indicator: non-zero outline width OR a non-none box-shadow
  const hasOutline =
    outlineStyle !== null && outlineStyle.outlineWidth !== '0px' && outlineStyle.outline !== 'none';

  const hasBoxShadow =
    outlineStyle !== null && outlineStyle.boxShadow !== 'none' && outlineStyle.boxShadow !== '';

  expect(hasOutline || hasBoxShadow).toBe(true);
});

test('export page: Enter key activates focused connector card @a11y', async ({ page }) => {
  await page.goto('/app/export');
  await page.waitForLoadState('networkidle');

  // Focus the "FHIR Endpoint" connector card and activate it with Enter
  const card = page.getByRole('button', { name: /fhir endpoint/i });
  await card.focus();
  await page.keyboard.press('Enter');

  // Keyboard activation must advance the wizard to step 2
  await expect(page.getByRole('heading', { name: /fhir connection/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Dashboard — skip-to-content link
// ---------------------------------------------------------------------------

test('dashboard: skip-to-main-content link is first focusable element @a11y', async ({
  page,
  browserName,
}) => {
  await page.goto('/app/dashboard');
  await page.waitForLoadState('networkidle');

  if (browserName === 'webkit') {
    // WebKit không đưa links vào tab order (hành vi Safari) — xác minh skip
    // link tồn tại, đứng đầu DOM focus order và nhận focus trực tiếp được.
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toHaveCount(1);
    const isFirstFocusable = await page.evaluate(() => {
      const first = document.querySelector(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return first?.getAttribute('href') === '#main-content';
    });
    expect(isFirstFocusable).toBe(true);
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    return;
  }

  await page.keyboard.press('Tab');

  const firstFocused = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? '',
    href: (document.activeElement as HTMLAnchorElement)?.href ?? '',
  }));

  // AppShell renders the skip link as the very first focusable element
  expect(firstFocused.tag).toBe('A');
  expect(firstFocused.href).toContain('#main-content');
});

// ---------------------------------------------------------------------------
// Settings page — form fields reachable
// ---------------------------------------------------------------------------

test('settings page: form fields reachable and operable via keyboard @a11y', async ({ page }) => {
  await page.goto('/app/settings');
  await page.waitForLoadState('networkidle');

  const inputs = page.locator('input, select, textarea');
  const inputCount = await inputs.count();
  expect(inputCount).toBeGreaterThan(0);

  // Focus the first input (API key) and verify it accepts keyboard input
  const firstInput = inputs.first();
  await firstInput.focus();
  await page.keyboard.type('test');
  const value = await firstInput.inputValue();
  expect(value.length).toBeGreaterThan(0);
});
