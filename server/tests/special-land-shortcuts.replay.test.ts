import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/priority.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
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

describe('special land shortcut replay persistence', () => {
  const gameId = 'test_special_land_shortcuts_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.removeQueue(`${gameId}_storage`);
    games.delete(gameId as any);
    games.delete(`${gameId}_storage` as any);
  });

  it('persists and replays Mutavault animation shortcut state', async () => {
    const p1 = 'p1';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 } };
    (game.state as any).battlefield = [
      {
        id: 'mutavault_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'mutavault_card_1',
          name: 'Mutavault',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{1}: Mutavault becomes a 2/2 creature with all creature types until end of turn. It\'s still a land.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'mutavault_1', abilityId: 'mutavault_1-ability-1' });

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect(persisted?.payload?.paymentManaDelta).toEqual({ colorless: -1 });
    expect(persisted?.payload?.specialAnimation).toMatchObject({
      animatedUntilEOT: true,
      basePower: 2,
      baseToughness: 2,
      hasAllCreatureTypes: true,
    });

    const replayGame = createInitialGameState(`${gameId}_rehydrated`);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (replayGame.state as any).battlefield = [
      {
        id: 'mutavault_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'mutavault_card_1',
          name: 'Mutavault',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{1}: Mutavault becomes a 2/2 creature with all creature types until end of turn. It\'s still a land.',
        },
      },
    ];

    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(persisted.payload || {}) } as any);

    const permanent = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'mutavault_1');
    expect(Number((replayGame.state as any).manaPool?.[p1]?.colorless || 0)).toBe(0);
    expect(permanent?.animatedUntilEOT).toBe(true);
    expect(Number(permanent?.basePower || 0)).toBe(2);
    expect(Number(permanent?.baseToughness || 0)).toBe(2);
    expect(Boolean(permanent?.hasAllCreatureTypes)).toBe(true);
  });

  it('persists and replays storage-counter shortcut state', async () => {
    const storageGameId = `${gameId}_storage`;
    const p1 = 'p1';
    createGameIfNotExists(storageGameId, 'commander', 40);
    const game = ensureGame(storageGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 } };
    (game.state as any).battlefield = [
      {
        id: 'calciform_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'calciform_card_1',
          name: 'Calciform Pools',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{1}, {T}: Put a storage counter on Calciform Pools.\n{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(storageGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: storageGameId, permanentId: 'calciform_1', abilityId: 'calciform_1-ability-1' });

    const persisted = [...getEvents(storageGameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect(persisted?.payload?.tappedPermanents).toEqual(['calciform_1']);
    expect(persisted?.payload?.paymentManaDelta).toEqual({ colorless: -1 });
    expect(persisted?.payload?.counterUpdates).toEqual([
      { permanentId: 'calciform_1', deltas: { storage: 1 } },
    ]);

    const replayGame = createInitialGameState(`${storageGameId}_rehydrated`);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (replayGame.state as any).battlefield = [
      {
        id: 'calciform_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'calciform_card_1',
          name: 'Calciform Pools',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{1}, {T}: Put a storage counter on Calciform Pools.\n{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
        },
      },
    ];

    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(persisted.payload || {}) } as any);

    const permanent = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'calciform_1');
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number(permanent?.counters?.storage || 0)).toBe(1);
    expect(Number((replayGame.state as any).manaPool?.[p1]?.colorless || 0)).toBe(0);
  });
});