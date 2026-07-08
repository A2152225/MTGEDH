import { describe, expect, it } from 'vitest';
import { sumActiveTemporaryPTMods } from '../src/state/modules/temporaryPtMods.js';
import { getEffectivePower } from '../src/socket/util.js';

describe('temporary PT mods', () => {
  it('sums active end-of-turn temporary PT modifiers', () => {
    const permanent = {
      card: { power: '3', toughness: '3' },
      temporaryPTMods: [
        { power: 2, toughness: 0, until: 'end_of_turn' },
        { power: 1, toughness: 0, expiresAt: 'end_of_turn' },
      ],
    };
    expect(sumActiveTemporaryPTMods(permanent)).toEqual({ power: 3, toughness: 0 });
    expect(getEffectivePower(permanent)).toBe(6);
  });
});
