import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function toReplayEvents(gameId: string, startIndex = 0) {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
    );
}

describe('Oracle IR Rings optional-pay copy ability replay', () => {
  const gameId = 'test_oracle_ir_rings_copy_ability_replay';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  it('persists paid:false copyTriggeredAbilityResolve when optional pay is declined', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = 'stack_trade_relay_ability_replay_1';
    const effectText =
      'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.';

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    };
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: playerId,
        source: 'trade_relay_1',
        sourceName: 'Trade Relay',
        card: { id: 'trade_relay_card_1', name: 'Trade Relay', type_line: 'Artifact' },
        abilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
        targets: ['player_relic_1', 'opponent_relic_1'],
      },
    ];
    (game.state as any).battlefield = [
      {
        id: 'rings_1',
        controller: playerId,
        card: { name: 'Rings of Brighthearth', type_line: 'Legendary Artifact' },
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: () => undefined }) };
    const eventStart = getEvents(gameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Rings of Brighthearth',
      effectText,
      {
        id: 'rings_trigger_replay_decline_1',
        permanentId: 'rings_1',
        source: 'rings_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const payStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.effectProgramPrompt === true);
    expect(payStep).toBeDefined();

    resumeEffectProgramResolution({
      game,
      gameId,
      step: payStep!,
      response: { selections: ['no'] },
      persistPrompt: false,
    });

    expect(getStackItems((game.state as any).stack)).toHaveLength(1);

    const replayEvents = toReplayEvents(gameId, eventStart);
    const copyEvents = replayEvents.filter((event: any) => event.type === 'copyTriggeredAbilityResolve');
    expect(copyEvents).toHaveLength(1);
    expect(copyEvents[0]).toEqual(
      expect.objectContaining({
        type: 'copyTriggeredAbilityResolve',
        sourceName: 'Rings of Brighthearth',
        controllerId: playerId,
        triggeringStackItemId: triggeringStackId,
        paid: false,
        manaCost: '{2}',
      }),
    );
    expect(copyEvents[0]?.copiedStackItemId).toBeUndefined();

    const replayGame = createInitialGameState(`${gameId}_replay`);
    (replayGame.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).life = { [playerId]: 40 };
    (replayGame.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    };
    (replayGame.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: playerId,
        sourceName: 'Trade Relay',
        targets: ['player_relic_1', 'opponent_relic_1'],
      },
    ];

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect(getStackItems((replayGame.state as any).stack)).toHaveLength(1);
    expect(Number((replayGame.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(4);
  });

  it('persists optionalPaymentPromptResolve and copyTriggeredAbilityResolve when optional pay is accepted', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = 'stack_trade_relay_ability_replay_paid_1';
    const effectText =
      'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.';

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    };
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: playerId,
        source: 'trade_relay_1',
        sourceName: 'Trade Relay',
        card: { id: 'trade_relay_card_1', name: 'Trade Relay', type_line: 'Artifact' },
        abilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
        targets: ['player_relic_1', 'opponent_relic_1'],
      },
    ];
    (game.state as any).battlefield = [
      {
        id: 'rings_1',
        controller: playerId,
        card: { name: 'Rings of Brighthearth', type_line: 'Legendary Artifact' },
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: () => undefined }) };
    const eventStart = getEvents(gameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Rings of Brighthearth',
      effectText,
      {
        id: 'rings_trigger_replay_paid_1',
        permanentId: 'rings_1',
        source: 'rings_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const payStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.effectProgramPrompt === true);
    expect(payStep).toBeDefined();

    resumeEffectProgramResolution({
      game,
      gameId,
      step: payStep!,
      response: { selections: ['yes'] },
      persistPrompt: false,
    });

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);
    expect(Number((game.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(2);

    const replayEvents = toReplayEvents(gameId, eventStart);
    const payEvents = replayEvents.filter((event: any) => event.type === 'optionalPaymentPromptResolve');
    expect(payEvents).toHaveLength(1);
    expect(payEvents[0]).toEqual(
      expect.objectContaining({
        type: 'optionalPaymentPromptResolve',
        playerId,
        choiceId: 'pay',
        optionalPaymentValidationKind: 'mana',
        manaCost: '{2}',
      }),
    );

    const copyEvents = replayEvents.filter((event: any) => event.type === 'copyTriggeredAbilityResolve');
    expect(copyEvents).toHaveLength(1);
    expect(copyEvents[0]).toEqual(
      expect.objectContaining({
        type: 'copyTriggeredAbilityResolve',
        sourceName: 'Rings of Brighthearth',
        controllerId: playerId,
        triggeringStackItemId: triggeringStackId,
        copiedStackItemId: copies[0]?.id,
        paid: true,
      }),
    );

    const replayGame = createInitialGameState(`${gameId}_replay_paid`);
    (replayGame.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).life = { [playerId]: 40 };
    (replayGame.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    };
    (replayGame.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: playerId,
        sourceName: 'Trade Relay',
        targets: ['player_relic_1', 'opponent_relic_1'],
      },
    ];

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayCopies = getStackItems((replayGame.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(replayCopies).toHaveLength(1);
    expect(Number((replayGame.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(2);
  });
});
