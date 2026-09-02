import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isSpellCastingProhibitedByStaticRestriction } from '../src/state/modules/staticCastingRestrictions.js';

describe('Turn-start battlefield snapshot', () => {
  it('copies tapped lands at nextTurn before the untap step', () => {
    const g = createInitialGameState('t_turn_start_battlefield_snapshot') as any;
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    (g.state.battlefield as any[]).push({
      id: 'island_1',
      controller: p2,
      owner: p2,
      tapped: true,
      type_line: 'Basic Land — Island',
      card: { name: 'Island', type_line: 'Basic Land — Island' },
    });

    g.applyEvent({ type: 'nextTurn' } as any);

    const snapshot = (g.state as any).turnStartBattlefieldSnapshot || [];
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.id).toBe('island_1');
    expect(snapshot[0]?.tapped).toBe(true);
    expect((g.state as any).permanentUntappedAtTurnBegin?.island_1).toBe(false);
  });
});

describe('Static land-count cast restriction', () => {
  const laviniaOracle =
    "Each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls.";

  it('blocks an opponent noncreature above their land count and allows creatures', () => {
    const state: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [
        {
          id: 'lavinia_1',
          controller: 'p1',
          card: {
            name: 'Lavinia, Azorius Renegade',
            oracle_text: laviniaOracle,
            type_line: 'Legendary Creature — Human Soldier',
          },
        },
        {
          id: 'island_1',
          controller: 'p2',
          type_line: 'Basic Land — Island',
          card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
        },
      ],
      stack: [],
      phase: 'precombat_main',
    };

    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p2', {
      name: 'Counterspell',
      type_line: 'Instant',
      cmc: 2,
      mana_value: 2,
    }).prohibited).toBe(true);

    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p2', {
      name: 'Lightning Bolt',
      type_line: 'Instant',
      cmc: 1,
      mana_value: 1,
    }).prohibited).toBe(false);

    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p2', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      cmc: 2,
      mana_value: 2,
    }).prohibited).toBe(false);

    expect(isSpellCastingProhibitedByStaticRestriction(state, 'p1', {
      name: 'Counterspell',
      type_line: 'Instant',
      cmc: 2,
      mana_value: 2,
    }).prohibited).toBe(false);
  });
});
