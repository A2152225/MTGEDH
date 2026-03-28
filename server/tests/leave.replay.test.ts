import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('leave replay semantics', () => {
  it('replays leave by removing the player and reassigning turn references', () => {
    const game = createInitialGameState('t_leave_replay');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).zones[p1].hand = [{ id: 'card_a', name: 'Card A', type_line: 'Instant', oracle_text: '', zone: 'hand' }];
    (game.state as any).zones[p1].handCount = 1;
    (game.state as any).zones[p2].hand = [{ id: 'card_b', name: 'Card B', type_line: 'Instant', oracle_text: '', zone: 'hand' }];
    (game.state as any).zones[p2].handCount = 1;
    (game.state as any).commandZone = (game.state as any).commandZone || {};
    (game.state as any).commandZone[p1] = { commanderIds: ['cmdr_1'], tax: 2, taxById: { cmdr_1: 2 } };
    (game.state as any).commandZone[p2] = { commanderIds: ['cmdr_2'], tax: 0, taxById: { cmdr_2: 0 } };

    game.applyEvent({ type: 'leave', playerId: p1 } as any);

    expect(((game.state as any).players || []).map((player: any) => player.id)).toEqual([p2]);
    expect((game.state as any).zones[p1]).toBeUndefined();
    expect((game.state as any).zones[p2].handCount).toBe(1);
    expect((game.state as any).life?.[p1]).toBeUndefined();
    expect((game.state as any).life?.[p2]).toBe(40);
    expect((game.state as any).commandZone[p1]).toBeUndefined();
    expect((game.state as any).commandZone[p2]).toBeDefined();
    expect((game.state as any).turnPlayer).toBe(p2);
    expect((game.state as any).priority).toBe(p2);
  });
});