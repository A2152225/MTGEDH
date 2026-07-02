import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchCardsByExactNamesBatch, fetchCardByExactNameStrict } = vi.hoisted(() => ({
  fetchCardsByExactNamesBatch: vi.fn(),
  fetchCardByExactNameStrict: vi.fn(),
}));

vi.mock('../src/services/scryfall', () => ({
  normalizeName: (name: string) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' '),
  fetchCardsByExactNamesBatch,
  fetchCardByExactNameStrict,
}));

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { resolveDeckList } from '../src/services/deckImport.js';
import {
  ensureLocalCardLookupIndexSync,
  lookupLocalCardByNameSync,
} from '../src/services/localCardLookup.js';
import { requestCastSpellForSocket } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
import '../src/state/modules/priority.js';

const PREPARE_CARD_NAME = 'Goblin Glasswright // Craft with Pride';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

function cloneLookupCard(instanceId: string) {
  const base = lookupLocalCardByNameSync(PREPARE_CARD_NAME);
  if (!base) {
    throw new Error(`Expected ${PREPARE_CARD_NAME} in local card lookup index`);
  }
  return {
    ...structuredClone(base),
    id: instanceId,
  };
}

function seedBaseGame(game: any, playerId = 'p1') {
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).priority = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).turnPlayer = playerId;
  (game.state as any).turnNumber = 3;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = {
    p1: { W: 0, U: 0, B: 0, R: 6, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 6, green: 0, colorless: 0 },
    p2: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
    p2: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
  };
}

function createPreparedSourcePermanent(permanentId: string, controller: string, card: any) {
  const frontFace = card.card_faces[0];
  return {
    id: permanentId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    basePower: Number(frontFace.power || 0),
    baseToughness: Number(frontFace.toughness || 0),
    card: {
      ...card,
      name: frontFace.name,
      mana_cost: frontFace.mana_cost,
      type_line: frontFace.type_line,
      oracle_text: frontFace.oracle_text,
      zone: 'battlefield',
    },
  } as any;
}

describe('prepared oracle snapshot integration', () => {
  const gameIds = [
    'test_prepared_snapshot_hand_cast',
    'test_prepared_snapshot_exile_cast',
  ];

  beforeAll(async () => {
    await initDb();
    ensureLocalCardLookupIndexSync();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    fetchCardsByExactNamesBatch.mockReset();
    fetchCardsByExactNamesBatch.mockResolvedValue(new Map());
    fetchCardByExactNameStrict.mockReset();
    fetchCardByExactNameStrict.mockRejectedValue(new Error('strict fetch should not run'));
  });

  afterEach(async () => {
    for (const gameId of gameIds) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
      try {
        await deleteGame(gameId);
      } catch {
        // test-only cleanup
      }
    }
  });

  it('indexes layout:prepare cards from oracle-cards.json', () => {
    const card = lookupLocalCardByNameSync(PREPARE_CARD_NAME);
    expect(card).toBeTruthy();
    expect(card?.layout).toBe('prepare');
    expect(card?.card_faces?.[0]?.name).toBe('Goblin Glasswright');
    expect(card?.card_faces?.[1]?.name).toBe('Craft with Pride');
    expect(String(card?.card_faces?.[0]?.oracle_text || '')).toMatch(/enters prepared/i);
  });

  it('resolves prepare cards through deck import without Scryfall', async () => {
    const result = await resolveDeckList([{ name: PREPARE_CARD_NAME, count: 1 }]);
    expect(result.missing).toEqual([]);
    expect(result.sourcesUsed).toContain('oracle-cards');
    expect(result.resolvedCards).toHaveLength(1);
    expect(result.resolvedCards[0]?.layout).toBe('prepare');
    expect(fetchCardsByExactNamesBatch).not.toHaveBeenCalled();
  });

  it('queues front-face mana payment when casting a prepare card from hand via socket', async () => {
    const gameId = gameIds[0];
    const lookupCard = cloneLookupCard('goblin_glasswright_hand');
    const frontFace = lookupCard.card_faces[0];

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedBaseGame(game);
    (game.state as any).zones.p1.hand = [lookupCard];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket } = createMockSocket('p1', gameId, emitted);

    await requestCastSpellForSocket(createNoopIo() as any, socket as any, {
      gameId,
      cardId: lookupCard.id,
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.spellPaymentRequired === true) as any;

    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Goblin Glasswright');
    expect(paymentStep.manaCost).toBe(frontFace.mana_cost);
  });

  it('casts a prepared exile copy from the refreshed oracle snapshot via socket flow', async () => {
    const gameId = gameIds[1];
    const lookupCard = cloneLookupCard('goblin_glasswright_prepared');
    const backFace = lookupCard.card_faces[1];

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedBaseGame(game);

    const sourcePermanent = createPreparedSourcePermanent('perm_glasswright_snapshot', 'p1', lookupCard);
    (game.state as any).battlefield = [sourcePermanent];
    setPermanentPrepared((game.state as any), sourcePermanent);
    const preparedCopy = (game.state as any).zones.p1.exile[0];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createNoopIo();
    registerResolutionHandlers(io as any, socket as any);

    await requestCastSpellForSocket(io as any, socket as any, {
      gameId,
      cardId: String(preparedCopy.id),
      fromZone: 'exile',
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Craft with Pride');
    expect(paymentStep.manaCost).toBe(backFace.mana_cost);

    if (paymentStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(paymentStep.id),
        selections: { payment: [] },
        cancelled: false,
      });
    }

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'perm_glasswright_snapshot');
    expect(permanent?.prepared).toBe(false);
    expect((game.state as any).stack).toHaveLength(1);
    expect(String((game.state as any).stack[0]?.card?.name || '')).toBe('Craft with Pride');
  }, 15000);
});
