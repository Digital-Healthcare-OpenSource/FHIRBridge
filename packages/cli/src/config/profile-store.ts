/**
 * Profile store — CRUD operations for named connection profiles in config.
 */

import {
  loadConfig,
  saveConfig,
  warnIfApiKeyInConfig,
  type ConnectorProfile,
} from './config-manager.js';
import { error } from '../utils/logger.js';

/** List all profile names. */
export function listProfiles(): string[] {
  return Object.keys(loadConfig().profiles);
}

/** Get a specific profile by name; returns undefined if not found. */
export function getProfile(name: string): ConnectorProfile | undefined {
  return loadConfig().profiles[name];
}

/** Add or overwrite a profile. Warns if API key is present. */
export function setProfile(name: string, profile: ConnectorProfile): void {
  validateProfileName(name);
  warnIfApiKeyInConfig(profile);
  const config = loadConfig();
  config.profiles[name] = profile;
  saveConfig(config);
}

/** Remove a profile by name. Throws if not found. */
export function removeProfile(name: string): void {
  const config = loadConfig();
  if (!(name in config.profiles)) {
    error(`Profile "${name}" not found.`);
    throw new Error(`Profile not found: ${name}`);
  }
  delete config.profiles[name];
  saveConfig(config);
}

/** Check a profile exists; throws with helpful message if not. */
export function requireProfile(name: string): ConnectorProfile {
  const profile = getProfile(name);
  if (!profile) {
    throw new Error(`Profile "${name}" not found. Run: fhirbridge config add-profile ${name}`);
  }
  return profile;
}

/** Validate profile name is safe (alphanumeric + dash/underscore). */
function validateProfileName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use only letters, numbers, hyphens, and underscores.`,
    );
  }
}
