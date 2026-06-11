import { afterEach, describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  extractModalModesForSpellCast,
  matchModalModeOptions,
} from '../src/utils/oraclePromptContext.js';
import { normalizeOracleIrSelectedModeIds } from '../src/state/modules/oracleIrModeSelection.js';

describe('oracleIrModeSelection', () => {
  it('maps cast-time mode_1 ids to IR choose_mode labels', () => {
    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const steps = (parseOracleTextToIR(oracleText, 'Test Charm').abilities || [])
      .flatMap((ability) => ability.steps || []);

    expect(normalizeOracleIrSelectedModeIds(steps, ['mode_1'])).toEqual(['Mode 1']);
    expect(normalizeOracleIrSelectedModeIds(steps, ['mode_2'])).toEqual(['Mode 2']);
    expect(normalizeOracleIrSelectedModeIds(steps, ['Mode 1'])).toEqual(['Mode 1']);
  });

  it('passes through ids when there is no choose_mode step', () => {
    expect(normalizeOracleIrSelectedModeIds([], ['mode_1'])).toEqual(['mode_1']);
  });

  it('maps cast-time mode ids for trigger-style choose_mode text', () => {
    const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
    const steps = (parseOracleTextToIR(oracleText, 'Charm Trigger').abilities || [])
      .flatMap((ability) => ability.steps || []);

    expect(normalizeOracleIrSelectedModeIds(steps, ['mode_2'])).toEqual(['Mode 2']);
  });

  it('uses IR mode labels for cast-time modal options when spell primary is enabled', () => {
    const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';

    try {
      const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
      const modalInfo = extractModalModesForSpellCast(oracleText, 'Test Charm');
      expect(modalInfo?.options.map((option) => option.id)).toEqual(['Mode 1', 'Mode 2']);

      const selectedText = matchModalModeOptions(modalInfo!, ['Mode 1']).map((option) => option.raw);
      expect(selectedText).toEqual(['Draw a card.']);

      const legacySelected = matchModalModeOptions(modalInfo!, ['mode_1']).map((option) => option.raw);
      expect(legacySelected).toEqual(['Draw a card.']);
    } finally {
      if (previousPrimary === undefined) {
        delete process.env.ORACLE_IR_SPELL_PRIMARY;
      } else {
        process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
      }
    }
  });

  it('keeps legacy mode_ ids when spell primary is disabled', () => {
    const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
    const previousLegacy = process.env.ORACLE_IR_SPELL_LEGACY;
    process.env.ORACLE_IR_SPELL_PRIMARY = '0';
    delete process.env.ORACLE_IR_SPELL_LEGACY;

    try {
      const oracleText = 'Choose one —\n• Draw a card.\n• You gain 2 life.';
      const modalInfo = extractModalModesForSpellCast(oracleText, 'Test Charm');
      expect(modalInfo?.options.map((option) => option.id)).toEqual(['mode_1', 'mode_2']);
    } finally {
      if (previousPrimary === undefined) {
        delete process.env.ORACLE_IR_SPELL_PRIMARY;
      } else {
        process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
      }
      if (previousLegacy === undefined) {
        delete process.env.ORACLE_IR_SPELL_LEGACY;
      } else {
        process.env.ORACLE_IR_SPELL_LEGACY = previousLegacy;
      }
    }
  });
});
