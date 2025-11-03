import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';

describe('Reset clears in-place without breaking references', () => {
  it('keeps state maps identity and reflects future updates', () => {
    const gameId = 'reset_identity';
    const p1 = 'p_reset' as PlayerID;
    const g = createInitialGameState(gameId);

    const zonesRef = g.state.zones;
    const lifeRef = g.state.life;
    const commandZoneRef = g.state.commandZone;

    // Reset with preserve = true
    g.reset(true);

    expect(g.state.zones).toBe(zonesRef);
    expect(g.state.life).toBe(lifeRef);
    expect(g.state.commandZone).toBe(commandZoneRef);

    // Import a tiny deck, shuffle, draw
    const deck: Array<Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text'>> = [
      { id: 'a', name: 'A', type_line: 'Test', oracle_text: '' },
      { id: 'b', name: 'B', type_line: 'Test', oracle_text: '' },
      { id: 'c', name: 'C', type_line: 'Test', oracle_text: '' },
    ];
    g.applyEvent({ type: 'deckImportResolved', playerId: p1, cards: deck });
    g.applyEvent({ type: 'shuffleLibrary', playerId: p1 });
    g.applyEvent({ type: 'drawCards', playerId: p1, count: 2 });

    // Zones reflect the draw via the same ref
    expect(zonesRef[p1]?.handCount).toBe(2);
    expect((zonesRef[p1]?.hand ?? []).length).toBe(2);
  });
});