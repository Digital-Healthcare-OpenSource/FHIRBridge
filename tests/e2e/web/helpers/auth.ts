/**
 * E2E auth helper — mint một JWT HS256 hợp lệ (secret từ .env.test, khớp
 * JWT_SECRET mà playwright.config.ts inject vào API server) rồi "đăng nhập"
 * qua đúng UI thật: dán token vào ô API Key ở Settings và bấm Save.
 *
 * Token chỉ nằm trong memory của tab (thiết kế zero-persistence của app),
 * nên sau khi sign-in phải điều hướng bằng click (SPA) — goto() sẽ mất token.
 */

import { sign } from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import { expect, type Page } from '@playwright/test';

const testEnv = dotenv.config({ path: '.env.test' }).parsed ?? {};
const JWT_SECRET = testEnv['JWT_SECRET'] ?? '';

/** JWT cho một user e2e generic — claim sub + exp theo yêu cầu của auth plugin. */
export function mintUserJwt(sub = 'e2e-web-user'): string {
  return sign({ sub }, JWT_SECRET, { expiresIn: '15m' });
}

/**
 * Sign in qua Settings UI. Sau khi gọi xong, page đang ở /app/settings và
 * token đã nằm trong memory — điều hướng tiếp bằng click link trong sidebar.
 */
export async function signInViaSettings(page: Page, token = mintUserJwt()): Promise<void> {
  await page.goto('/app/settings');
  await page.locator('input[type="password"]').first().fill(token);
  await page.getByRole('button', { name: /save settings/i }).click();
  await expect(page.getByText('Saved!')).toBeVisible();
}
