/**
 * SettingsPage — Page Object Model for /settings.
 * Covers: API key input (password masked), provider select, language select,
 * theme toggle button, and save button.
 */

import type { Page, Locator } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly apiKeyInput: Locator;
  readonly showHideKeyButton: Locator;
  readonly providerSelect: Locator;
  readonly languageSelect: Locator;
  readonly themeToggle: Locator;
  readonly saveButton: Locator;
  readonly savedConfirmation: Locator;

  constructor(page: Page) {
    this.page = page;
    // API key input — type="password" by default
    this.apiKeyInput = page
      .locator('input[type="password"]')
      .or(page.locator('input[placeholder*="sk"]'))
      .first();
    // Eye / EyeOff toggle button
    this.showHideKeyButton = page
      .getByRole('button', { name: /show api key|hide api key/i })
      .first();
    // Provider dropdown
    this.providerSelect = page.locator('select#default-provider');
    // Language dropdown
    this.languageSelect = page.locator('select#default-language');
    // Theme toggle — aria-label="Toggle dark mode"
    this.themeToggle = page.getByRole('button', { name: /toggle dark mode/i });
    // Save button
    this.saveButton = page.getByRole('button', { name: /save settings/i });
    // "Saved!" confirmation text (visible for 2s after save)
    this.savedConfirmation = page.getByText(/saved!/i);
  }

  async goto() {
    await this.page.goto('/app/settings');
  }

  async fillApiKey(key: string) {
    await this.apiKeyInput.fill(key);
  }

  async selectProvider(value: 'openai' | 'anthropic' | 'google') {
    await this.providerSelect.selectOption(value);
  }

  async selectLanguage(value: string) {
    await this.languageSelect.selectOption(value);
  }

  async toggleTheme() {
    await this.themeToggle.click();
  }

  async save() {
    await this.saveButton.click();
  }
}
