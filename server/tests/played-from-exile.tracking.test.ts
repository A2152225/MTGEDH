import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Played-from-exile tracking (this turn)', () => {
  it('marks playedCardFromExileThisTurn when casting from exile by id', () => {
    const g = createInitialGameState('t_played_from_exile_cast');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // Minimal setup for castSpell.
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    (g.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: 'spell_exile_1',
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            mana_cost: '{R}',
            zone: 'exile',
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    g.applyEvent({ type: 'castSpell', playerId: p1, cardId: 'spell_exile_1', targets: [] });

    expect((g.state as any).playedCardFromExileThisTurn?.[p1]).toBe(true);
    expect((g.state as any).zones[p1].exileCount).toBe(0);
    expect(g.state.stack.some((s: any) => s?.card?.id === 'spell_exile_1')).toBe(true);
  });

  it('marks playedCardFromExileThisTurn when playing a land from exile by id', () => {
    const g = createInitialGameState('t_played_from_exile_land');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: 'land_exile_1',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '',
            zone: 'exile',
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    g.applyEvent({ type: 'playLand', playerId: p1, cardId: 'land_exile_1' });

    expect((g.state as any).playedCardFromExileThisTurn?.[p1]).toBe(true);
    expect((g.state as any).zones[p1].exileCount).toBe(0);
    expect(g.state.battlefield.some((p: any) => p?.card?.id === 'land_exile_1' && p?.controller === p1)).toBe(true);
  });
});
