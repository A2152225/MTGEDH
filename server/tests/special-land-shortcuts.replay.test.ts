import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('special land shortcut replay persistence', () => {
  const gameId = 'test_special_land_shortcuts_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const id of [
      gameId,
      `${gameId}_hybrid`,
      `${gameId}_storage`,
      `${gameId}_storage_remove`,
      `${gameId}_hideaway`,
      `${gameId}_rehydrated`,
      `${gameId}_hybrid_rehydrated`,
      `${gameId}_storage_rehydrated`,
      `${gameId}_storage_remove_rehydrated`,
      `${gameId}_hideaway_rehydrated`,
    ]) {
      await resetGame(id);
    }
  });

  afterEach(async () => {
    for (const id of [
      gameId,
      `${gameId}_hybrid`,
      `${gameId}_storage`,
      `${gameId}_storage_remove`,
      `${gameId}_hideaway`,
      `${gameId}_rehydrated`,
      `${gameId}_hybrid_rehydrated`,
      `${gameId}_storage_rehydrated`,
      `${gameId}_storage_remove_rehydrated`,
      `${gameId}_hideaway_rehydrated`,
    ]) {
      await resetGame(id);
    }
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

  it('persists and replays hybrid special-land queue state', async () => {
    const hybridGameId = `${gameId}_hybrid`;
    const p1 = 'p1';
    createGameIfNotExists(hybridGameId, 'commander', 40);
    const game = ensureGame(hybridGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 } };
    (game.state as any).battlefield = [
      {
        id: 'cairns_1',
        controller: p1,
        owner: p1,
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
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(hybridGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hybridGameId, permanentId: 'cairns_1', abilityId: 'cairns_1-ability-1' });

    const persisted = [...getEvents(hybridGameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect(persisted?.payload?.tappedPermanents).toEqual(['cairns_1']);
    expect(persisted?.payload?.paymentManaDelta).toEqual({ black: -1 });
    expect(persisted?.payload?.queuedResolutionStep).toMatchObject({
      type: 'mana_color_selection',
      playerId: p1,
      permanentId: 'cairns_1',
      cardName: 'Graven Cairns',
      selectionKind: 'distribution',
      totalAmount: 2,
      availableColors: ['B', 'R'],
    });

    ResolutionQueueManager.removeQueue(hybridGameId);
    const replayGameId = `${hybridGameId}_rehydrated`;
    const replayGame = createInitialGameState(replayGameId);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
    };
    (replayGame.state as any).battlefield = [
      {
        id: 'cairns_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'cairns_card_1',
          name: 'Graven Cairns',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{B/R}, {T}: Add {B}{B}, {B}{R}, or {R}{R}.',
        },
      },
    ];

    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(persisted.payload || {}) } as any);

    const permanent = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'cairns_1');
    const queue = ResolutionQueueManager.getQueue(replayGameId);
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number((replayGame.state as any).manaPool?.[p1]?.black || 0)).toBe(0);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect(Number((queue.steps[0] as any)?.totalAmount || 0)).toBe(2);
    expect((queue.steps[0] as any)?.availableColors).toEqual(['B', 'R']);
    expect(String((queue.steps[0] as any)?.id || '')).toBe(String(persisted?.payload?.queuedResolutionStep?.id || ''));
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

    const replayGameId = `${storageGameId}_rehydrated`;
    const replayGame = createInitialGameState(replayGameId);
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

  it('persists and replays storage-counter mana-selection queue state', async () => {
    const storageGameId = `${gameId}_storage_remove`;
    const p1 = 'p1';
    createGameIfNotExists(storageGameId, 'commander', 40);
    const game = ensureGame(storageGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 } };
    (game.state as any).battlefield = [
      {
        id: 'calciform_2',
        controller: p1,
        owner: p1,
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
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(storageGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: storageGameId, permanentId: 'calciform_2', abilityId: 'calciform_2-ability-2' });

    const persisted = [...getEvents(storageGameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect(persisted?.payload?.tappedPermanents).toEqual(['calciform_2']);
    expect(persisted?.payload?.queuedResolutionStep).toMatchObject({
      type: 'mana_color_selection',
      playerId: p1,
      permanentId: 'calciform_2',
      cardName: 'Calciform Pools',
      selectionKind: 'distribution',
      totalAmount: 3,
      availableColors: ['W', 'U'],
      isStorageCounter: true,
      counterType: 'storage',
      removeCounterCount: 3,
    });

    ResolutionQueueManager.removeQueue(storageGameId);
    const replayGameId = `${storageGameId}_rehydrated`;
    const replayGame = createInitialGameState(replayGameId);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (replayGame.state as any).battlefield = [
      {
        id: 'calciform_2',
        controller: p1,
        owner: p1,
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

    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(persisted.payload || {}) } as any);

    const permanent = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'calciform_2');
    const queue = ResolutionQueueManager.getQueue(replayGameId);
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect(Number(permanent?.counters?.storage || 0)).toBe(3);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect(Number((queue.steps[0] as any)?.removeCounterCount || 0)).toBe(3);
    expect((queue.steps[0] as any)?.availableColors).toEqual(['W', 'U']);
    expect(String((queue.steps[0] as any)?.id || '')).toBe(String(persisted?.payload?.queuedResolutionStep?.id || ''));
  });

  it('persists and replays hideaway shortcut state', async () => {
    const hideawayGameId = `${gameId}_hideaway`;
    const p1 = 'p1';
    createGameIfNotExists(hideawayGameId, 'commander', 40);
    const game = ensureGame(hideawayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const hiddenCard = { id: 'hidden_1', name: 'Secret Spell', type_line: 'Sorcery', oracle_text: 'Draw two cards.' };
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).creaturesAttackedThisTurn = { [p1]: 3 };
    (game.state as any).manaPool = {
      [p1]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 } };
    (game.state as any).battlefield = [
      {
        id: 'windbrisk_1',
        controller: p1,
        owner: p1,
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
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(hideawayGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'windbrisk_1', abilityId: 'windbrisk_1-ability-1' });

    const persisted = [...getEvents(hideawayGameId)].reverse().find((event: any) => event?.type === 'activateBattlefieldAbility') as any;
    expect(persisted?.payload?.tappedPermanents).toEqual(['windbrisk_1']);
    expect(persisted?.payload?.paymentManaDelta).toEqual({ white: -1 });
    expect(persisted?.payload?.hideawayMovedCardToHand).toMatchObject({ id: 'hidden_1', name: 'Secret Spell', zone: 'hand' });
    expect(persisted?.payload?.clearedHideawayPermanentId).toBe('windbrisk_1');

    const replayGame = createInitialGameState(`${hideawayGameId}_rehydrated`);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).manaPool = {
      [p1]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (replayGame.state as any).zones = { [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 } };
    (replayGame.state as any).battlefield = [
      {
        id: 'windbrisk_1',
        controller: p1,
        owner: p1,
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

    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(persisted.payload || {}) } as any);

    const permanent = ((replayGame.state as any).battlefield || []).find((entry: any) => entry.id === 'windbrisk_1');
    const hand = (replayGame.state as any).zones?.[p1]?.hand || [];
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect((permanent as any)?.hideawayCard).toBeUndefined();
    expect(Number((replayGame.state as any).manaPool?.[p1]?.white || 0)).toBe(0);
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Secret Spell');
  });
});