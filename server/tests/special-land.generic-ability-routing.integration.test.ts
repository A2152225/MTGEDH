import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, getEvents } from '../src/db/index.js';
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

  it('persists damage metadata for queued any-color mana activations', async () => {
    const damageChoiceGameId = `${gameId}_mana_confluence_damage`;
    ResolutionQueueManager.removeQueue(damageChoiceGameId);
    games.delete(damageChoiceGameId as any);

    createGameIfNotExists(damageChoiceGameId, 'commander', 40);
    const game = ensureGame(damageChoiceGameId);
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
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'confluence_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'confluence_card_1',
          name: 'Mana Confluence',
          type_line: 'Land',
          oracle_text: '{T}: Add one mana of any color. Whenever Mana Confluence is tapped for mana, it deals 1 damage to you.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(damageChoiceGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: damageChoiceGameId,
      permanentId: 'confluence_1',
      abilityId: 'confluence_card_1-ability-0',
    });

    let queue = ResolutionQueueManager.getQueue(damageChoiceGameId);
    expect(queue.steps).toHaveLength(1);
    expect(String(queue.steps[0]?.type || '')).toBe('mana_color_selection');
    expect((game.state as any).life?.[playerId]).toBe(40);

    await handlers['submitResolutionResponse']({
      gameId: damageChoiceGameId,
      stepId: String(queue.steps[0]?.id || ''),
      selections: 'green',
    });

    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 });
    expect((game.state as any).life?.[playerId]).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId]).toBe(1);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(1);

    queue = ResolutionQueueManager.getQueue(damageChoiceGameId);
    expect(queue.steps).toHaveLength(0);

    const events = getEvents(damageChoiceGameId);
    const manaEvents = events.filter((event) => String(event?.type) === 'activateManaAbility');
    expect(manaEvents.length).toBeGreaterThan(0);
    const lastManaEvent = manaEvents[manaEvents.length - 1] as any;
    expect(lastManaEvent?.payload?.addedMana).toEqual({ green: 1 });
    expect(lastManaEvent?.payload?.lifeLost).toBe(1);
    expect(lastManaEvent?.payload?.lifeLossIsDamage).toBe(true);
  });

  it('persists damage metadata for direct single-color mana activations', async () => {
    const directDamageGameId = `${gameId}_direct_pain_mana`;
    ResolutionQueueManager.removeQueue(directDamageGameId);
    games.delete(directDamageGameId as any);

    createGameIfNotExists(directDamageGameId, 'commander', 40);
    const game = ensureGame(directDamageGameId);
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
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'pain_grove_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'pain_grove_card_1',
          name: 'Pain Grove',
          type_line: 'Land',
          oracle_text: '{T}: Add {G}. Pain Grove deals 1 damage to you.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(directDamageGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: directDamageGameId,
      permanentId: 'pain_grove_1',
      abilityId: 'pain_grove_card_1-ability-0',
    });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'pain_grove_1');
    expect(Boolean(permanent?.tapped)).toBe(true);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 });
    expect((game.state as any).life?.[playerId]).toBe(39);
    expect((game.state as any).damageTakenThisTurnByPlayer?.[playerId]).toBe(1);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(1);

    const queue = ResolutionQueueManager.getQueue(directDamageGameId);
    expect(queue.steps).toHaveLength(0);

    const events = getEvents(directDamageGameId);
    const manaEvents = events.filter((event) => String(event?.type) === 'activateManaAbility');
    expect(manaEvents.length).toBeGreaterThan(0);
    const lastManaEvent = manaEvents[manaEvents.length - 1] as any;
    expect(lastManaEvent?.payload?.addedMana).toEqual({ green: 1 });
    expect(lastManaEvent?.payload?.lifeLost).toBe(1);
    expect(lastManaEvent?.payload?.lifeLossIsDamage).toBe(true);
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

    await handlers['submitResolutionResponse']({
      gameId: storageRemoveGameId,
      stepId: String(queue.steps[0]?.id || ''),
      selections: { W: 2, U: 1 },
    });

    expect(Number(permanent?.counters?.storage || 0)).toBe(0);
    expect((game.state as any).manaPool?.[playerId]).toEqual({ white: 2, blue: 1, black: 0, red: 0, green: 0, colorless: 0 });

    const events = getEvents(storageRemoveGameId);
    const activationEvents = events.filter((event) => String(event?.type) === 'activateBattlefieldAbility');
    expect(activationEvents.length).toBeGreaterThan(0);
    const lastActivation = activationEvents[activationEvents.length - 1] as any;
    expect(lastActivation?.payload?.tappedPermanents).toEqual([]);
    expect(lastActivation?.payload?.removedCountersForCost).toEqual([
      { permanentId: 'calciform_2', counterType: 'storage', count: 3 },
    ]);

    const manaEvents = events.filter((event) => String(event?.type) === 'activateManaAbility');
    expect(manaEvents.length).toBeGreaterThan(0);
    const lastManaEvent = manaEvents[manaEvents.length - 1] as any;
    expect(lastManaEvent?.payload?.addedMana).toEqual({ white: 2, blue: 1 });
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
    (game.state as any).creaturesAttackedThisTurn = { [playerId]: 0 };
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

    const failedError = emitted.find(entry => entry.event === 'error');
    expect(failedError?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');

    let hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(0);

    let permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'windbrisk_1');
    expect((permanent as any)?.hideawayCard).toBeDefined();

    emitted.length = 0;
    (game.state as any).creaturesAttackedThisTurn[playerId] = 3;

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'windbrisk_1', abilityId: 'windbrisk_1-ability-1' });

    hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Secret Spell');
    expect(Number((game.state as any).manaPool?.[playerId]?.white || 0)).toBe(0);

    permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'windbrisk_1');
    expect((permanent as any)?.hideawayCard).toBeUndefined();
    expect(Boolean((permanent as any)?.tapped)).toBe(true);

    const queue = ResolutionQueueManager.getQueue(hideawayGameId);
    expect(queue.steps).toHaveLength(0);
  });

  it('requires total creature power for Mosswort Bridge hideaway play', async () => {
    const hideawayGameId = `${gameId}_mosswort`;
    ResolutionQueueManager.removeQueue(hideawayGameId);
    games.delete(hideawayGameId as any);

    createGameIfNotExists(hideawayGameId, 'commander', 40);
    const game = ensureGame(hideawayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const hiddenCard = { id: 'hidden_mosswort_1', name: 'Oversized Secret', type_line: 'Creature', oracle_text: 'Trample' };
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mosswort_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        hideawayCard: { card: hiddenCard },
        card: {
          id: 'mosswort_card_1',
          name: 'Mosswort Bridge',
          type_line: 'Land',
          oracle_text: 'Hideaway 4\n{T}: Add {G}.\n{G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater.',
        },
      },
      {
        id: 'creature_small_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_small_card_1',
          name: 'Hill Giant',
          type_line: 'Creature — Giant',
          power: '3',
          toughness: '3',
          oracle_text: '',
        },
      },
      {
        id: 'creature_small_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'creature_small_card_2',
          name: 'Runeclaw Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(hideawayGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'mosswort_1', abilityId: 'mosswort_1-ability-1' });

    const failedError = emitted.find(entry => entry.event === 'error');
    expect(failedError?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(((game.state as any).zones?.[playerId]?.hand || [])).toHaveLength(0);

    emitted.length = 0;
    (game.state as any).battlefield.push({
      id: 'creature_large_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      card: {
        id: 'creature_large_card_1',
        name: 'Colossal Dreadmaw',
        type_line: 'Creature — Dinosaur',
        power: '6',
        toughness: '6',
        oracle_text: 'Trample',
      },
    });

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'mosswort_1', abilityId: 'mosswort_1-ability-1' });

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Oversized Secret');
  });

  it('requires empty hands for Howltooth Hollow hideaway play', async () => {
    const hideawayGameId = `${gameId}_howltooth`;
    ResolutionQueueManager.removeQueue(hideawayGameId);
    games.delete(hideawayGameId as any);

    createGameIfNotExists(hideawayGameId, 'commander', 40);
    const game = ensureGame(hideawayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    const hiddenCard = { id: 'hidden_howltooth_1', name: 'Handless Secret', type_line: 'Sorcery', oracle_text: 'Target player discards two cards.' };
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [{ id: 'p1_card_1', name: 'Card A' }], handCount: 1, graveyard: [], graveyardCount: 0 },
      [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'howltooth_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        hideawayCard: { card: hiddenCard },
        card: {
          id: 'howltooth_card_1',
          name: 'Howltooth Hollow',
          type_line: 'Land',
          oracle_text: 'Hideaway 4\n{T}: Add {B}.\n{B}, {T}: You may play the exiled card without paying its mana cost if each player has no cards in hand.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(hideawayGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'howltooth_1', abilityId: 'howltooth_1-ability-1' });

    const failedError = emitted.find(entry => entry.event === 'error');
    expect(failedError?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(((game.state as any).zones?.[playerId]?.hand || [])).toHaveLength(1);

    emitted.length = 0;
    (game.state as any).zones[playerId].hand = [];
    (game.state as any).zones[playerId].handCount = 0;

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'howltooth_1', abilityId: 'howltooth_1-ability-1' });

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Handless Secret');
  });

  it('requires a library with 20 or fewer cards for Shelldock Isle hideaway play', async () => {
    const hideawayGameId = `${gameId}_shelldock`;
    ResolutionQueueManager.removeQueue(hideawayGameId);
    games.delete(hideawayGameId as any);

    createGameIfNotExists(hideawayGameId, 'commander', 40);
    const game = ensureGame(hideawayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    const hiddenCard = { id: 'hidden_shelldock_1', name: 'Deep Secret', type_line: 'Instant', oracle_text: 'Draw a card.' };
    const makeLibrary = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => ({ id: `${prefix}_${index}`, name: `Card ${index}` }));
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
    };
    game.libraries = new Map([
      [playerId, makeLibrary(30, 'p1_lib')],
      [opponentId, makeLibrary(25, 'p2_lib')],
    ]) as any;
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, libraryCount: 30, graveyard: [], graveyardCount: 0 },
      [opponentId]: { hand: [], handCount: 0, libraryCount: 25, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'shelldock_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        hideawayCard: { card: hiddenCard },
        card: {
          id: 'shelldock_card_1',
          name: 'Shelldock Isle',
          type_line: 'Land',
          oracle_text: 'Hideaway 4\n{T}: Add {U}.\n{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(hideawayGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'shelldock_1', abilityId: 'shelldock_1-ability-1' });

    const failedError = emitted.find(entry => entry.event === 'error');
    expect(failedError?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(((game.state as any).zones?.[playerId]?.hand || [])).toHaveLength(0);

    emitted.length = 0;
    game.libraries.set(opponentId, makeLibrary(20, 'p2_small_lib'));
    (game.state as any).zones[opponentId].libraryCount = 20;

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'shelldock_1', abilityId: 'shelldock_1-ability-1' });

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Deep Secret');
  });

  it('requires actual damage, not just life loss, for Spinerock Knoll hideaway play', async () => {
    const hideawayGameId = `${gameId}_spinerock`;
    ResolutionQueueManager.removeQueue(hideawayGameId);
    games.delete(hideawayGameId as any);

    createGameIfNotExists(hideawayGameId, 'commander', 40);
    const game = ensureGame(hideawayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    const hiddenCard = { id: 'hidden_spinerock_1', name: 'Burn Secret', type_line: 'Sorcery', oracle_text: 'Deal 3 damage to any target.' };
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
    };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0, [opponentId]: 7 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
      [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'spinerock_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        hideawayCard: { card: hiddenCard },
        card: {
          id: 'spinerock_card_1',
          name: 'Spinerock Knoll',
          type_line: 'Land',
          oracle_text: 'Hideaway 4\n{T}: Add {R}.\n{R}, {T}: You may play the exiled card without paying its mana cost if an opponent was dealt 7 or more damage this turn.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(hideawayGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'spinerock_1', abilityId: 'spinerock_1-ability-1' });

    const failedError = emitted.find(entry => entry.event === 'error');
    expect(failedError?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(((game.state as any).zones?.[playerId]?.hand || [])).toHaveLength(0);
    expect(((game.state as any).battlefield.find((entry: any) => entry.id === 'spinerock_1') as any)?.hideawayCard).toBeDefined();

    emitted.length = 0;
    (game.state as any).damageTakenThisTurnByPlayer[opponentId] = 7;

    await handlers['activateBattlefieldAbility']({ gameId: hideawayGameId, permanentId: 'spinerock_1', abilityId: 'spinerock_1-ability-1' });

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Burn Secret');
    expect(((game.state as any).battlefield.find((entry: any) => entry.id === 'spinerock_1') as any)?.hideawayCard).toBeUndefined();
  });
});