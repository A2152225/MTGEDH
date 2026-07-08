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

  it('removes replayed battlefield activation payment prompts when the ability is already on the stack', () => {
    const gameId = 'game_replay_battlefield_activation_cleanup';
    const state: any = {
      players: [{ id: 'p1' }],
      turnPlayer: 'p1',
      priority: 'p1',
      step: 'MAIN1',
      phase: 'precombatMain',
      stack: [{
        id: 'ability_1',
        type: 'ability',
        controller: 'p1',
        source: 'tanuki_1',
        sourceName: 'Tanuki Transplanter',
        abilityType: 'reconfigure_attach',
      }],
      battlefield: [{
        id: 'tanuki_1',
        controller: 'p1',
        card: { name: 'Tanuki Transplanter', type_line: 'Artifact Creature — Dog Equipment', oracle_text: 'Reconfigure {3}' },
      }],
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_PAYMENT_CHOICE,
      playerId: 'p1' as any,
      sourceId: 'tanuki_1',
      permanentId: 'tanuki_1',
      description: 'Choose how to pay {3} for Tanuki Transplanter.',
      mandatory: true,
      activationPaymentChoice: true,
      activationPaymentContext: 'battlefield_targeted',
      manaCost: '{3}',
      abilityId: 'tanuki_card_1-reconfigure-attach-0',
      abilityType: 'reconfigure_attach',
    } as any);

    pruneObsoleteResolutionQueueAfterReplay(gameId, state);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const pending = queue.steps.filter((step) => step.status === ResolutionStepStatus.PENDING);
    expect(pending).toHaveLength(0);
  });
});
