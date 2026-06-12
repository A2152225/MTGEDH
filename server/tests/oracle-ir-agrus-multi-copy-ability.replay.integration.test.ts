import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

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

function seedAgrusMultiCopyBoard(game: any, playerId: string) {
  const triggeringStackId = 'stack_shock_trooper_ability_replay_1';
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
  };
  (game.state as any).battlefield = [
    { id: 'agrus_1', controller: playerId, card: { type_line: 'Legendary Creature — Soldier' } },
    { id: 'bear_1', controller: playerId, card: { type_line: 'Creature — Bear' } },
    { id: 'bear_2', controller: playerId, card: { type_line: 'Creature — Bear' } },
  ];
  (game.state as any).stack = [
    {
      id: triggeringStackId,
      type: 'ability',
      controller: playerId,
      source: 'shock_trooper_1',
      sourceName: 'Shock Trooper',
      abilityText: '{R}: Target creature gets +1/+0 until end of turn.',
      targets: ['agrus_1'],
      copyRetargetValidTargets: [
        { id: 'agrus_1', type: 'permanent' },
        { id: 'bear_1', type: 'permanent' },
        { id: 'bear_2', type: 'permanent' },
      ],
    },
  ];
  return triggeringStackId;
}

describe('Oracle IR Agrus multi-copy ability replay', () => {
  const gameId = 'test_oracle_ir_agrus_multi_copy_ability_replay';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('persists one copyTriggeredAbilityResolve per copy after optional pay and replays them', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = seedAgrusMultiCopyBoard(game, playerId);
    const effectText =
      'You may pay {2}. If you do, copy that ability for each other creature you control that ability could target.';

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: () => undefined }) };
    const eventStart = getEvents(gameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Agrus Kos, Eternal Soldier',
      effectText,
      {
        id: 'agrus_trigger_replay_1',
        permanentId: 'agrus_1',
        source: 'agrus_1',
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

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);
    expect(Number((game.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(2);

    const replayEvents = toReplayEvents(gameId, eventStart);
    const copyEvents = replayEvents.filter((event: any) => event.type === 'copyTriggeredAbilityResolve');
    expect(copyEvents).toHaveLength(2);
    expect(copyEvents.every((event: any) => event.triggeringStackItemId === triggeringStackId)).toBe(true);
    expect(copyEvents.every((event: any) => event.sourceName === 'Agrus Kos, Eternal Soldier')).toBe(true);
    expect(copyEvents.every((event: any) => event.paid === true)).toBe(true);
    expect(new Set(copyEvents.map((event: any) => event.copiedStackItemId)).size).toBe(2);

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

    const replayGame = createInitialGameState(`${gameId}_replay`);
    seedAgrusMultiCopyBoard(replayGame, playerId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayStackItems = getStackItems((replayGame.state as any).stack);
    const replayCopies = replayStackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(replayCopies).toHaveLength(2);
    expect(replayCopies.every((item: any) => item?.copiedBySourceName === 'Agrus Kos, Eternal Soldier')).toBe(true);
    expect(replayStackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);
    expect(Number((replayGame.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(2);
  });

  it('replays hybrid {1}{R/W} optional pay from Effect Program', async () => {
    const hybridGameId = `${gameId}_hybrid`;
    await resetGame(hybridGameId);
    await resetGame(`${hybridGameId}_replay`);

    createGameIfNotExists(hybridGameId, 'commander', 40);
    const game = ensureGame(hybridGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = 'stack_shock_trooper_ability_replay_hybrid_1';
    const effectText =
      'You may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.';

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      { id: 'agrus_1', controller: playerId, card: { type_line: 'Legendary Creature — Soldier' } },
      { id: 'bear_1', controller: playerId, card: { type_line: 'Creature — Bear' } },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: playerId,
        source: 'shock_trooper_1',
        sourceName: 'Shock Trooper',
        abilityText: '{R}: Target creature gets +1/+0 until end of turn.',
        targets: ['agrus_1'],
        copyRetargetValidTargets: [
          { id: 'agrus_1', type: 'permanent' },
          { id: 'bear_1', type: 'permanent' },
        ],
      },
    ];

    (game as any).gameId = hybridGameId;
    (game as any).io = { to: () => ({ emit: () => undefined }) };
    const eventStart = getEvents(hybridGameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Agrus Kos, Eternal Soldier',
      effectText,
      {
        id: 'agrus_trigger_replay_hybrid_1',
        permanentId: 'agrus_1',
        source: 'agrus_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const payStep = ResolutionQueueManager
      .getStepsForPlayer(hybridGameId, playerId)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.effectProgramPrompt === true);
    expect(payStep).toBeDefined();

    resumeEffectProgramResolution({
      game,
      gameId: hybridGameId,
      step: payStep!,
      response: { selections: ['yes'] },
      persistPrompt: false,
    });

    expect(getStackItems((game.state as any).stack).filter((item: any) => item?.copiedFromStackItemId === triggeringStackId)).toHaveLength(1);
    expect(Number((game.state as any).manaPool?.[playerId]?.white || 0)).toBe(0);
    expect(Number((game.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(0);

    const replayEvents = toReplayEvents(hybridGameId, eventStart);
    expect(replayEvents.filter((event: any) => event.type === 'optionalPaymentPromptResolve')).toEqual([
      expect.objectContaining({
        type: 'optionalPaymentPromptResolve',
        playerId,
        choiceId: 'pay',
        manaCost: '{1}{R/W}',
      }),
    ]);

    const replayGame = createInitialGameState(`${hybridGameId}_replay`);
    (replayGame.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).life = { [playerId]: 40 };
    (replayGame.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (replayGame.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: playerId,
        sourceName: 'Shock Trooper',
        targets: ['agrus_1'],
      },
    ];

    replayGame.replay(replayEvents as any);

    expect(Number((replayGame.state as any).manaPool?.[playerId]?.white || 0)).toBe(0);
    expect(Number((replayGame.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(0);
    expect(getStackItems((replayGame.state as any).stack).filter((item: any) => item?.copiedFromStackItemId === triggeringStackId)).toHaveLength(1);

    await resetGame(hybridGameId);
    await resetGame(`${hybridGameId}_replay`);
  });

  it('persists retarget prompts for each ability copy and replays them onto the resolution queue', async () => {
    const retargetGameId = `${gameId}_retarget_prompts`;
    await resetGame(retargetGameId);
    await resetGame(`${retargetGameId}_replay`);

    createGameIfNotExists(retargetGameId, 'commander', 40);
    const game = ensureGame(retargetGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = seedAgrusMultiCopyBoard(game, playerId);
    const effectText =
      'copy that ability for each other creature you control that ability could target. You may choose new targets for the copies.';

    (game.state as any).stack[0] = {
      ...(game.state as any).stack[0],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
    };

    (game as any).gameId = retargetGameId;
    (game as any).io = { to: () => ({ emit: () => undefined }) };
    const eventStart = getEvents(retargetGameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Agrus Kos, Eternal Soldier',
      effectText,
      {
        id: 'agrus_trigger_retarget_replay_1',
        permanentId: 'agrus_1',
        source: 'agrus_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);

    const retargetSteps = ResolutionQueueManager
      .getStepsForPlayer(retargetGameId, playerId)
      .filter((step: any) => step?.retargetAbilityCopy === true);
    expect(retargetSteps).toHaveLength(2);

    const replayEvents = toReplayEvents(retargetGameId, eventStart);
    expect(replayEvents.filter((event: any) => event.type === 'copyTriggeredAbilityResolve')).toHaveLength(2);
    const promptEvents = replayEvents.filter((event: any) => event.type === 'resolveTopOfStackPrompt');
    expect(promptEvents.filter((event: any) => event.queuedResolutionStep?.retargetAbilityCopy === true)).toHaveLength(2);

    const replayGame = createInitialGameState(`${retargetGameId}_replay`);
    seedAgrusMultiCopyBoard(replayGame, playerId);
    (replayGame.state as any).stack[0] = {
      ...(replayGame.state as any).stack[0],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
    };

    replayGame.replay(replayEvents as any);

    expect(getStackItems((replayGame.state as any).stack).filter((item: any) => item?.copiedFromStackItemId === triggeringStackId)).toHaveLength(2);
    const replayRetargetSteps = ResolutionQueueManager
      .getStepsForPlayer(`${retargetGameId}_replay`, playerId)
      .filter((step: any) => step?.retargetAbilityCopy === true);
    expect(replayRetargetSteps).toHaveLength(2);
    expect(new Set(replayRetargetSteps.map((step: any) => String(step?.retargetAbilityCopyStackItemId || '')))).toEqual(
      new Set(getStackItems((replayGame.state as any).stack)
        .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId)
        .map((copy: any) => String(copy?.id || ''))),
    );

    await resetGame(retargetGameId);
    await resetGame(`${retargetGameId}_replay`);
  });

  it('persists and replays retargetAbilityCopyResolve for each multi-copy retarget choice', async () => {
    const retargetResolveGameId = `${gameId}_retarget_resolve`;
    await resetGame(retargetResolveGameId);
    await resetGame(`${retargetResolveGameId}_replay`);

    createGameIfNotExists(retargetResolveGameId, 'commander', 40);
    const game = ensureGame(retargetResolveGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const triggeringStackId = seedAgrusMultiCopyBoard(game, playerId);
    const effectText =
      'copy that ability for each other creature you control that ability could target. You may choose new targets for the copies.';

    (game.state as any).stack[0] = {
      ...(game.state as any).stack[0],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetValidTargets: [
        { id: 'agrus_1', type: 'permanent' },
        { id: 'bear_1', type: 'permanent' },
        { id: 'bear_2', type: 'permanent' },
      ],
    };

    (game as any).gameId = retargetResolveGameId;
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(retargetResolveGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    (game as any).io = io;

    const eventStart = getEvents(retargetResolveGameId).length;

    executeTriggerEffect(
      game as any,
      playerId,
      'Agrus Kos, Eternal Soldier',
      effectText,
      {
        id: 'agrus_trigger_retarget_resolve_1',
        permanentId: 'agrus_1',
        source: 'agrus_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);

    const retargetTargets = ['bear_1', 'bear_2'];
    const expectedTargetsByCopyId = new Map<string, string>();
    for (let copyIndex = 0; copyIndex < copies.length; copyIndex += 1) {
      const retargetChoiceStep = ResolutionQueueManager
        .getStepsForPlayer(retargetResolveGameId, playerId)[0];
      expect(retargetChoiceStep?.retargetAbilityCopy).toBe(true);
      const copyId = String((retargetChoiceStep as any)?.retargetAbilityCopyStackItemId || '');

      await handlers['submitResolutionResponse']({
        gameId: retargetResolveGameId,
        stepId: String((retargetChoiceStep as any).id),
        selections: ['retarget'],
        cancelled: false,
      });

      const retargetTargetStep = ResolutionQueueManager
        .getStepsForPlayer(retargetResolveGameId, playerId)[0];
      expect(retargetTargetStep?.retargetAbilityCopyTargetSelection).toBe(true);
      expect(String((retargetTargetStep as any)?.retargetAbilityCopyStackItemId || '')).toBe(copyId);

      await handlers['submitResolutionResponse']({
        gameId: retargetResolveGameId,
        stepId: String((retargetTargetStep as any).id),
        selections: [retargetTargets[copyIndex]],
        cancelled: false,
      });

      expectedTargetsByCopyId.set(copyId, retargetTargets[copyIndex]);
      const updatedCopy = getStackItems((game.state as any).stack).find((item: any) => item?.id === copyId);
      expect(updatedCopy?.targets).toEqual([retargetTargets[copyIndex]]);
    }

    const replayEvents = toReplayEvents(retargetResolveGameId, eventStart);
    expect(replayEvents.filter((event: any) => event.type === 'retargetAbilityCopyResolve')).toHaveLength(2);
    expect(replayEvents.filter((event: any) => event.type === 'copyRetargetChoiceResolve')).toHaveLength(2);

    const replayGame = createInitialGameState(`${retargetResolveGameId}_replay`);
    seedAgrusMultiCopyBoard(replayGame, playerId);
    (replayGame.state as any).stack[0] = {
      ...(replayGame.state as any).stack[0],
      copyRetargetMinTargets: 1,
      copyRetargetMaxTargets: 1,
      copyRetargetValidTargets: [
        { id: 'agrus_1', type: 'permanent' },
        { id: 'bear_1', type: 'permanent' },
        { id: 'bear_2', type: 'permanent' },
      ],
    };

    replayGame.replay(replayEvents as any);

    const replayCopies = getStackItems((replayGame.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(replayCopies).toHaveLength(2);
    for (const copy of replayCopies) {
      const copyId = String(copy?.id || '');
      expect(copy?.targets).toEqual([expectedTargetsByCopyId.get(copyId)]);
    }
    expect(ResolutionQueueManager.getStepsForPlayer(`${retargetResolveGameId}_replay`, playerId)).toEqual([]);

    await resetGame(retargetResolveGameId);
    await resetGame(`${retargetResolveGameId}_replay`);
  });
});
