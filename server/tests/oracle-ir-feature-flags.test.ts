import { afterEach, describe, expect, it } from 'vitest';

import {
  isOracleIrSpellLegacyForced,
  isOracleIrSpellPrimaryEnabled,
  isOracleIrTriggerLegacyForced,
  isOracleIrTriggerPrimaryEnabled,
  parseOracleIrFeatureFlag,
} from '../src/state/modules/oracleIrFeatureFlags.js';

describe('oracleIrFeatureFlags', () => {
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
  const previousTriggerLegacy = process.env.ORACLE_IR_TRIGGER_LEGACY;
  const previousSpellPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousSpellLegacy = process.env.ORACLE_IR_SPELL_LEGACY;

  afterEach(() => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
    if (previousTriggerLegacy === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    } else {
      process.env.ORACLE_IR_TRIGGER_LEGACY = previousTriggerLegacy;
    }
    if (previousSpellPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousSpellPrimary;
    }
    if (previousSpellLegacy === undefined) {
      delete process.env.ORACLE_IR_SPELL_LEGACY;
    } else {
      process.env.ORACLE_IR_SPELL_LEGACY = previousSpellLegacy;
    }
  });

  it('parses common truthy/falsy env values', () => {
    expect(parseOracleIrFeatureFlag('1')).toBe(true);
    expect(parseOracleIrFeatureFlag('true')).toBe(true);
    expect(parseOracleIrFeatureFlag('0')).toBe(false);
    expect(parseOracleIrFeatureFlag('off')).toBe(false);
    expect(parseOracleIrFeatureFlag(undefined)).toBeUndefined();
    expect(parseOracleIrFeatureFlag('maybe')).toBeUndefined();
  });

  it('enables trigger primary by default', () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);
    expect(isOracleIrTriggerLegacyForced()).toBe(false);
  });

  it('opts out trigger primary via PRIMARY=0 only (P4e — LEGACY ignored)', () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    process.env.ORACLE_IR_TRIGGER_LEGACY = '1';
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(true);
    expect(isOracleIrTriggerLegacyForced()).toBe(false);

    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '0';
    expect(isOracleIrTriggerPrimaryEnabled()).toBe(false);
    expect(isOracleIrTriggerLegacyForced()).toBe(true);
  });

  it('enables spell primary by default', () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    expect(isOracleIrSpellPrimaryEnabled()).toBe(true);
    expect(isOracleIrSpellLegacyForced()).toBe(false);
  });

  it('opts spell primary out via PRIMARY=0 only (P4e — LEGACY ignored)', () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    process.env.ORACLE_IR_SPELL_LEGACY = '1';
    expect(isOracleIrSpellPrimaryEnabled()).toBe(true);
    expect(isOracleIrSpellLegacyForced()).toBe(false);

    delete process.env.ORACLE_IR_SPELL_LEGACY;
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    expect(isOracleIrSpellPrimaryEnabled()).toBe(false);
    expect(isOracleIrSpellLegacyForced()).toBe(true);
  });
});
