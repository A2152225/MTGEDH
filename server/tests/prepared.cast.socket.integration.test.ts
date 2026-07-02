import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { requestCastSpellForSocket } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function buildPreparedOnEntryCard() {
  return {
    id: 'prepared_student_raw',
    name: 'Prepared Student // Timely Insight',
    layout: 'prepare',
    mana_cost: '{2}{U} // {1}{U}',
    type_line: 'Creature — Human Wizard // Instant',
    colors: ['U'],
    color_identity: ['U'],
    card_faces: [
      {
        name: 'Prepared Student',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Wizard',
        oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        power: '2',
        toughness: '3',
      },
      {
        name: 'Timely Insight',
        mana_cost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
      },
    ],
    power: '2',
    toughness: '3',
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
  };
}

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
    p1: { W: 1, U: 1, B: 0, R: 0, G: 0, C: 0, white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
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

describe('prepared cast socket integration (Layer 3)', () => {
  const gameId = 'test_prepared_exile_socket_cast';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  afterEach(async () => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  });

  it('requestCastSpell on prepared exile copy pays mana, unprepares source, and resolves copy on stack', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    seedBaseGame(game);
    const preparedCard = buildPreparedOnEntryCard();
    const sourcePermanent = createPreparedSourcePermanent('perm_prepared_socket', 'p1', preparedCard);
    (game.state as any).battlefield = [sourcePermanent];
    setPermanentPrepared((game.state as any), sourcePermanent);
    const preparedCopy = (game.state as any).zones.p1.exile[0];
    (game.state as any).manaPool.p1 = { W: 1, U: 1, B: 0, R: 0, G: 0, C: 0, white: 1, blue: 1, black: 0, red: 0, green: 0, colorless: 0 };

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
      .find((step: any) => step.type === 'mana_payment_choice' && step.spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.cardName).toBe('Timely Insight');
    expect(paymentStep.manaCost).toBe('{1}{U}');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    expect((game.state as any).battlefield[0]?.prepared).toBe(false);
    expect((game.state as any).stack).toHaveLength(1);
    expect(String((game.state as any).stack[0]?.card?.name || '')).toBe('Timely Insight');
  }, 15000);
});
