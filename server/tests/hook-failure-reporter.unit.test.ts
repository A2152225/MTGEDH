import { afterEach, describe, expect, it } from 'vitest';
import {
  STRICT_HOOKS_ENV,
  formatHookFailuresForAssert,
  getHookFailureCounts,
  getHookFailures,
  isStrictHooksEnabled,
  reportHookFailure,
  resetHookFailures,
} from '../src/utils/hookFailureReporter.js';

describe('hookFailureReporter', () => {
  afterEach(() => {
    resetHookFailures();
    delete process.env[STRICT_HOOKS_ENV];
  });

  it('records failures in a ring buffer and exposes counts', () => {
    expect(getHookFailures()).toEqual([]);
    reportHookFailure('test.tag', new Error('boom'), { cardName: 'Lightning Bolt', source: 'unit' });
    const failures = getHookFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.tag).toBe('test.tag');
    expect(failures[0]?.message).toBe('boom');
    expect(failures[0]?.name).toBe('Error');
    expect(failures[0]?.ctx?.cardName).toBe('Lightning Bolt');
    expect(failures[0]?.stack).toMatch(/boom/);
    expect(getHookFailureCounts()).toEqual({ 'test.tag': 1 });
    reportHookFailure('test.tag', 'string-err');
    expect(getHookFailures()).toHaveLength(2);
    expect(getHookFailureCounts()).toEqual({ 'test.tag': 2 });
    expect(formatHookFailuresForAssert()).toMatch(/test.tag card=Lightning Bolt source=unit: Error: boom/);
  });

  it('resetHookFailures clears the ring and counts', () => {
    reportHookFailure('a', new Error('x'));
    resetHookFailures();
    expect(getHookFailures()).toEqual([]);
    expect(getHookFailureCounts()).toEqual({});
  });

  it('does not rethrow when MTGEDH_STRICT_HOOKS is unset', () => {
    delete process.env[STRICT_HOOKS_ENV];
    expect(isStrictHooksEnabled()).toBe(false);
    expect(() => reportHookFailure('soft', new Error('kept'))).not.toThrow();
    expect(getHookFailures()).toHaveLength(1);
  });

  it('rethrows the original error when MTGEDH_STRICT_HOOKS=1', () => {
    process.env[STRICT_HOOKS_ENV] = '1';
    expect(isStrictHooksEnabled()).toBe(true);
    const err = new Error('strict-boom');
    expect(() => reportHookFailure('strict.tag', err, { cardName: 'Shock' })).toThrow(err);
    expect(getHookFailures()).toHaveLength(1);
    expect(getHookFailures()[0]?.tag).toBe('strict.tag');
  });
});
