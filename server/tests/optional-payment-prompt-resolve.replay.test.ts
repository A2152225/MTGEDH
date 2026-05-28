import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('optional payment prompt resolve replay semantics', () => {
  it('clears shock-land optional payment prompts before the domain choice applies life loss', () => {
    const gameId = 't_optional_payment_prompt_replay_shock_land';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;

    ResolutionQueueManager.removeQueue(gameId);
    addPlayer(game, playerId, 'P1');
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'shock_1',
        controller: playerId,
        owner: playerId,
        tapped: true,
        card: { id: 'shock_card_1', name: 'Watery Grave', type_line: 'Land' },
      },
    ];
    ResolutionQueueManager.addStep(gameId, {
      id: 'optional_payment_shock_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'shock_1',
      description: 'Pay 2 life? If you do not, it enters tapped.',
      mandatory: true,
      optionalPaymentPrompt: true,
      optionalPaymentValidationKind: 'life',
      optionalPaymentPayChoiceId: 'pay_2_life',
      optionalPaymentDeclineChoiceId: 'enter_tapped',
      shockLandChoice: true,
      permanentId: 'shock_1',
    } as any);

    game.applyEvent({
      type: 'optionalPaymentPromptResolve',
      playerId,
      sourceId: 'shock_1',
      resolvedStepId: 'optional_payment_shock_step_1',
      choiceId: 'pay_2_life',
      optionalPaymentValidationKind: 'life',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    expect((game.state as any).life[playerId]).toBe(40);
    expect(Boolean((game.state as any).battlefield[0]?.tapped)).toBe(true);

    game.applyEvent({
      type: 'shockLandChoice',
      playerId,
      permanentId: 'shock_1',
      payLife: true,
      cardName: 'Watery Grave',
    } as any);

    expect((game.state as any).life[playerId]).toBe(38);
    expect(Number((game.state as any).lifeLostThisTurn?.[playerId] || 0)).toBe(2);
    expect(Boolean((game.state as any).battlefield[0]?.tapped)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('clears opponent-may-pay optional payment prompts and leaves the domain event to apply the outcome', () => {
    const gameId = 't_optional_payment_prompt_replay_opponent_may_pay';
    const game = createInitialGameState(gameId);
    const decidingPlayer = 'p1' as PlayerID;
    const sourceController = 'p2' as PlayerID;

    ResolutionQueueManager.removeQueue(gameId);
    addPlayer(game, decidingPlayer, 'P1');
    addPlayer(game, sourceController, 'P2');
    (game.state as any).manaPool = {
      [decidingPlayer]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    ResolutionQueueManager.addStep(gameId, {
      id: 'optional_payment_opponent_pay_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: decidingPlayer,
      sourceId: 'rhystic_study_1',
      description: 'Pay {1}?',
      mandatory: true,
      optionalPaymentPrompt: true,
      optionalPaymentValidationKind: 'mana',
      optionalPaymentManaCost: '{1}',
      optionalPaymentPayChoiceId: 'pay',
      optionalPaymentDeclineChoiceId: 'decline',
      opponentMayPayChoice: true,
      promptId: 'opponent_pay_prompt_1',
    } as any);

    game.applyEvent({
      type: 'optionalPaymentPromptResolve',
      playerId: decidingPlayer,
      sourceId: 'rhystic_study_1',
      resolvedStepId: 'optional_payment_opponent_pay_step_1',
      choiceId: 'decline',
      optionalPaymentValidationKind: 'mana',
      manaCost: '{1}',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    expect(Number((game.state as any).manaPool[decidingPlayer]?.colorless || 0)).toBe(2);

    game.importDeckResolved(sourceController, [
      { id: 'rhystic_draw_1', name: 'Island', type_line: 'Basic Land - Island' },
    ]);
    game.applyEvent({
      type: 'opponentMayPayResolve',
      playerId: decidingPlayer,
      decidingPlayer,
      promptId: 'opponent_pay_prompt_1',
      willPay: false,
      sourceName: 'Rhystic Study',
      sourceController,
      manaCost: '{1}',
      declineEffect: 'Draw a card',
    } as any);

    expect(((game.state as any).zones?.[sourceController]?.hand || []).map((card: any) => card.id)).toEqual(['rhystic_draw_1']);
    expect(Number((game.state as any).manaPool[decidingPlayer]?.colorless || 0)).toBe(2);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('clears ability-copy optional payment prompts before copyTriggeredAbilityResolve consumes recorded mana', () => {
    const gameId = 't_optional_payment_prompt_replay_copy_ability';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;

    ResolutionQueueManager.removeQueue(gameId);
    addPlayer(game, playerId, 'P1');
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).stack = [
      {
        id: 'original_ability_1',
        type: 'ability',
        controller: playerId,
        sourceName: 'Trading Post',
        targets: ['target_1'],
      },
      {
        id: 'copy_trigger_1',
        type: 'triggered_ability',
        controller: playerId,
        sourceName: 'Trade Relay',
      },
    ];
    ResolutionQueueManager.addStep(gameId, {
      id: 'optional_payment_copy_ability_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'trade_relay_1',
      description: 'Pay {2}. If you do, copy that ability.',
      mandatory: false,
      optionalPaymentPrompt: true,
      optionalPaymentValidationKind: 'mana',
      optionalPaymentManaCost: '{2}',
      optionalPaymentPayChoiceId: 'pay',
      optionalPaymentDeclineChoiceId: 'decline',
      copyTriggeredAbilityChoice: true,
      triggeringStackItemId: 'original_ability_1',
    } as any);

    game.applyEvent({
      type: 'optionalPaymentPromptResolve',
      playerId,
      sourceId: 'trade_relay_1',
      resolvedStepId: 'optional_payment_copy_ability_step_1',
      choiceId: 'pay',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    expect(Number((game.state as any).manaPool[playerId]?.colorless || 0)).toBe(2);

    game.applyEvent({
      type: 'copyTriggeredAbilityResolve',
      sourceId: 'trade_relay_1',
      sourceName: 'Trade Relay',
      controllerId: playerId,
      paid: true,
      manaCost: '{2}',
      triggerStackItemId: 'copy_trigger_1',
      triggeringStackItemId: 'original_ability_1',
      copiedStackItemId: 'copied_ability_1',
    } as any);

    const stack = ((game.state as any).stack || []) as any[];
    expect(stack.some((item: any) => item.id === 'copy_trigger_1')).toBe(false);
    expect(stack.some((item: any) => item.id === 'copied_ability_1' && item.copiedFromStackItemId === 'original_ability_1')).toBe(true);
    expect(Number((game.state as any).manaPool[playerId]?.colorless || 0)).toBe(0);
    ResolutionQueueManager.removeQueue(gameId);
  });
});