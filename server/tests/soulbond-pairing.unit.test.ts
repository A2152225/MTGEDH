import { describe, expect, it } from 'vitest';
import {
  getPairedPermanent,
  isUnpairedCreature,
  pairPermanents,
  permanentHasSoulbond,
  reconcileSoulbondPairing,
  unpairPermanent,
} from '../src/state/modules/soulbond.js';
import { isSelfDealtDamageClause } from '../src/state/modules/triggers/dealt-damage-watchers.js';

describe('soulbond pairing state', () => {
  it('detects soulbond on oracle and pairs bilaterally', () => {
    const state = {
      battlefield: [
        {
          id: 'donna',
          controller: 'p1',
          card: {
            name: 'Donna Noble',
            type_line: 'Creature — Human',
            oracle_text: 'Soulbond\nWhenever Donna Noble or a creature it\'s paired with is dealt damage, Donna Noble deals that much damage to target opponent.',
          },
        },
        {
          id: 'bear',
          controller: 'p1',
          card: { name: 'Bear', type_line: 'Creature — Bear', oracle_text: '' },
        },
      ],
    };

    expect(permanentHasSoulbond(state.battlefield[0])).toBe(true);
    expect(isUnpairedCreature(state.battlefield[0])).toBe(true);
    expect(pairPermanents(state, 'donna', 'bear')).toBe(true);
    expect(state.battlefield[0].pairedWith).toBe('bear');
    expect(state.battlefield[1].pairedWith).toBe('donna');
    expect(getPairedPermanent(state, state.battlefield[0])?.id).toBe('bear');
  });

  it('unpairs both sides on leave and control mismatch', () => {
    const state = {
      battlefield: [
        { id: 'a', controller: 'p1', pairedWith: 'b', card: { type_line: 'Creature — Human' } },
        { id: 'b', controller: 'p1', pairedWith: 'a', card: { type_line: 'Creature — Elf' } },
      ],
    };
    expect(unpairPermanent(state, 'a')).toBe(true);
    expect(state.battlefield[0].pairedWith).toBeUndefined();
    expect(state.battlefield[1].pairedWith).toBeUndefined();

    state.battlefield[0].pairedWith = 'b';
    state.battlefield[1].pairedWith = 'a';
    state.battlefield[1].controller = 'p2';
    expect(reconcileSoulbondPairing(state, state.battlefield[0])).toBe(1);
    expect(state.battlefield[0].pairedWith).toBeUndefined();
  });

  it('treats Donna-style paired damage as a self dealt-damage clause', () => {
    expect(
      isSelfDealtDamageClause(
        'Whenever Donna Noble or a creature it\'s paired with is dealt damage, Donna Noble deals that much damage to target opponent.',
        'Donna Noble',
      ),
    ).toBe(true);
  });
});
