import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

describe('Combat damage subtype intervening-if templates', () => {
  it('supports generic subtype phrasing such as "by a Dragon this turn"', () => {
    const g = createInitialGameState('combat_damage_subtype_intervening_if');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).battlefield = [
      {
        id: 'dragon_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'dragon_card',
          name: 'Test Dragon',
          type_line: 'Creature — Dragon',
          oracle_text: 'Flying',
        },
      },
    ];
    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: {
        dragon_perm: { creatureName: 'Test Dragon', totalDamage: 4 },
      },
    };

    const desc = 'At the beginning of your second main phase, if a player was dealt combat damage by a Dragon this turn, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);
  });
});