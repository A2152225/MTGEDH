import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('pregame turn events applyEvent / undo-replay', () => {
  it('claimTurn sets turnPlayer and startingPlayerId when missing', () => {
    const game = createInitialGameState('t_claim_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    // Fresh multiplayer pregame may already have a provisional turnPlayer from join;
    // clear so claimTurn is the authoritative source (undo/replay path).
    (game.state as any).turnPlayer = '';
    delete (game.state as any).startingPlayerId;
    delete (game.state as any).startingPlayer;

    game.applyEvent({ type: 'claimTurn', by: p1 } as any);

    expect(game.state.turnPlayer).toBe(p1);
    expect((game.state as any).startingPlayerId).toBe(p1);
    expect((game.state as any).startingPlayer).toBe(p1);
  });

  it('claimTurn does not overwrite an existing startingPlayerId', () => {
    const game = createInitialGameState('t_claim_turn_preserve_starting');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).startingPlayerId = p2;
    (game.state as any).startingPlayer = p2;

    game.applyEvent({ type: 'claimTurn', by: p1 } as any);

    expect(game.state.turnPlayer).toBe(p1);
    expect((game.state as any).startingPlayerId).toBe(p2);
    expect((game.state as any).startingPlayer).toBe(p2);
  });

  it('randomizeStartingPlayer sets turnPlayer and starting player from selectedPlayerId', () => {
    const game = createInitialGameState('t_randomize_starting');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.applyEvent({
      type: 'randomizeStartingPlayer',
      selectedPlayerId: p2,
      by: p1,
    } as any);

    expect(game.state.turnPlayer).toBe(p2);
    expect((game.state as any).startingPlayerId).toBe(p2);
    expect((game.state as any).startingPlayer).toBe(p2);
  });

  it('randomizeStartingPlayer with playerOrder reseats and sets turn order', () => {
    const game = createInitialGameState('t_randomize_turn_order');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    addPlayer(game, p3, 'P3');

    game.applyEvent({
      type: 'randomizeStartingPlayer',
      selectedPlayerId: p3,
      playerOrder: [p3, p1, p2],
      by: p1,
    } as any);

    expect((game.state.players as any[]).map((p: any) => p.id)).toEqual([p3, p1, p2]);
    expect((game.state.players as any[]).map((p: any) => p.seat)).toEqual([0, 1, 2]);
    expect((game.state as any).turnOrder).toEqual([p3, p1, p2]);
    expect(game.state.turnPlayer).toBe(p3);
    expect((game.state as any).startingPlayerId).toBe(p3);
  });

  it('autoAssignTurn sets turnPlayer only (mirrors live nextTurn solo path)', () => {
    const game = createInitialGameState('t_auto_assign_turn');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({ type: 'autoAssignTurn', playerId: p1 } as any);

    expect(game.state.turnPlayer).toBe(p1);
    expect((game.state as any).startingPlayerId).toBeFalsy();
  });
});