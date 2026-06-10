import { afterEach, describe, expect, it } from 'vitest';

import {
  isCategorizeOpcodeRetiredUnderOracleIrPrimary,
  isSpellEffectOwnedByOracleIrPrimary,
  ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS,
  shouldSkipLegacySpellCategorizeExecution,
  shouldSkipLegacySpellRegexHandlers,
  shouldSkipSpellUncategorizedFallback,
} from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { categorizeSpell, categorizeSpellWithoutPrimaryRetirement } from '../src/rules-engine/targeting.js';

describe('oracleIrSpellLegacyRouting', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
  });

  it('does not skip legacy handlers when primary mode is off', () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    expect(isSpellEffectOwnedByOracleIrPrimary('Draw two cards.', 'Divination')).toBe(false);
    expect(shouldSkipLegacySpellRegexHandlers('Draw two cards.', 'Divination')).toBe(false);
    expect(shouldSkipLegacySpellCategorizeExecution('Draw two cards.', 'Divination')).toBe(false);
  });

  it('skips legacy handlers for wired draw/gain-life spell text in primary mode', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(isSpellEffectOwnedByOracleIrPrimary('Draw two cards.', 'Test Divination')).toBe(true);
    expect(isSpellEffectOwnedByOracleIrPrimary('You gain 5 life.', 'Test Healing')).toBe(true);
    expect(shouldSkipSpellUncategorizedFallback('Scry 2.', 'Test Scry')).toBe(true);
    expect(shouldSkipLegacySpellRegexHandlers('You gain 3 life.', 'Healing Salve')).toBe(true);
    expect(shouldSkipLegacySpellCategorizeExecution('Surveil 2.', 'Test Surveil')).toBe(true);
  });

  it('documents retired categorizeSpell opcodes with parity coverage', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS.has('DRAW_CARDS')).toBe(true);
    expect(ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS.has('SCRY')).toBe(true);
    expect(isCategorizeOpcodeRetiredUnderOracleIrPrimary('DRAW_CARDS')).toBe(true);
    expect(isCategorizeOpcodeRetiredUnderOracleIrPrimary('COUNTER_TARGET_SPELL')).toBe(false);
    expect(categorizeSpell('Test Divination', 'Draw two cards.')).toBeNull();
    expect(categorizeSpellWithoutPrimaryRetirement('Test Divination', 'Draw two cards.')?.op).toBe('DRAW_CARDS');
  });

  it('does not skip unknown spell fragments', () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    expect(isSpellEffectOwnedByOracleIrPrimary('', 'Spell')).toBe(false);
    expect(shouldSkipLegacySpellRegexHandlers('Do something utterly non-oracular.', 'Spell')).toBe(false);
    expect(shouldSkipLegacySpellCategorizeExecution('Do something utterly non-oracular.', 'Spell')).toBe(false);
  });
});
