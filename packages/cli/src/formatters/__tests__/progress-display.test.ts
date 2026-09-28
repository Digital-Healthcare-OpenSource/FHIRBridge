/**
 * Tests for progress-display — wraps cli-progress for long-running operations.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createProgress, createProgressBar, createNoopProgressBar } from '../progress-display.js';

describe('createNoopProgressBar', () => {
  it('returns an object with update, increment, stop methods', () => {
    const bar = createNoopProgressBar();
    expect(typeof bar.update).toBe('function');
    expect(typeof bar.increment).toBe('function');
    expect(typeof bar.stop).toBe('function');
  });

  it('update does not throw', () => {
    const bar = createNoopProgressBar();
    expect(() => bar.update(5)).not.toThrow();
  });

  it('increment does not throw', () => {
    const bar = createNoopProgressBar();
    expect(() => bar.increment(1)).not.toThrow();
  });

  it('stop does not throw', () => {
    const bar = createNoopProgressBar();
    expect(() => bar.stop()).not.toThrow();
  });

  it('increment with no args does not throw', () => {
    const bar = createNoopProgressBar();
    expect(() => bar.increment()).not.toThrow();
  });

  it('update with payload does not throw', () => {
    const bar = createNoopProgressBar();
    expect(() => bar.update(3, { label: 'step' })).not.toThrow();
  });
});

describe('createProgress — non-TTY environment', () => {
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
    });
  });

  it('returns noop bar when stdout is not TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    const bar = createProgress(10, 'Testing');
    expect(typeof bar.update).toBe('function');
    expect(typeof bar.stop).toBe('function');
    expect(() => bar.update(5)).not.toThrow();
    expect(() => bar.stop()).not.toThrow();
  });

  it('returned bar satisfies ProgressBar interface', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    const bar = createProgress(5, 'Label');
    expect(bar).toHaveProperty('update');
    expect(bar).toHaveProperty('increment');
    expect(bar).toHaveProperty('stop');
  });

  it('noop bar update is callable multiple times', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    const bar = createProgress(100, 'Multi');
    expect(() => {
      bar.update(10);
      bar.update(50);
      bar.update(100);
      bar.stop();
    }).not.toThrow();
  });
});

describe('createProgressBar', () => {
  it('returns an object with update/increment/stop interface', () => {
    // Force non-TTY so createProgress uses noop — but test createProgressBar directly
    // createProgressBar calls cliProgress.SingleBar internally; in test env (non-TTY)
    // the SingleBar should still instantiate without rendering to terminal
    const bar = createProgressBar(10, 'Importing');
    expect(typeof bar.update).toBe('function');
    expect(typeof bar.increment).toBe('function');
    expect(typeof bar.stop).toBe('function');
  });

  it('calling stop on returned bar does not throw', () => {
    const bar = createProgressBar(5, 'Test');
    expect(() => bar.stop()).not.toThrow();
  });

  it('calling update on returned bar does not throw', () => {
    const bar = createProgressBar(10, 'Test');
    expect(() => bar.update(3)).not.toThrow();
    bar.stop();
  });

  it('calling increment on returned bar does not throw', () => {
    const bar = createProgressBar(10, 'Test');
    expect(() => bar.increment()).not.toThrow();
    bar.stop();
  });
});
