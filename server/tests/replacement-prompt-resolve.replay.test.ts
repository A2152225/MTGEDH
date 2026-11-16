import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { PAY_LIFE_REPLACEMENT_ORDER_FLAG } from '../src/state/modules/payLifeReplacementOrder.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const P1 = 'p1' as PlayerID;

function setup(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  const game = createInitialGameState(gameId);
  (game.state as any).players = [{ id: P1, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).life = { [P1]: 40, p2: 40 };
  (game.state as any).startingLife = 40;
  (game.state as any).battlefield = (game.state as any).battlefield || [];
  (game.state as any).zones = (game.state as any).zones || {};
  return game;
}

function queueOption(gameId: string, stepId: string, flags: Record<string, unknown>) {
  ResolutionQueueManager.addStep(gameId, {
    id: stepId,
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: P1,
    description: 'Test prompt',
    mandatory: true,
    ...flags,
  } as any);
}

function stepStillQueued(gameId: string, stepId: string): boolean {
  return ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === stepId);
}

const CLEANUP_CASES: Array<{ eventType: string; stepId: string; flags: Record<string, unknown>; event: Record<string, unknown> }> = [
  {
    eventType: 'specialCombatDamageAssignmentResolve',
    stepId: 'special_combat_step_1',
    flags: { specialCombatDamageAssignment: true, attackerId: 'attacker_1', sourceId: 'attacker_1' },
    event: { attackerId: 'attacker_1', mode: 'divide', cancelled: true },
  },
  {
    eventType: 'replacementOrderChoiceResolve',
    stepId: 'replacement_order_step_1',
    flags: { replacementOrderChoice: true },
    event: { playerId: P1, choiceId: '', eventKind: 'token-create', candidates: [] },
  },
  {
    eventType: 'jinnieFayTokenChoiceResolve',
    stepId: 'jinnie_fay_step_1',
    flags: { jinnieFayTokenChoice: true },
    event: { playerId: P1, choiceId: 'normal' },
  },
  {
    eventType: 'archmageAscensionSearchInsteadResolve',
    stepId: 'archmage_step_1',
    flags: { archmageAscensionSearchInstead: true },
    event: { playerId: P1, declined: true, remainingDrawCountAfterChoice: 0 },
  },
  {
    eventType: 'libraryOfLengDiscardChoiceResolve',
    stepId: 'leng_step_1',
    flags: { libraryOfLengDiscardChoice: true, cardId: 'discarded_1', sourceId: 'discarded_1' },
    event: { playerId: P1, cardId: 'discarded_1', putOnLibraryTop: false, batchId: '' },
  },
  {
    eventType: 'outOfTheTombsDrawResolve',
    stepId: 'tombs_step_1',
    flags: { outOfTheTombsDraw: true },
    event: { playerId: P1, remainingDrawCountAfterChoice: 0 },
  },
  {
    eventType: 'pursuitDrawReplacementResolve',
    stepId: 'pursuit_step_1',
    flags: { pursuitDrawReplacementChoice: true, pursuitSourcePermanentId: 'pursuit_1', sourceId: 'pursuit_1' },
    event: { playerId: P1, choiceId: 'draw', remainingDrawCountAfterChoice: 0, sourcePermanentId: 'pursuit_1', sourceName: 'Pursuit of Knowledge', counterType: 'study' },
  },
  {
    eventType: 'tomorrowLookPutDrawResolve',
    stepId: 'tomorrow_step_1',
    flags: { tomorrowDrawReplacement: true },
    event: { playerId: P1, lookCount: 0, bottomOrder: [], remainingDrawCountAfterChoice: 0 },
  },
  {
    eventType: 'transformAttachToPlayerResolve',
    stepId: 'transform_attach_step_1',
    flags: { transformAttachToPlayerChoice: true, permanentId: 'aura_1', sourceId: 'aura_1' },
    event: { permanentId: 'aura_1', attachedToPlayerId: P1, playerId: P1 },
  },
  {
    eventType: 'transformChooseOpponentResolve',
    stepId: 'transform_opponent_step_1',
    flags: { transformChooseOpponent: true, permanentId: 'walker_1', sourceId: 'walker_1' },
    event: { permanentId: 'walker_1', chosenOpponentId: 'p2', playerId: 'p2' },
  },
];

describe('uncommitted prompt-resolve applyEvent replay contracts', () => {
  const gameIds: string[] = [];
  afterEach(() => {
    for (const gameId of gameIds.splice(0)) ResolutionQueueManager.removeQueue(gameId);
  });

  it.each(CLEANUP_CASES)('replays $eventType by clearing the restored prompt', ({ eventType, stepId, flags, event }) => {
    const gameId = `replay_${eventType}`;
    gameIds.push(gameId);
    const game = setup(gameId);
    queueOption(gameId, stepId, flags);

    game.applyEvent({
      type: eventType,
      playerId: P1,
      resolvedStepId: stepId,
      ...event,
    } as any);

    expect(stepStillQueued(gameId, stepId), `${eventType} left ${stepId} queued`).toBe(false);
  });

  it('replays payLifeReplacementOrderResolve by clearing the order prompt and paying the unreplaced life', () => {
    const gameId = 'replay_payLifeReplacementOrderResolve';
    gameIds.push(gameId);
    const game = setup(gameId);
    queueOption(gameId, 'pay_life_order_step_1', {
      [PAY_LIFE_REPLACEMENT_ORDER_FLAG]: true,
      payLifeAmount: 2,
      payLifePlayerId: P1,
    });

    game.applyEvent({
      type: 'payLifeReplacementOrderResolve',
      playerId: P1,
      amount: 2,
      chosenId: 'missing',
      replaced: false,
      resolvedStepId: 'pay_life_order_step_1',
    } as any);

    expect(stepStillQueued(gameId, 'pay_life_order_step_1')).toBe(false);
    expect((game.state as any).life[P1]).toBe(38);
  });
});
