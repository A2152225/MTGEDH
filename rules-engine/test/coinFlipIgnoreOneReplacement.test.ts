import { describe, expect, it, vi } from 'vitest';

import { describe, expect, it, vi } from 'vitest';

import { generateCoinFlipResultWithIgnoreOne, resolveCoinFlipWithIgnoreOne } from '../src/coinFlipIgnoreOneReplacement.js';

const THUMB_TEXT = 'If you would flip a coin, instead flip two coins and ignore one.';

describe('coin flip ignore-one replacement (Krark\'s Thumb family)', () => {
  it('keeps a called result when either of the two coins matches', () => {
    const randomSpy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1);

    const state = {
      battlefield: [
        {
          id: 'perm_thumb',
          controller: 'p1',
          card: { name: "Krark's Thumb", oracle_text: THUMB_TEXT },
        },
      ],
    };

    const result = generateCoinFlipResultWithIgnoreOne(state, 'p1', { call: 'heads' });
    randomSpy.mockRestore();
    expect(result).toBe('heads');
  });

  it('does not replace flips for a player who does not control the permanent', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);

    const state = {
      battlefield: [
        {
          id: 'perm_thumb',
          controller: 'p1',
          card: { name: "Krark's Thumb", oracle_text: THUMB_TEXT },
        },
      ],
    };

    const result = generateCoinFlipResultWithIgnoreOne(state, 'p2', { call: 'heads' });
    randomSpy.mockRestore();
    expect(result).toBe('tails');
  });

  it('prompts which coin to ignore when a pair differs in interactive mode', () => {
    const randomSpy = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9);

    const state = {
      battlefield: [
        {
          id: 'perm_thumb',
          controller: 'p1',
          card: { name: "Krark's Thumb", oracle_text: THUMB_TEXT },
        },
      ],
    };

    const pending = resolveCoinFlipWithIgnoreOne(state, 'p1', { call: 'heads', interactive: true });
    randomSpy.mockRestore();
    expect(pending.kind).toBe('choice_required');
    if (pending.kind !== 'choice_required') return;
    expect(pending.a).toBe('heads');
    expect(pending.b).toBe('tails');
    expect(pending.rawFlips).toEqual(['heads', 'tails']);

    const keptFirst = resolveCoinFlipWithIgnoreOne(state, 'p1', {
      call: 'heads',
      interactive: true,
      rawFlips: pending.rawFlips,
      keepChoices: ['first'],
    });
    expect(keptFirst).toEqual({ kind: 'result', result: 'heads', rawFlips: ['heads', 'tails'] });

    const keptSecond = resolveCoinFlipWithIgnoreOne(state, 'p1', {
      call: 'heads',
      interactive: true,
      rawFlips: pending.rawFlips,
      keepChoices: ['second'],
    });
    expect(keptSecond).toEqual({ kind: 'result', result: 'tails', rawFlips: ['heads', 'tails'] });
  });
});
