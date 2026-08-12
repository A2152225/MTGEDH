import { describe, expect, it } from 'vitest';

import {
  extractModalModesForSpellCast,
  extractModalModesFromOracleText,
} from '../src/utils/oraclePromptContext.js';

describe('extractModalModesFromOracleText', () => {
  it('parses single-line choose-one modal text separated by semicolon-or branches', () => {
    const modalInfo = extractModalModesFromOracleText(
      'Choose one - Target opponent discards two cards and loses 2 life; or return target creature card with mana value 3 or less from your graveyard to your hand.'
    );

    expect(modalInfo).toBeDefined();
    expect(modalInfo?.minModes).toBe(1);
    expect(modalInfo?.maxModes).toBe(1);
    expect(modalInfo?.options.map((option) => option.raw)).toEqual([
      'Target opponent discards two cards and loses 2 life',
      'return target creature card with mana value 3 or less from your graveyard to your hand',
    ]);
  });

  it('parses Season {P}-budget modes with repeats', () => {
    const modalInfo = extractModalModesFromOracleText(
      'Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — Put a +1/+1 counter on a creature you control. It gains vigilance and trample until end of turn.\n{P}{P} — Choose artifact or enchantment. Destroy all permanents of the chosen type.\n{P}{P}{P} — Draw cards equal to the greatest power among creatures you control.',
    );

    expect(modalInfo?.pBudget).toBe(5);
    expect(modalInfo?.canRepeatModes).toBe(true);
    expect(modalInfo?.minModes).toBe(0);
    expect(modalInfo?.options.map((option) => option.pCost)).toEqual([1, 2, 3]);
  });
});

describe('extractModalModesForSpellCast Season {P}', () => {
  it('preserves pBudget/pCost under IR spell primary', () => {
    const previous = process.env.ORACLE_IR_SPELL_PRIMARY;
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    try {
      const modalInfo = extractModalModesForSpellCast(
        'Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — Draw a card.\n{P}{P} — Create a 1/1 green Saproling creature token.\n{P}{P}{P} — You gain 5 life.',
        'Season of Gathering',
      );
      expect(modalInfo?.pBudget).toBe(5);
      expect(modalInfo?.canRepeatModes).toBe(true);
      expect(modalInfo?.options.every((option) => Number(option.pCost) > 0)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
      else process.env.ORACLE_IR_SPELL_PRIMARY = previous;
    }
  });
});