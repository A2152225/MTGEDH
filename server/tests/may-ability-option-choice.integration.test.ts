import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, queueMayAbilityStep, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('May ability OPTION_CHOICE integration', () => {
  const gameId = 'test_may_ability_option_choice_integration';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('executes the registered callback when the player accepts', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    let callbackCount = 0;
    queueMayAbilityStep(createNoopIo() as any, gameId, game, p1, 'Test Source', 'draw a card', 'When this happens, you may draw a card.', async () => {
      callbackCount += 1;
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).mayAbilityPrompt === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['yes'],
      cancelled: false,
    });

    expect(callbackCount).toBe(1);
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === String((step as any).id))).toBe(false);
  });

  it('does not execute the registered callback when the player declines', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };

    let callbackCount = 0;
    let declineCount = 0;
    queueMayAbilityStep(createNoopIo() as any, gameId, game, p1, 'Test Source', 'draw a card', 'When this happens, you may draw a card.', async () => {
      callbackCount += 1;
    }, async () => {
      declineCount += 1;
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'option_choice' && (s as any).mayAbilityPrompt === true);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['no'],
      cancelled: true,
    });

    expect(callbackCount).toBe(0);
    expect(declineCount).toBe(1);
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === String((step as any).id))).toBe(false);
  });

  it('auto-executes the callback when a saved always_yes trigger shortcut matches the source card', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).triggerShortcuts = {
      [p1]: [
        { cardName: "soul's attendant", playerId: p1, preference: 'always_yes' },
      ],
    };

    let callbackCount = 0;
    queueMayAbilityStep(createNoopIo() as any, gameId, game, p1, "Soul's Attendant", 'gain 1 life', 'Whenever another creature enters the battlefield, you may gain 1 life.', async () => {
      callbackCount += 1;
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(callbackCount).toBe(1);
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => (s as any).mayAbilityPrompt === true)).toBe(false);
  });

  it('auto-declines when a saved always_no trigger shortcut matches the source card', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).triggerShortcuts = {
      [p1]: [
        { cardName: "soul's attendant", playerId: p1, preference: 'always_no' },
      ],
    };

    let callbackCount = 0;
    let declineCount = 0;
    queueMayAbilityStep(createNoopIo() as any, gameId, game, p1, "Soul's Attendant", 'gain 1 life', 'Whenever another creature enters the battlefield, you may gain 1 life.', async () => {
      callbackCount += 1;
    }, async () => {
      declineCount += 1;
    });

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(callbackCount).toBe(0);
    expect(declineCount).toBe(1);
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => (s as any).mayAbilityPrompt === true)).toBe(false);
  });

  it('auto-executes for Judge of Currents now that it is eligible as a may-trigger shortcut', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).triggerShortcuts = {
      [p1]: [
        { cardName: 'Judge of Currents', playerId: p1, preference: 'always_yes' },
      ],
    };

    let callbackCount = 0;
    queueMayAbilityStep(
      createNoopIo() as any,
      gameId,
      game,
      p1,
      'Judge of Currents',
      'gain 1 life',
      'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
      async () => {
        callbackCount += 1;
      }
    );

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(callbackCount).toBe(1);
    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => (s as any).mayAbilityPrompt === true)).toBe(false);
  });
});