import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

// Load test environment variables for webServer env injection
const testEnv = dotenv.config({ path: '.env.test' }).parsed ?? {};

export default defineConfig({
  testDir: './tests/e2e',
  // tests/e2e/cli/** là vitest project 'cli-e2e' (pnpm test:e2e:cli) — Playwright
  // không được collect chúng (import vitest sẽ crash lúc load).
  testIgnore: '**/cli/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  outputDir: './tests/e2e/test-results/',

  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },

  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  projects: [
    // Desktop
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    // Tablet (viewport after the device spread, otherwise the desktop viewport wins)
    {
      name: 'chromium-tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'firefox-tablet',
      use: { ...devices['Desktop Firefox'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'webkit-tablet',
      use: { ...devices['Desktop Safari'], viewport: { width: 768, height: 1024 } },
    },
  ],

  webServer: [
    {
      command: 'node packages/api/dist/index.js',
      port: 3002,
      reuseExistingServer: !process.env.CI,
      env: testEnv,
    },
    {
      command: 'pnpm --filter @fhirbridge/web preview --port 4173',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
