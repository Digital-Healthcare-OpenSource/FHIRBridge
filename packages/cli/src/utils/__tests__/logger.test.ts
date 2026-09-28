/**
 * Tests for logger utility — colored console output functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  info,
  success,
  warn,
  error,
  debug,
  print,
  configureLogger,
  useStderrForStatus,
} from '../logger.js';

describe('logger function existence', () => {
  it('info is a function', () => {
    expect(typeof info).toBe('function');
  });

  it('success is a function', () => {
    expect(typeof success).toBe('function');
  });

  it('warn is a function', () => {
    expect(typeof warn).toBe('function');
  });

  it('error is a function', () => {
    expect(typeof error).toBe('function');
  });

  it('debug is a function', () => {
    expect(typeof debug).toBe('function');
  });

  it('print is a function', () => {
    expect(typeof print).toBe('function');
  });

  it('configureLogger is a function', () => {
    expect(typeof configureLogger).toBe('function');
  });
});

describe('logger output', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Reset to non-quiet, non-verbose defaults
    configureLogger({ verbose: false, quiet: false });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('info writes to stdout', () => {
    info('test info message');
    expect(stdoutSpy).toHaveBeenCalled();
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('test info message');
  });

  it('success writes to stdout', () => {
    success('test success message');
    expect(stdoutSpy).toHaveBeenCalled();
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('test success message');
  });

  it('warn writes to stderr', () => {
    warn('test warning');
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('test warning');
  });

  it('error writes to stderr', () => {
    error('test error');
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('test error');
  });

  it('print writes to stdout without prefix', () => {
    print('plain output');
    expect(stdoutSpy).toHaveBeenCalled();
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('plain output');
  });

  it('debug does not write when verbose is false', () => {
    configureLogger({ verbose: false, quiet: false });
    debug('debug message');
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).not.toContain('debug message');
  });

  it('debug writes when verbose is true', () => {
    configureLogger({ verbose: true, quiet: false });
    debug('debug verbose message');
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('debug verbose message');
  });
});

describe('configureLogger quiet mode', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    // Reset to defaults after each test
    configureLogger({ verbose: false, quiet: false });
  });

  it('quiet mode suppresses info', () => {
    configureLogger({ quiet: true });
    info('should be suppressed');
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).not.toContain('should be suppressed');
  });

  it('quiet mode suppresses success', () => {
    configureLogger({ quiet: true });
    success('should be suppressed');
    const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).not.toContain('should be suppressed');
  });

  it('quiet mode does NOT suppress error', () => {
    configureLogger({ quiet: true });
    error('critical error');
    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('critical error');
  });
});

describe('useStderrForStatus (data on stdout stays parseable)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    configureLogger({ quiet: false });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    useStderrForStatus(false);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('moves info and success lines to stderr while print() keeps stdout', () => {
    useStderrForStatus(true);
    info('Fetching…');
    success('Exported 5 resources');
    print('{"resourceType":"Bundle"}');
    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(String(stdoutSpy.mock.calls[0]![0])).toContain('"Bundle"');
  });

  it('defaults to stdout for status lines', () => {
    info('hello');
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
