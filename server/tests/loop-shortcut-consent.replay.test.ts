import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('loop shortcut consent events applyEvent / undo-replay', () => {
  it('proposeLoopShortcut with opponents restores pendingLoopShortcut', () => {
    const game = createInitialGameState('t_loop_propose');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.applyEvent({
      type: 'proposeLoopShortcut',
      proposalId: 'loop_abc',
      proposerId: p1,
      name: 'Draw Loop',
      summary: 'Draw a card',
      requestedIterations: 5,
      opponentIds: [p2],
    } as any);

    const pending = (game.state as any).pendingLoopShortcut;
    expect(pending).toBeTruthy();
    expect(pending.id).toBe('loop_abc');
    expect(pending.proposerId).toBe(p1);
    expect(pending.name).toBe('Draw Loop');
    expect(pending.summary).toBe('Draw a card');
    expect(pending.requestedIterations).toBe(5);
    expect(pending.status).toBe('pending');
    expect(pending.responses).toEqual({});
  });

  it('proposeLoopShortcut with no opponents leaves no pending (live auto-approve clear)', () => {
    const game = createInitialGameState('t_loop_propose_solo');
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).pendingLoopShortcut = { id: 'stale' };

    game.applyEvent({
      type: 'proposeLoopShortcut',
      proposalId: 'loop_solo',
      proposerId: p1,
      name: 'Solo Loop',
      summary: 'N/A',
      requestedIterations: 3,
      opponentIds: [],
    } as any);

    expect((game.state as any).pendingLoopShortcut).toBeUndefined();
  });

  it('resolveLoopShortcutConsent clears pendingLoopShortcut', () => {
    const game = createInitialGameState('t_loop_resolve');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    (game.state as any).pendingLoopShortcut = {
      id: 'loop_abc',
      proposerId: p1,
      name: 'Draw Loop',
      summary: 'Draw a card',
      requestedIterations: 5,
      status: 'pending',
      createdAt: 1,
      responses: { [p2]: { interrupt: true, afterIterations: 2 } },
    };

    game.applyEvent({
      type: 'resolveLoopShortcutConsent',
      proposalId: 'loop_abc',
      proposerId: p1,
      requestedIterations: 5,
      effectiveIterations: 2,
      interrupted: true,
      responses: { [p2]: { interrupt: true, afterIterations: 2 } },
    } as any);

    expect((game.state as any).pendingLoopShortcut).toBeUndefined();
  });

  it('propose then resolve mirrors live consent end state', () => {
    const game = createInitialGameState('t_loop_propose_resolve');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');

    game.applyEvent({
      type: 'proposeLoopShortcut',
      proposalId: 'loop_full',
      proposerId: p1,
      name: 'Full',
      summary: 's',
      requestedIterations: 4,
      opponentIds: [p2],
    } as any);
    expect((game.state as any).pendingLoopShortcut?.status).toBe('pending');

    game.applyEvent({
      type: 'resolveLoopShortcutConsent',
      proposalId: 'loop_full',
      proposerId: p1,
      requestedIterations: 4,
      effectiveIterations: 4,
      interrupted: false,
      responses: { [p2]: { interrupt: false } },
    } as any);
    expect((game.state as any).pendingLoopShortcut).toBeUndefined();
  });
});