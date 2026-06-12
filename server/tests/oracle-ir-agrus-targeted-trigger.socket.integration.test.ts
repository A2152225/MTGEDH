import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
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
  games.delete(gameId as any);
  await deleteGame(gameId);
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

describe('Oracle IR Agrus targeted trigger socket activation', () => {
  const gameId = 'test_oracle_ir_agrus_targeted_trigger_socket';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
  });

  it('queues Agrus when Shock Trooper ability targets it through activateBattlefieldAbility', async () => {
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

    const eventStart = getEvents(gameId).length;

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'shock_trooper_1',
      abilityId: 'shock_trooper_1-ability-0',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => step?.battlefieldAbilityTargetSelection === true && String(step?.permanentId || step?.sourceId) === 'shock_trooper_1');
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['agrus_1'],
      cancelled: false,
    });

    const stackItems = getStackItems((game.state as any).stack);
    const abilityStackItem = stackItems.find((item: any) => item?.type === 'ability' && item?.source === 'shock_trooper_1');
    expect(abilityStackItem).toBeDefined();
    expect(abilityStackItem?.targets).toEqual(['agrus_1']);

    const agrusTrigger = stackItems.find((item: any) => item?.triggerType === 'targeted' && item?.source === 'agrus_1');
    expect(agrusTrigger).toBeDefined();
    expect(String(agrusTrigger?.description || '')).toMatch(/copy that ability/i);
    expect(agrusTrigger?.triggeringStackItemId).toBe(abilityStackItem?.id);

    const replayEvents = getEvents(gameId)
      .slice(eventStart)
      .map((event: any) =>
        event?.payload && typeof event.payload === 'object'
          ? { type: event.type, ...(event.payload as Record<string, unknown>) }
          : { type: event.type },
      );
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['activateBattlefieldAbility', 'pushTriggeredAbility']),
    );
  });

  it('multi-copies the triggering ability after optional pay when Agrus trigger resolves from stack', async () => {
    const multiCopyGameId = `${gameId}_multipay`;
    await resetGame(multiCopyGameId);

    createGameIfNotExists(multiCopyGameId, 'commander', 40);
    const game = ensureGame(multiCopyGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedAgrusActivationBoard(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(multiCopyGameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);
    (game as any).io = io;

    await handlers['activateBattlefieldAbility']({
      gameId: multiCopyGameId,
      permanentId: 'shock_trooper_1',
      abilityId: 'shock_trooper_1-ability-0',
    });

    const targetStep = ResolutionQueueManager
      .getStepsForPlayer(multiCopyGameId, playerId)[0];
    expect(targetStep?.battlefieldAbilityTargetSelection).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: multiCopyGameId,
      stepId: String((targetStep as any).id),
      selections: ['agrus_1'],
      cancelled: false,
    });

    const stackItemsBeforeResolve = getStackItems((game.state as any).stack);
    const abilityStackItem = stackItemsBeforeResolve.find((item: any) => item?.type === 'ability' && item?.source === 'shock_trooper_1');
    expect(abilityStackItem).toBeDefined();
    const triggeringStackId = String(abilityStackItem?.id || '');

    game.resolveTopOfStack();

    for (let payPromptIndex = 0; payPromptIndex < 2; payPromptIndex += 1) {
      const payStep = ResolutionQueueManager.getStepsForPlayer(multiCopyGameId, playerId)[0];
      expect(payStep?.type).toBe(ResolutionStepType.OPTION_CHOICE);
      expect((payStep as any)?.effectProgramPrompt).toBe(true);

      await handlers['submitResolutionResponse']({
        gameId: multiCopyGameId,
        stepId: String((payStep as any).id),
        selections: ['yes'],
        cancelled: false,
      });
    }

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(3);
    expect(copies.every((item: any) => item?.copiedBySourceName === 'Agrus Kos, Eternal Soldier')).toBe(true);
    expect(Number((game.state as any).manaPool?.[playerId]?.white || 0)).toBe(0);
    expect(Number((game.state as any).manaPool?.[playerId]?.red || 0)).toBe(0);
    expect(getStackItems((game.state as any).stack).some((item: any) => item?.id === triggeringStackId)).toBe(true);

    await resetGame(multiCopyGameId);
  });
});
