import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, sanitizeStepForClient } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('Panglacial Wurm library-search casting (integration)', () => {
  const gameId = 'test_panglacial_wurm_library_search';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  function setupGame() {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 7, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 2,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    (game as any).libraries = new Map<string, any[]>();
    (game as any).libraries.set(playerId, [
      {
        id: 'pang_1',
        name: 'Panglacial Wurm',
        mana_cost: '{5}{G}{G}',
        type_line: 'Creature — Wurm',
        oracle_text: 'Trample\nWhile you\'re searching your library, you may cast Panglacial Wurm from your library.',
        power: '9',
        toughness: '5',
        cmc: 7,
        image_uris: { small: 'https://example.com/pang.jpg' },
      },
      {
        id: 'forest_1',
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
        image_uris: { small: 'https://example.com/forest.jpg' },
      },
    ]);

    return game;
  }

  function addSearchStep() {
    return ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId,
      description: 'Search your library for a basic land card.',
      searchCriteria: 'Search your library for a basic land card.',
      mandatory: true,
      sourceName: 'Fetch Land',
      minSelections: 0,
      maxSelections: 1,
      destination: 'battlefield',
      shuffleAfter: true,
      filter: { types: ['land'], supertypes: ['basic'] },
      availableCards: [
        {
          id: 'forest_1',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
          image_uris: { small: 'https://example.com/forest.jpg' },
        },
      ],
      nonSelectableCards: [],
    } as any);
  }

  it('surfaces Panglacial Wurm separately from ordinary search results', () => {
    setupGame();
    const step = addSearchStep();

    const sanitized = sanitizeStepForClient(gameId, step as any);

    expect((sanitized.availableCards || []).map((card: any) => card.id)).toEqual(['forest_1']);
    expect((sanitized.castableWhileSearchingCards || []).map((card: any) => card.id)).toEqual(['pang_1']);
  });

  it('restores the suspended library search when Panglacial casting is cancelled', async () => {
    const game = setupGame();
    addSearchStep();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)[0] as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(searchStep.id),
      selections: { action: 'cast_panglacial_wurm', cardId: 'pang_1' },
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && entry.spellPaymentRequired === true
    ) as any;
    expect(paymentStep).toBeDefined();
    expect((game.state as any).pendingSpellCasts?.[paymentStep.effectId]?.fromZone).toBe('library');

    emitted.length = 0;
    await handlers['targetSelectionCancel']({
      gameId,
      cardId: 'pang_1',
      effectId: String(paymentStep.effectId),
    });

    const restoredStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)[0] as any;
    expect(restoredStep?.type).toBe(ResolutionStepType.LIBRARY_SEARCH);
    expect(emitted.some((entry) => entry.event === 'resolutionStepPrompt' && entry.payload?.step?.type === 'library_search')).toBe(true);
    expect(((game as any).libraries.get(playerId) as any[]).map((card: any) => card.id)).toContain('pang_1');
  });

  it('casts Panglacial Wurm from library and then restores the search prompt', async () => {
    const game = setupGame();
    addSearchStep();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const searchStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)[0] as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(searchStep.id),
      selections: { action: 'cast_panglacial_wurm', cardId: 'pang_1' },
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && entry.spellPaymentRequired === true
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    const continueEvent = emitted.find((entry) => entry.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.effectId).toBeDefined();

    emitted.length = 0;
    await handlers['completeCastSpell'](continueEvent?.payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => entry.card?.id === 'pang_1');
    expect(stackItem).toBeDefined();
    expect(stackItem?.castFromLibrary).toBe(true);
    expect((((game as any).libraries.get(playerId) as any[]) || []).map((card: any) => card.id)).not.toContain('pang_1');

    const restoredStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any)[0] as any;
    expect(restoredStep?.type).toBe(ResolutionStepType.LIBRARY_SEARCH);
    expect(emitted.some((entry) => entry.event === 'resolutionStepPrompt' && entry.payload?.step?.type === 'library_search')).toBe(true);
  });
});