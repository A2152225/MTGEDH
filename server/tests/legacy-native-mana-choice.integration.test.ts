import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

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
    sockets: {
      sockets: new Map(),
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
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
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

describe('legacy native mana choice ids (integration)', () => {
  const gameIds = [
    'test_legacy_native_mana_choice_pain',
    'test_legacy_native_mana_choice_pay_life',
    'test_legacy_native_mana_choice_multi',
  ];

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of gameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of gameIds) {
      await resetGame(gameId);
    }
  });

  it('queues the legacy native_choice_2 pain-land choice instead of collapsing to the first printed mana line', async () => {
    const gameId = gameIds[0];
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'shivan_reef_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'shivan_reef_card_1',
          name: 'Shivan Reef',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{T}: Add {U} or {R}. This land deals 1 damage to you.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'shivan_reef_1',
      abilityId: 'native_choice_2',
    });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'shivan_reef_1');
    expect(Boolean(permanent?.tapped)).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect((queue.steps[0] as any)?.selectionKind).toBe('any_color');
    expect([...(queue.steps[0] as any)?.allowedColors || []].sort()).toEqual(['R', 'U']);
    expect((queue.steps[0] as any)?.abilityId).toBe('native_choice_2');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(queue.steps[0]?.id || ''),
      selections: 'red',
    });

    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 });
    expect((game.state as any).life?.[playerId]).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId]).toBe(1);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(1);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const manaEvents = getEvents(gameId).filter((event) => String(event?.type) === 'activateManaAbility');
    expect(manaEvents.length).toBeGreaterThan(0);
    const lastManaEvent = manaEvents[manaEvents.length - 1] as any;
    expect(lastManaEvent?.payload?.abilityId).toBe('native_choice_2');
    expect(lastManaEvent?.payload?.addedMana).toEqual({ red: 1 });
    expect(lastManaEvent?.payload?.lifeLost).toBe(1);
    expect(lastManaEvent?.payload?.lifeLossIsDamage).toBe(true);
  });

  it('queues the legacy native_pay_life choice and persists pay-life as an activation cost', async () => {
    const gameId = gameIds[1];
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'caves_of_koilos_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'caves_of_koilos_card_1',
          name: 'Caves of Koilos',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{T}, Pay 1 life: Add {W} or {B}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'caves_of_koilos_1',
      abilityId: 'native_pay_life',
    });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'caves_of_koilos_1');
    expect(Boolean(permanent?.tapped)).toBe(true);

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect((queue.steps[0] as any)?.selectionKind).toBe('any_color');
    expect([...(queue.steps[0] as any)?.allowedColors || []].sort()).toEqual(['B', 'W']);
    expect((queue.steps[0] as any)?.abilityId).toBe('native_pay_life');
    expect((queue.steps[0] as any)?.lifeToPayForCost).toBe(1);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(queue.steps[0]?.id || ''),
      selections: 'black',
    });

    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 });
    expect((game.state as any).life?.[playerId]).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId]).toBe(0);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(1);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const manaEvents = getEvents(gameId).filter((event) => String(event?.type) === 'activateManaAbility');
    expect(manaEvents.length).toBeGreaterThan(0);
    const lastManaEvent = manaEvents[manaEvents.length - 1] as any;
    expect(lastManaEvent?.payload?.abilityId).toBe('native_pay_life');
    expect(lastManaEvent?.payload?.addedMana).toEqual({ black: 1 });
    expect(lastManaEvent?.payload?.lifeLost).toBeUndefined();
    expect(lastManaEvent?.payload?.lifeLossIsDamage).toBeUndefined();

    const activationEvents = getEvents(gameId).filter((event) => String(event?.type) === 'activateBattlefieldAbility');
    expect(activationEvents.length).toBeGreaterThan(0);
    const lastActivationEvent = activationEvents[activationEvents.length - 1] as any;
    expect(lastActivationEvent?.payload?.abilityId).toBe('native_pay_life');
    expect(lastActivationEvent?.payload?.lifePaidForCost).toBe(1);
  });

  it('adds all colors for the legacy native_multi bounce-land id', async () => {
    const gameId = gameIds[2];
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'rakdos_carnarium_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'rakdos_carnarium_card_1',
          name: 'Rakdos Carnarium',
          type_line: 'Land',
          oracle_text: 'Rakdos Carnarium enters tapped.\nWhen Rakdos Carnarium enters, return a land you control to its owner\'s hand.\n{T}: Add {B}{R}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'rakdos_carnarium_1',
      abilityId: 'native_multi',
    });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'rakdos_carnarium_1');
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 1, red: 1, green: 0, colorless: 0 });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(0);

    const manaEvents = getEvents(gameId).filter((event) => String(event?.type) === 'activateManaAbility');
    expect(manaEvents.length).toBeGreaterThan(0);
    const lastManaEvent = manaEvents[manaEvents.length - 1] as any;
    expect(lastManaEvent?.payload?.abilityId).toBe('native_multi');
    expect(lastManaEvent?.payload?.manaColor).toBe('MULTI');
    expect(lastManaEvent?.payload?.addedMana).toEqual({ black: 1, red: 1 });
  });
});