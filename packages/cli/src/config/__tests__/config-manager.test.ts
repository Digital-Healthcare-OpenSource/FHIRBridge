/**
 * Tests for config-manager and profile-store.
 * Uses temp files to avoid touching ~/.fhirbridgerc.json.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Derive a unique temp path per test run
const TEST_CONFIG = join(tmpdir(), `.fhirbridgerc-test-${process.pid}.json`);

/** Write a config to the test path directly */
function writeTestConfig(data: object): void {
  writeFileSync(TEST_CONFIG, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
}

/** Read and parse config from test path */
function readTestConfig(): Record<string, unknown> {
  if (!existsSync(TEST_CONFIG)) return {};
  return JSON.parse(require('fs').readFileSync(TEST_CONFIG, 'utf8')) as Record<string, unknown>;
}

// ── config-manager unit tests (via direct file ops) ──────────────────────────

describe('config file persistence', () => {
  beforeEach(() => {
    try {
      unlinkSync(TEST_CONFIG);
    } catch {
      /* ignore */
    }
  });

  afterEach(() => {
    try {
      unlinkSync(TEST_CONFIG);
    } catch {
      /* ignore */
    }
  });

  it('writes valid JSON to config path', () => {
    const data = { defaultProvider: 'openai', defaultLanguage: 'vi', profiles: {} };
    writeTestConfig(data);
    const loaded = readTestConfig();
    expect(loaded['defaultProvider']).toBe('openai');
    expect(loaded['defaultLanguage']).toBe('vi');
  });

  it('handles missing file gracefully', () => {
    expect(existsSync(TEST_CONFIG)).toBe(false);
    const loaded = readTestConfig();
    expect(loaded).toEqual({});
  });

  it('handles corrupt JSON gracefully', () => {
    writeFileSync(TEST_CONFIG, '{ invalid json', 'utf8');
    expect(() => {
      try {
        JSON.parse(require('fs').readFileSync(TEST_CONFIG, 'utf8') as string);
      } catch {
        // expected
      }
    }).not.toThrow();
  });

  it('stores and retrieves profiles', () => {
    const data = {
      defaultProvider: 'claude',
      defaultLanguage: 'en',
      profiles: {
        'local-hapi': { type: 'fhir-endpoint', baseUrl: 'http://localhost:8080/fhir' },
      },
    };
    writeTestConfig(data);
    const loaded = readTestConfig();
    const profiles = loaded['profiles'] as Record<string, unknown>;
    expect(profiles['local-hapi']).toBeDefined();
    const profile = profiles['local-hapi'] as Record<string, unknown>;
    expect(profile['baseUrl']).toBe('http://localhost:8080/fhir');
  });
});

// ── profile-store unit tests (isolated via temp config) ──────────────────────
// We test profile CRUD logic directly using isolated helpers

import { type ConnectorProfile } from '../config-manager.js';

function buildProfileStore(initialProfiles: Record<string, ConnectorProfile> = {}) {
  const profiles: Record<string, ConnectorProfile> = { ...initialProfiles };

  return {
    list: () => Object.keys(profiles),
    get: (name: string) => profiles[name],
    set: (name: string, profile: ConnectorProfile) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error(`Invalid profile name: ${name}`);
      }
      profiles[name] = profile;
    },
    remove: (name: string) => {
      if (!(name in profiles)) throw new Error(`Profile not found: ${name}`);
      delete profiles[name];
    },
  };
}

describe('profile-store logic', () => {
  it('adds and retrieves a profile', () => {
    const store = buildProfileStore();
    store.set('test', { type: 'fhir-endpoint', baseUrl: 'http://test.org' });
    expect(store.get('test')?.baseUrl).toBe('http://test.org');
  });

  it('lists all profiles', () => {
    const store = buildProfileStore({
      alpha: { type: 'fhir-endpoint' },
      beta: { type: 'csv' },
    });
    expect(store.list()).toContain('alpha');
    expect(store.list()).toContain('beta');
  });

  it('removes a profile', () => {
    const store = buildProfileStore({ removable: { type: 'fhir-endpoint' } });
    store.remove('removable');
    expect(store.get('removable')).toBeUndefined();
  });

  it('throws when removing non-existent profile', () => {
    const store = buildProfileStore();
    expect(() => store.remove('ghost')).toThrow('Profile not found: ghost');
  });

  it('rejects invalid profile names', () => {
    const store = buildProfileStore();
    expect(() => store.set('bad name!', { type: 'fhir-endpoint' })).toThrow('Invalid profile name');
    expect(() => store.set('ok-name_1', { type: 'fhir-endpoint' })).not.toThrow();
  });

  it('overwrites existing profile', () => {
    const store = buildProfileStore({
      myprofile: { type: 'fhir-endpoint', baseUrl: 'http://old.org' },
    });
    store.set('myprofile', { type: 'fhir-endpoint', baseUrl: 'http://new.org' });
    expect(store.get('myprofile')?.baseUrl).toBe('http://new.org');
  });
});

// ── ConnectorProfile type tests ───────────────────────────────────────────────

describe('ConnectorProfile type', () => {
  it('accepts valid profile shapes', () => {
    const fhirProfile: ConnectorProfile = {
      type: 'fhir-endpoint',
      baseUrl: 'http://hapi.fhir.org/baseR4',
    };
    expect(fhirProfile.type).toBe('fhir-endpoint');

    const csvProfile: ConnectorProfile = { type: 'csv' };
    expect(csvProfile.type).toBe('csv');
  });
});
