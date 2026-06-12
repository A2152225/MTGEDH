import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
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

function seedAgrusActivationBoard(game: any, playerId: string) {
  const agrusOracleText =
    'Whenever Agrus Kos becomes the target of an ability that targets only it, you may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.';

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).manaPool = {
    [playerId]: { white: 1, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
  };
  (game.state as any).battlefield = [
    {
      id: 'agrus_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        name: 'Agrus Kos, Eternal Soldier',
        type_line: 'Legendary Creature — Soldier',
        oracle_text: agrusOracleText,
      },
    },
    {
      id: 'bear_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
    },
    {
      id: 'bear_2',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
    },
    {
      id: 'shock_trooper_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        name: 'Shock Trooper',
        type_line: 'Creature — Human Soldier',
        oracle_text: '{R}: Target creature gets +1/+0 until end of turn.',
      },
    },
  ];
  (game.state as any).zones = {
    [playerId]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
  };
}

describe('Oracle IR Agrus targeted trigger socket replay', () => {
  const gameId = 'test_oracle_ir_agrus_targeted_trigger_socket_replay';
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

  it('persists and replays activate → target → optional pay → multi-copy from socket flow', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedAgrusActivationBoard(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);
    (game as any).io = io;

    const eventStart = getEvents(gameId).length;

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'shock_trooper_1',
      abilityId: 'shock_trooper_1-ability-0',
    });

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0];
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['agrus_1'],
      cancelled: false,
    });

    const abilityStackItem = getStackItems((game.state as any).stack)
      .find((item: any) => item?.type === 'ability' && item?.source === 'shock_trooper_1');
    expect(abilityStackItem).toBeDefined();
    const triggeringStackId = String(abilityStackItem?.id || '');

    game.resolveTopOfStack();

    for (let payPromptIndex = 0; payPromptIndex < 2; payPromptIndex += 1) {
      const payStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0];
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String((payStep as any).id),
        selections: ['yes'],
        cancelled: false,
      });
    }

    const liveCopies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(liveCopies).toHaveLength(3);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.filter((event: any) => event.type === 'optionalPaymentPromptResolve')).toHaveLength(1);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining([
        'activateBattlefieldAbility',
        'pushTriggeredAbility',
        'optionalTriggeredAbilityChoice',
        'copyTriggeredAbilityResolve',
      ]),
    );
    expect(replayEvents.filter((event: any) => event.type === 'copyTriggeredAbilityResolve')).toHaveLength(3);
    expect(replayEvents.filter((event: any) => event.type === 'copyTriggeredAbilityResolve').every(
      (event: any) => event.paid === true && event.triggeringStackItemId === triggeringStackId,
    )).toBe(true);

    const replayGame = createInitialGameState(`${gameId}_replay`);
    seedAgrusActivationBoard(replayGame, playerId);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayAbility = getStackItems((replayGame.state as any).stack)
      .find((item: any) => item?.type === 'ability' && item?.source === 'shock_trooper_1' && !item?.copiedFromStackItemId);
    expect(replayAbility).toBeDefined();
    expect(replayAbility?.targets).toEqual(['agrus_1']);

    const replayCopies = getStackItems((replayGame.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === String(replayAbility?.id || ''));
    expect(replayCopies).toHaveLength(3);
    expect(replayCopies.every((item: any) => item?.copiedBySourceName === 'Agrus Kos, Eternal Soldier')).toBe(true);
    expect(Number((replayGame.state as any).manaPool?.[playerId]?.white || 0)).toBe(0);
    expect(Number((replayGame.state as any).manaPool?.[playerId]?.red || 0)).toBe(0);
    expect(ResolutionQueueManager.getStepsForPlayer(`${gameId}_replay`, playerId)).toEqual([]);
  });
});
