import { describe, expect, it } from 'vitest';

import { ResolutionQueueManager } from '../src/state/resolution/ResolutionQueueManager.js';
import { ResolutionStepStatus, ResolutionStepType } from '../src/state/resolution/types.js';
import { pruneObsoleteResolutionQueueAfterReplay } from '../src/state/resolution/replayCleanup.js';

describe('pruneObsoleteResolutionQueueAfterReplay', () => {
  it('removes replayed mana color prompts and stale spell-cast steps', () => {
    const gameId = 'game_replay_cleanup_test';
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [],
      manaPool: { p1: { white: 0, blue: 1, black: 0, red: 0, green: 1, colorless: 0 } },
      pendingSpellCasts: {
        stale_cast: { cardId: 'old_spell', playerId: 'p1' },
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a color',
      mandatory: true,
      permanentId: 'land_1',
      cardName: 'Temple Garden',
      amount: 1,
    } as any);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      description: 'Pay for spell',
      mandatory: true,
      spellPaymentRequired: true,
      spellCastContext: { effectId: 'stale_cast', cardId: 'old_spell' },
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(0);
    expect(state.pendingSpellCasts.stale_cast).toBeUndefined();
  });
});
