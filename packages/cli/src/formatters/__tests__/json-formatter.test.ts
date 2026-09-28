/**
 * Tests for json-formatter — pretty-print JSON with optional chalk syntax highlighting.
 */

import { describe, it, expect } from 'vitest';
import { formatJson } from '../json-formatter.js';

describe('formatJson', () => {
  it('returns a string', () => {
    const result = formatJson({ key: 'value' });
    expect(typeof result).toBe('string');
  });

  it('produces valid JSON when pretty is true and colorize is false', () => {
    const data = { name: 'FHIRBridge', version: '0.1.0', active: true };
    const result = formatJson(data, true, false);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result) as typeof data;
    expect(parsed.name).toBe('FHIRBridge');
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.active).toBe(true);
  });

  it('produces compact JSON when pretty is false', () => {
    const data = { a: 1, b: 2 };
    const result = formatJson(data, false, false);
    expect(result).toBe('{"a":1,"b":2}');
  });

  it('pretty-prints with indentation when pretty is true', () => {
    const data = { nested: { value: 42 } };
    const result = formatJson(data, true, false);
    expect(result).toContain('\n');
    expect(result).toContain('  ');
  });

  it('handles null value', () => {
    const result = formatJson(null, true, false);
    expect(result).toBe('null');
  });

  it('handles array', () => {
    const data = [1, 2, 3];
    const result = formatJson(data, true, false);
    const parsed = JSON.parse(result) as number[];
    expect(parsed).toEqual([1, 2, 3]);
  });

  it('handles empty object', () => {
    const result = formatJson({}, true, false);
    expect(result).toBe('{}');
  });

  it('handles nested objects', () => {
    const data = {
      profiles: { 'local-hapi': { type: 'fhir-endpoint', baseUrl: 'http://localhost:8080' } },
    };
    const result = formatJson(data, true, false);
    const parsed = JSON.parse(result) as typeof data;
    expect(parsed.profiles['local-hapi'].baseUrl).toBe('http://localhost:8080');
  });

  it('colorized output is non-empty string', () => {
    const data = { provider: 'claude', count: 5 };
    const result = formatJson(data, true, true);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('colorized output contains the original values', () => {
    const data = { provider: 'claude' };
    const result = formatJson(data, true, true);
    // Even with escape codes the actual value text is present
    expect(result).toContain('claude');
  });
});
