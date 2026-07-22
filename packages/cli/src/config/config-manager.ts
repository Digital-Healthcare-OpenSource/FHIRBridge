/**
 * Config manager — read/write ~/.fhirbridgerc.json.
 * Schema: { defaultProvider, defaultLanguage, profiles: { [name]: ConnectorConfig } }
 * Sensitive fields (API keys) are stored in plaintext — users are warned to use env vars.
 */

import { readFileSync, writeFileSync, existsSync, statSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { warn } from '../utils/logger.js';

export const CONFIG_PATH = join(homedir(), '.fhirbridgerc.json');

export type SupportedProvider = 'claude' | 'openai' | 'gemini';
export type SupportedLanguage = 'en' | 'vi' | 'ja' | 'ko' | 'zh';

export interface ConnectorProfile {
  type: 'fhir-endpoint' | 'epic' | 'cerner' | 'csv';
  baseUrl?: string;
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  [key: string]: unknown;
}

export interface FhirbridgeConfig {
  defaultProvider: SupportedProvider;
  defaultLanguage: SupportedLanguage;
  profiles: Record<string, ConnectorProfile>;
}

const DEFAULT_CONFIG: FhirbridgeConfig = {
  defaultProvider: 'claude',
  defaultLanguage: 'en',
  profiles: {},
};

/** Load config from ~/.fhirbridgerc.json, returning defaults if not found. */
export function loadConfig(): FhirbridgeConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG, profiles: {} };

  try {
    // Warn if file is world-readable
    const stat = statSync(CONFIG_PATH);
    const mode = stat.mode & 0o777;
    if (mode & 0o044) {
      warn(
        `Config file ${CONFIG_PATH} may be readable by others (mode: ${mode.toString(8)}). Consider: chmod 600 ~/.fhirbridgerc.json`,
      );
    }

    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FhirbridgeConfig>;
    return { ...DEFAULT_CONFIG, ...parsed, profiles: parsed.profiles ?? {} };
  } catch (err) {
    warn(`Could not read config: ${(err as Error).message}. Using defaults.`);
    return { ...DEFAULT_CONFIG, profiles: {} };
  }
}

/** Persist config to ~/.fhirbridgerc.json with restricted permissions. */
export function saveConfig(config: FhirbridgeConfig): void {
  const json = JSON.stringify(config, null, 2);
  writeFileSync(CONFIG_PATH, json, { encoding: 'utf8', mode: 0o600 });
  // Ensure permissions even on existing files
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* ignore */
  }
}

/** Get a single config key value. */
export function getConfigValue(key: keyof FhirbridgeConfig): unknown {
  const config = loadConfig();
  return config[key];
}

/** Set a top-level config key (not profiles). */
export function setConfigValue(key: 'defaultProvider' | 'defaultLanguage', value: string): void {
  const config = loadConfig();
  (config as unknown as Record<string, unknown>)[key] = value;
  saveConfig(config);
}

/** Check if an API key is present in profiles — warn about plaintext storage. */
export function warnIfApiKeyInConfig(profile: ConnectorProfile): void {
  if (profile.apiKey) {
    warn('API key stored in config file. Consider using FHIRBRIDGE_API_KEY env var instead.');
  }
  if (profile.clientSecret) {
    warn(
      'Client secret stored in config file. Consider using FHIRBRIDGE_CLIENT_SECRET env var instead.',
    );
  }
}
