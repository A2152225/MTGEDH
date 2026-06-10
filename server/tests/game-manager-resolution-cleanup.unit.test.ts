import { describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('GameManager resolution queue cleanup', () => {
  it('deleteGame removes stale resolution steps so gameId reuse is not blocked', () => {
    const gameId = 't_gm_resolution_cleanup_delete';

    ResolutionQueueManager.removeQueue(gameId);
    GameManager.createGame({ id: gameId });

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p_old' as any,
      description: 'Pay mana',
      mandatory: true,
      spellPaymentRequired: true,
    } as any);

    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(true);

    const removed = GameManager.deleteGame(gameId);
    expect(removed).toBe(true);

    GameManager.createGame({ id: gameId });
    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);

    GameManager.deleteGame(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('createGame clears orphaned queue entries before starting a fresh game', () => {
    const gameId = 't_gm_resolution_cleanup_create';

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p_orphan' as any,
      description: 'Orphaned payment prompt',
      mandatory: true,
    } as any);

    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(true);

    GameManager.createGame({ id: gameId });
    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);

    GameManager.deleteGame(gameId);
    ResolutionQueueManager.removeQueue(gameId);
  });
});
