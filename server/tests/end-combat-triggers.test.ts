import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import {
  detectEndOfCombatTriggers,
  getEndOfCombatTriggers,
} from '../src/state/modules/triggered-abilities.js';

describe('End of combat trigger detection', () => {
  it('detects plain end of combat triggers with full effect text', () => {
    const permanent = {
      id: 'flicker_perm',
      controller: 'p1',
      card: {
        name: 'Flicker Test',
        oracle_text: 'Exile target creature. At end of combat, return it tapped under its owner\'s control.',
      },
    };

    const triggers = detectEndOfCombatTriggers(permanent.card, permanent);
    expect(triggers).toHaveLength(1);
    expect(String(triggers[0]?.effect || '')).toMatch(/return it tapped/i);
  });

  it('filters end of combat triggers with unmet intervening-if at trigger time', () => {
    const g = createInitialGameState('end_combat_intervening_if');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).battlefield = [
      {
        id: 'end_combat_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Conditional End Combat',
          oracle_text: 'At end of combat, if you control a creature, draw a card.',
        },
      },
      {
        id: 'creature_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    const withCreatures = getEndOfCombatTriggers(g as any, p1);
    expect(withCreatures).toHaveLength(1);

    (g.state as any).battlefield = [
      {
        id: 'end_combat_perm',
        controller: p1,
        owner: p1,
        card: {
          name: 'Conditional End Combat',
          oracle_text: 'At end of combat, if you control a creature, draw a card.',
        },
      },
    ];
    const withoutCreatures = getEndOfCombatTriggers(g as any, p1);
    expect(withoutCreatures).toHaveLength(0);
  });

  it('skips end of combat on your turn triggers for non-active controller', () => {
    const g = createInitialGameState('end_combat_your_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state as any).battlefield = [
      {
        id: 'perm_p2',
        controller: p2,
        owner: p2,
        card: {
          name: 'Your Turn Only',
          oracle_text: 'At the end of combat on your turn, draw a card.',
        },
      },
    ];

    const triggers = getEndOfCombatTriggers(g as any, p1);
    expect(triggers).toHaveLength(0);
  });
});
