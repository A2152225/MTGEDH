import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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

describe('activateFetchland persistence (integration)', () => {
  const gameId = 'test_activate_fetchland_integration';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('persists true-fetch activation evidence and tracks life lost this turn', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'delta_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'delta_card',
          name: 'Polluted Delta',
          type_line: 'Land',
          oracle_text: '{T}, Pay 1 life, Sacrifice Polluted Delta: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'delta_1', abilityId: 'fetch-land' });

    expect((game.state as any).life[p1]).toBe(39);
    expect((game.state as any).players[0].life).toBe(39);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(1);
    expect((game.state as any).permanentLeftBattlefieldThisTurn?.[p1]).toBe(true);
    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'activateFetchland') as any;
    expect(persisted).toBeDefined();
    expect(persisted?.payload?.stackId).toMatch(/^ability_fetch_/);
    expect(String(persisted?.payload?.activatedAbilityText || '').toLowerCase()).toContain('pay 1 life');
    expect(persisted?.payload?.lifePaidForCost).toBe(1);
    expect(persisted?.payload?.manaCost).toBeUndefined();
    expect(persisted?.payload?.searchParams?.filter?.types).toContain('land');
    expect((persisted?.payload?.searchParams?.filter?.subtypes || []).map((value: string) => String(value).toLowerCase())).toEqual(['island', 'swamp']);
    expect(persisted?.payload?.searchParams?.maxSelections).toBe(1);
    expect(persisted?.payload?.searchParams?.entersTapped).toBe(false);
  });

  it('persists mana-cost fetch activation metadata for exact replay reconstruction', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'myriad_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'myriad_card',
          name: 'Myriad Landscape',
          type_line: 'Land',
          oracle_text: '{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'myriad_1', abilityId: 'fetch-land' });

    expect((game.state as any).manaPool[p1].colorless).toBe(0);
    expect((game.state as any).permanentLeftBattlefieldThisTurn?.[p1]).toBe(true);
    expect((game.state as any).battlefield).toHaveLength(0);
    expect((game.state as any).zones[p1].graveyard).toHaveLength(1);

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'activateFetchland') as any;
    expect(persisted).toBeDefined();
    expect(persisted?.payload?.activatedAbilityText).toContain('up to two basic land cards');
    expect(persisted?.payload?.manaCost).toBe('{2}');
    expect(persisted?.payload?.lifePaidForCost).toBeUndefined();
    expect(persisted?.payload?.searchParams?.filter?.types).toContain('land');
    expect(persisted?.payload?.searchParams?.filter?.supertypes).toContain('basic');
    expect(persisted?.payload?.searchParams?.maxSelections).toBe(2);
    expect(persisted?.payload?.searchParams?.entersTapped).toBe(true);
  });

  it('does not recreate a Misty Rainforest prompt after restart once the search resolved event was persisted', async () => {
    const persistentGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    ResolutionQueueManager.removeQueue(persistentGameId);
    games.delete(persistentGameId as any);

    createGameIfNotExists(persistentGameId, 'commander', 40, undefined, 'p1');
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = persistentGameId;

    const p1 = 'p1';
    const mistyRainforest = {
      id: 'misty_rainforest_1',
      name: 'Misty Rainforest',
      type_line: 'Land',
      oracle_text: '{T}, Pay 1 life, Sacrifice Misty Rainforest: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.',
      zone: 'hand',
    };
    const breedingPool = {
      id: 'breeding_pool_1',
      name: 'Breeding Pool',
      type_line: 'Land — Forest Island',
      oracle_text: '({T}: Add {G} or {U})\nAs Breeding Pool enters, you may pay 2 life. If you don\'t, it enters tapped.',
      zone: 'library',
    };

    const seedEvents = [
      { type: 'join', payload: { playerId: p1, name: 'P1' } },
      { type: 'deckImportResolved', payload: { playerId: p1, cards: [breedingPool] } },
    ];

    let seq = 0;
    for (const event of seedEvents) {
      appendEvent(persistentGameId, seq++, event.type, event.payload);
      game.applyEvent({ type: event.type, ...(event.payload || {}) } as any);
    }

    game.applyEvent({ type: 'playLand', playerId: p1, cardId: mistyRainforest.id, card: mistyRainforest, fromZone: 'hand' } as any);

    const mistyPermanentId = String((((game.state as any).battlefield || [])[0] || {}).id || '');
    expect(mistyPermanentId).not.toBe('');
    appendEvent(persistentGameId, seq++, 'playLand', {
      playerId: p1,
      cardId: mistyRainforest.id,
      card: mistyRainforest,
      fromZone: 'hand',
      permanentId: mistyPermanentId,
    });

    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    if (Array.isArray((game.state as any).players) && (game.state as any).players[0]) {
      (game.state as any).players[0].life = 40;
    }

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(persistentGameId);
    socket.data.gameId = persistentGameId;
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId: persistentGameId, permanentId: mistyPermanentId, abilityId: 'fetch-land' });
    resolveTopOfStack(game as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(persistentGameId, p1).find((step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(searchStep).toBeDefined();
    expect(searchStep.persistLibrarySearchResolve).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId: persistentGameId,
      stepId: String(searchStep.id),
      selections: ['breeding_pool_1'],
    });

    const persistedEvents = getEvents(persistentGameId);
    expect(persistedEvents.some((event: any) => event?.type === 'activateFetchland')).toBe(true);
    expect(persistedEvents.some((event: any) => event?.type === 'librarySearchResolve')).toBe(true);

    const liveBattlefield = ((game.state as any).battlefield || []) as any[];
    const liveGraveyard = (((game.state as any).zones || {})[p1]?.graveyard || []) as any[];
    expect(liveBattlefield.some((permanent: any) => permanent?.card?.id === 'breeding_pool_1')).toBe(true);
    expect(liveGraveyard.some((card: any) => card?.id === 'misty_rainforest_1')).toBe(true);

    const replayGame = createInitialGameState(`${persistentGameId}_replay`);
    replayGame.replay!(transformDbEventsForReplay(persistedEvents as any));

    const replayBattlefield = ((replayGame.state as any).battlefield || []) as any[];
    const replayGraveyard = (((replayGame.state as any).zones || {})[p1]?.graveyard || []) as any[];
    expect((replayGame.state as any).stack || []).toHaveLength(0);
    expect(replayBattlefield.some((permanent: any) => permanent?.card?.id === 'breeding_pool_1')).toBe(true);
    expect(replayGraveyard.some((card: any) => card?.name === 'Misty Rainforest')).toBe(true);
  });
});