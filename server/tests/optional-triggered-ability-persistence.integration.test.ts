import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

function pushOptionalSoulAttendantTrigger(game: any, playerId: string) {
  (game.state as any).stack = [
    {
      id: 'trigger_1',
      type: 'triggered_ability',
      controller: playerId,
      source: 'soul_attendant_1',
      sourceName: "Soul's Attendant",
      description: 'You may gain 1 life.',
      effect: 'You may gain 1 life.',
      triggerType: 'creature_etb',
      mandatory: false,
      requiresChoice: true,
    },
  ];
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('optional triggered ability persistence (integration)', () => {
  const acceptGameId = 'test_optional_trigger_persistence_accept';
  const declineGameId = 'test_optional_trigger_persistence_decline';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of [acceptGameId, declineGameId]) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of [acceptGameId, declineGameId]) {
      await resetGame(gameId);
    }
  });

  it('persists the queued optional-trigger prompt and an accept response', async () => {
    createGameIfNotExists(acceptGameId, 'commander', 40);
    const game = ensureGame(acceptGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = acceptGameId;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    pushOptionalSoulAttendantTrigger(game, playerId);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(acceptGameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).optionalTriggeredAbilityPrompt === true);
    expect(step).toBeDefined();

    const promptEvent = getEvents(acceptGameId).find((event: any) => String(event?.type || '') === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId,
      queuedResolutionStep: {
        optionalTriggeredAbilityPrompt: true,
        playerId,
        sourceName: "Soul's Attendant",
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(acceptGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: acceptGameId,
      stepId: String((step as any).id),
      selections: ['yes'],
      cancelled: false,
    });

    const choiceEvent = getEvents(acceptGameId).find((event: any) => String(event?.type || '') === 'optionalTriggeredAbilityChoice') as any;
    expect(choiceEvent).toBeDefined();
    expect(choiceEvent.payload).toMatchObject({
      playerId,
      choice: 'yes',
      sourceName: "Soul's Attendant",
      resolvedStepId: String((step as any).id),
    });
    expect((choiceEvent.payload as any).deferredTriggeredAbilityItem).toMatchObject({
      sourceName: "Soul's Attendant",
      optionalTriggeredAbilityDecisionApplied: true,
    });
    expect((game.state as any).life[playerId]).toBe(41);
  });

  it('persists a decline response for an optional trigger', async () => {
    createGameIfNotExists(declineGameId, 'commander', 40);
    const game = ensureGame(declineGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = declineGameId;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    pushOptionalSoulAttendantTrigger(game, playerId);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(declineGameId);
    const step = queue.steps.find((queuedStep: any) => (queuedStep as any).optionalTriggeredAbilityPrompt === true);
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(declineGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId: declineGameId,
      stepId: String((step as any).id),
      selections: ['no'],
      cancelled: true,
    });

    const choiceEvent = getEvents(declineGameId).find((event: any) => String(event?.type || '') === 'optionalTriggeredAbilityChoice') as any;
    expect(choiceEvent).toBeDefined();
    expect(choiceEvent.payload).toMatchObject({
      playerId,
      choice: 'no',
      sourceName: "Soul's Attendant",
      resolvedStepId: String((step as any).id),
    });
    expect((game.state as any).life[playerId]).toBe(40);
  });
});