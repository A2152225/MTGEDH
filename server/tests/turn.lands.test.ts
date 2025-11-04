import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase } from '../../shared/src';

describe('Turn advancement and land-per-turn tracking', () => {
  it('increments landsPlayedThisTurn on playLand and resets on nextTurn', () => {
    const g = createInitialGameState('turn_land_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    // Join players; turn player becomes p1
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Start main phase to match socket-side enforcement (state-level does not enforce, we just simulate)
    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;

    const land: Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'> = {
      id: 'land_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '',
      image_uris: undefined
    };

    // Play a land via event (state increments counter)
    g.applyEvent({ type: 'playLand', playerId: p1, card: land });
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(1);

    // Next turn resets counters, advances turn and priority
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p2);
    expect(g.state.priority).toBe(p2);
    expect(g.state.phase).toBe(GamePhase.PRECOMBAT_MAIN);
    expect(g.state.landsPlayedThisTurn?.[p1]).toBe(0);
    expect(g.state.landsPlayedThisTurn?.[p2]).toBe(0);
  });
});