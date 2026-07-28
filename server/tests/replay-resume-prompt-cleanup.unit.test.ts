import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { processPendingScry } from '../src/socket/resolution.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('replay resume prompt cleanup', () => {
  it('clears legacy pending prompt state after replay so reconnect does not re-queue scry', () => {
    const gameId = 't_replay_resume_scry_cleanup';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    (game.state as any).pendingScry = { [p1]: { count: 2 } };
    (game.state as any).pendingSpellCasts = { effect_1: { cardId: 'card_1', cardName: 'Bolt' } };
    (game.state as any).priority = null;
    (game.state as any)._priorityAfterResolution = p1;

    game.replay([]);

    expect((game.state as any).pendingScry).toBeUndefined();
    // Orphaned pendingSpellCasts (card not in hand) are pruned after replay.
    expect((game.state as any).pendingSpellCasts?.effect_1).toBeUndefined();
    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);
    expect((game.state as any).priority).toBe(p1);

    const io = { to: () => ({ emit: () => undefined }) } as any;
    processPendingScry(io, game, gameId);
    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('does not enqueue resolution steps while replaying persisted events', () => {
    const gameId = 't_replay_suppress_prompt_enqueue';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    ResolutionQueueManager.beginReplay(gameId);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: p1,
      description: 'Search your library for a land',
      mandatory: true,
      validTargets: [],
      minTargets: 1,
      maxTargets: 1,
    } as any);
    ResolutionQueueManager.endReplay(gameId);

    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
