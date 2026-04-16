import { describe, expect, it } from 'vitest';

import { extractModalModesFromOracleText } from '../src/utils/oraclePromptContext.js';

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
});