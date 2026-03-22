import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
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

describe('special land generic ability routing (integration)', () => {
  const gameId = 'test_special_land_generic_ability_routing';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('routes Mutavault animation through the generic parsed ability id', async () => {
    const mutateGameId = `${gameId}_mutavault`;
    ResolutionQueueManager.removeQueue(mutateGameId);
    games.delete(mutateGameId as any);

    createGameIfNotExists(mutateGameId, 'commander', 40);
    const game = ensureGame(mutateGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mutavault_1',
        controller: playerId,
        owner: playerId,
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
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(mutateGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: mutateGameId, permanentId: 'mutavault_1', abilityId: 'mutavault_1-ability-1' });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'mutavault_1');
    expect(permanent?.animatedUntilEOT).toBe(true);
    expect(Number(permanent?.basePower || 0)).toBe(2);
    expect(Number(permanent?.baseToughness || 0)).toBe(2);
    expect(Boolean(permanent?.hasAllCreatureTypes)).toBe(true);

    const queue = ResolutionQueueManager.getQueue(mutateGameId);
    expect(queue.steps).toHaveLength(0);
  });

  it('routes Graven Cairns hybrid production through the generic parsed ability id', async () => {
    const hybridGameId = `${gameId}_hybrid_land`;
    ResolutionQueueManager.removeQueue(hybridGameId);
    games.delete(hybridGameId as any);

    createGameIfNotExists(hybridGameId, 'commander', 40);
    const game = ensureGame(hybridGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'cairns_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'cairns_card_1',
          name: 'Graven Cairns',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{B/R}, {T}: Add {B}{B}, {B}{R}, or {R}{R}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(hybridGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hybridGameId, permanentId: 'cairns_1', abilityId: 'cairns_1-ability-1' });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'cairns_1');
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number((game.state as any).manaPool?.[playerId]?.black || 0)).toBe(0);

    const queue = ResolutionQueueManager.getQueue(hybridGameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect(Number((queue.steps[0] as any)?.totalAmount || 0)).toBe(2);
  });

  it('routes Calciform Pools storage-counter addition through the generic parsed ability id', async () => {
    const storageAddGameId = `${gameId}_storage_add`;
    ResolutionQueueManager.removeQueue(storageAddGameId);
    games.delete(storageAddGameId as any);

    createGameIfNotExists(storageAddGameId, 'commander', 40);
    const game = ensureGame(storageAddGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'calciform_1',
        controller: playerId,
        owner: playerId,
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
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(storageAddGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: storageAddGameId, permanentId: 'calciform_1', abilityId: 'calciform_1-ability-1' });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'calciform_1');
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number(permanent?.counters?.storage || 0)).toBe(1);
    expect(Number((game.state as any).manaPool?.[playerId]?.colorless || 0)).toBe(0);

    const queue = ResolutionQueueManager.getQueue(storageAddGameId);
    expect(queue.steps).toHaveLength(0);
  });

  it('routes Calciform Pools storage-counter removal through the generic parsed ability id', async () => {
    const storageRemoveGameId = `${gameId}_storage_remove`;
    ResolutionQueueManager.removeQueue(storageRemoveGameId);
    games.delete(storageRemoveGameId as any);

    createGameIfNotExists(storageRemoveGameId, 'commander', 40);
    const game = ensureGame(storageRemoveGameId);
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
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'calciform_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { storage: 3 },
        card: {
          id: 'calciform_card_2',
          name: 'Calciform Pools',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{1}, {T}: Put a storage counter on Calciform Pools.\n{T}, Remove X storage counters from Calciform Pools: Add X mana in any combination of {W} and/or {U}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(storageRemoveGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: storageRemoveGameId, permanentId: 'calciform_2', abilityId: 'calciform_2-ability-2' });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'calciform_2');
    expect(Boolean(permanent?.tapped)).toBe(true);

    const queue = ResolutionQueueManager.getQueue(storageRemoveGameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect(Number((queue.steps[0] as any)?.removeCounterCount || 0)).toBe(3);
    expect(Number((queue.steps[0] as any)?.totalAmount || 0)).toBe(3);
  });

  it('routes Windbrisk Heights hideaway play through the generic parsed ability id', async () => {
    const hideawayGameId = `${gameId}_hideaway`;
    ResolutionQueueManager.removeQueue(hideawayGameId);
    games.delete(hideawayGameId as any);

    createGameIfNotExists(hideawayGameId, 'commander', 40);
    const game = ensureGame(hideawayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const hiddenCard = { id: 'hidden_1', name: 'Secret Spell', type_line: 'Sorcery', oracle_text: 'Draw two cards.' };
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'windbrisk_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        hideawayCard: { card: hiddenCard },
        card: {
          id: 'windbrisk_card_1',
          name: 'Windbrisk Heights',
          type_line: 'Land',
          oracle_text: 'Hideaway 4\n{T}: Add {W}.\n{W}, {T}: You may play the exiled card without paying its mana cost if you attacked with three or more creatures this turn.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(hideawayGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'windbrisk_1', abilityId: 'windbrisk_1-ability-1' });

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Secret Spell');

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'windbrisk_1');
    expect((permanent as any)?.hideawayCard).toBeUndefined();

    const queue = ResolutionQueueManager.getQueue(hideawayGameId);
    expect(queue.steps).toHaveLength(0);
  });
});