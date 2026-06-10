import { afterEach, describe, expect, it } from 'vitest';

import {
  isTriggerEffectOwnedByOracleIrPrimary,
  isTriggerStepKindRetiredUnderOracleIrPrimary,
  ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS,
  shouldSkipLegacyTriggerRegexHandlers,
  shouldSkipTriggerUncategorizedFallback,
} from '../src/state/modules/oracleIrTriggerLegacyRouting.js';

describe('oracleIrTriggerLegacyRouting', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('does not skip legacy handlers when primary mode is off', () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    expect(isTriggerEffectOwnedByOracleIrPrimary('Draw a card.', 'Creature')).toBe(false);
    expect(shouldSkipLegacyTriggerRegexHandlers('Draw a card.', 'Creature')).toBe(false);
  });

  it('skips legacy handlers for wired draw/gain-life trigger text in primary mode', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(isTriggerEffectOwnedByOracleIrPrimary('Draw two cards.', 'Mulldrifter')).toBe(true);
    expect(isTriggerEffectOwnedByOracleIrPrimary('You gain 1 life.', 'Soul Warden')).toBe(true);
    expect(shouldSkipTriggerUncategorizedFallback('Draw a card.', 'ETB Creature')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('You gain 3 life.', 'Fountain')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Scry 1.', 'Opt')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Surveil 2.', 'Darkblade Agent')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player discards a card.', 'Liliana')).toBe(true);
  });

  it('does not skip unknown trigger fragments', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(isTriggerEffectOwnedByOracleIrPrimary('', 'Source')).toBe(false);
    expect(shouldSkipLegacyTriggerRegexHandlers('Do something utterly non-oracular.', 'Source')).toBe(false);
  });

  it('documents retired trigger step kinds with parity coverage', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('draw')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('gain_life')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('scry')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('create_token')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('destroy')).toBe(true);
    expect(ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has('copy_permanent')).toBe(true);
    expect(isTriggerStepKindRetiredUnderOracleIrPrimary('draw')).toBe(true);
    expect(isTriggerStepKindRetiredUnderOracleIrPrimary('create_token')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each opponent loses 3 life.', 'Ob Nixilis')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player discards a card.', 'Liliana')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Each player draws a card.', 'Howling Mine')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers("That creature's controller loses 2 life.", 'Blood Seeker')).toBe(true);
    expect(shouldSkipLegacyTriggerRegexHandlers('Target player draws a card.', 'Harmonize')).toBe(true);
  });
});
