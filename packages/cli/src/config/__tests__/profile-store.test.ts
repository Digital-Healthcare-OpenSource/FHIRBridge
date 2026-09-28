/**
 * Tests for profile-store — CRUD operations for named connection profiles.
 * Uses a fixed temp config path; mocks config-manager to redirect file I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Fixed path — safe to reference in hoisted factory (no top-level variable reference)
const TEMP_CONFIG_PATH = join(tmpdir(), `.fhirbridgerc-profile-store-${process.pid}.json`);

// Must be defined before vi.mock because factory is hoisted
vi.mock('../../utils/logger.js', () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  print: vi.fn(),
  configureLogger: vi.fn(),
}));

// Redirect config-manager to use temp file
vi.mock('../../config/config-manager.js', () => {
  // All imports inside factory are fine — they resolve lazily
  const path = join(require('os').tmpdir(), `.fhirbridgerc-profile-store-${process.pid}.json`);

  interface Profile {
    type: string;
    baseUrl?: string;
    apiKey?: string;
    clientSecret?: string;
    [key: string]: unknown;
  }

  interface Config {
    defaultProvider: string;
    defaultLanguage: string;
    profiles: Record<string, Profile>;
  }

  const DEFAULT: Config = { defaultProvider: 'claude', defaultLanguage: 'en', profiles: {} };

  function loadConfig(): Config {
    const { existsSync: fse, readFileSync: frs } = require('fs') as typeof import('fs');
    if (!fse(path)) return { ...DEFAULT, profiles: {} };
    try {
      const parsed = JSON.parse(frs(path, 'utf8') as string) as Partial<Config>;
      return { ...DEFAULT, ...parsed, profiles: parsed.profiles ?? {} };
    } catch {
      return { ...DEFAULT, profiles: {} };
    }
  }

  function saveConfig(config: Config): void {
    const { writeFileSync: fwfs, chmodSync: fcs } = require('fs') as typeof import('fs');
    fwfs(path, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fcs(path, 0o600);
    } catch {
      /* ignore */
    }
  }

  function warnIfApiKeyInConfig(_profile: Profile): void {
    // no-op in tests
  }

  return {
    CONFIG_PATH: path,
    loadConfig,
    saveConfig,
    warnIfApiKeyInConfig,
    getConfigValue: (key: string) => {
      const cfg = loadConfig() as unknown as Record<string, unknown>;
      return cfg[key];
    },
    setConfigValue: (key: string, value: string) => {
      const cfg = loadConfig() as unknown as Record<string, unknown>;
      cfg[key] = value;
      saveConfig(cfg as unknown as Config);
    },
  };
});

import {
  listProfiles,
  getProfile,
  setProfile,
  removeProfile,
  requireProfile,
} from '../profile-store.js';

describe('profile-store', () => {
  beforeEach(() => {
    try {
      unlinkSync(TEMP_CONFIG_PATH);
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    try {
      unlinkSync(TEMP_CONFIG_PATH);
    } catch {
      /* ignore */
    }
  });

  it('listProfiles returns empty array when no profiles set', () => {
    const profiles = listProfiles();
    expect(profiles).toEqual([]);
  });

  it('setProfile adds a profile', () => {
    setProfile('local-hapi', { type: 'fhir-endpoint', baseUrl: 'http://localhost:8080/fhir' });
    const names = listProfiles();
    expect(names).toContain('local-hapi');
  });

  it('getProfile retrieves an added profile', () => {
    setProfile('my-server', { type: 'fhir-endpoint', baseUrl: 'http://hapi.fhir.org/baseR4' });
    const profile = getProfile('my-server');
    expect(profile).toBeDefined();
    expect(profile?.baseUrl).toBe('http://hapi.fhir.org/baseR4');
    expect(profile?.type).toBe('fhir-endpoint');
  });

  it('getProfile returns undefined for unknown profile', () => {
    const profile = getProfile('nonexistent');
    expect(profile).toBeUndefined();
  });

  it('listProfiles returns all added profiles', () => {
    setProfile('alpha', { type: 'fhir-endpoint' });
    setProfile('beta', { type: 'csv' });
    const names = listProfiles();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('removeProfile removes an existing profile', () => {
    setProfile('to-remove', { type: 'fhir-endpoint' });
    removeProfile('to-remove');
    expect(getProfile('to-remove')).toBeUndefined();
    expect(listProfiles()).not.toContain('to-remove');
  });

  it('removeProfile throws for non-existent profile', () => {
    expect(() => removeProfile('ghost')).toThrow('Profile not found: ghost');
  });

  it('setProfile overwrites existing profile', () => {
    setProfile('myprofile', { type: 'fhir-endpoint', baseUrl: 'http://old.org' });
    setProfile('myprofile', { type: 'fhir-endpoint', baseUrl: 'http://new.org' });
    expect(getProfile('myprofile')?.baseUrl).toBe('http://new.org');
  });

  it('setProfile rejects invalid profile names', () => {
    expect(() => setProfile('bad name!', { type: 'fhir-endpoint' })).toThrow(
      /Invalid profile name/,
    );
  });

  it('setProfile allows valid alphanumeric names with hyphens/underscores', () => {
    expect(() => setProfile('valid-name_1', { type: 'fhir-endpoint' })).not.toThrow();
  });

  it('requireProfile returns profile when it exists', () => {
    setProfile('required', { type: 'fhir-endpoint', baseUrl: 'http://test.org' });
    const profile = requireProfile('required');
    expect(profile.baseUrl).toBe('http://test.org');
  });

  it('requireProfile throws helpful error when profile not found', () => {
    expect(() => requireProfile('missing-profile')).toThrow(/missing-profile/);
  });

  it('profiles are persisted to temp file', () => {
    setProfile('persistent', { type: 'csv' });
    expect(existsSync(TEMP_CONFIG_PATH)).toBe(true);
    const names = listProfiles();
    expect(names).toContain('persistent');
  });
});
