import { describe, expect, it } from 'vitest';

import { countControlledCreaturesForCombatGate } from '../../shared/src/controlledCreatureCombatGate.js';

describe('countControlledCreaturesForCombatGate', () => {
  it('counts grouped emit token piles by tokenCount / groupedTokenIds, not as one row', () => {
    const count = countControlledCreaturesForCombatGate({
      controllerId: 'p1',
      isCreature: (perm) => String(perm?.card?.type_line || '').toLowerCase().includes('creature'),
      battlefield: [
        {
          id: 'group_tok_a',
          controller: 'p1',
          isGroupedTokens: true,
          tokenCount: 20,
          groupedTokenIds: Array.from({ length: 20 }, (_, i) => `tok_${i}`),
          card: { type_line: 'Token Creature — Dinosaur' },
        },
        {
          id: 'huntmaster',
          controller: 'p1',
          card: { type_line: 'Creature — Human Shaman' },
        },
      ],
    });
    expect(count).toBe(21);
  });
});
