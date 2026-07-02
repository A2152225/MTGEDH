import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { requestCastSpellForSocket } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const GREEN_SUNS_TWILIGHT_TEXT =
  "Reveal the top X plus one cards of your library. Choose a creature card and/or a land card from among them. Put those cards into your hand and the rest on the bottom of your library in a random order. If X is 5 or more, instead put the chosen cards onto the battlefield or into your hand and the rest on the bottom of your library in a random order.";

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function setupTwilightLibrary(game: any, playerId: string) {
  const library = [
    { id: 'lib-1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
    { id: 'lib-2', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'library' },
    { id: 'lib-3', name: 'Lightning Bolt', type_line: 'Instant', zone: 'library' },
  ];
  game.libraries = game.libraries || new Map();
  game.libraries.set(playerId, library.map((card) => ({ ...card })));
  return library;
}

function seedGreenSunCastGame(game: any, playerId: string) {
  const spellCard = {
    id: 'greensun_card',
    name: "Green Sun's Twilight",
    type_line: 'Sorcery',
    mana_cost: '{X}{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    oracle_text: GREEN_SUNS_TWILIGHT_TEXT,
  };
  const library = setupTwilightLibrary(game, playerId);

  Object.assign(game.state as any, {
    players: [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }],
    startingLife: 40,
    life: { [playerId]: 40 },
    phase: 'main1',
    step: 'MAIN1',
    turnPlayer: playerId,
    activePlayer: playerId,
    turnNumber: 3,
    priority: playerId,
    stack: [],
    battlefield: [],
    manaPool: {
      [playerId]: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 1, white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
    },
    zones: {
      [playerId]: {
        hand: [spellCard],
        handCount: 1,
        library: library.map((card) => ({ ...card })),
        libraryCount: library.length,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
  });
}

async function payQueuedSpellMana(
  handlers: Record<string, Function>,
  gameId: string,
  playerId: string,
) {
  const paymentStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((step) => step.type === ResolutionStepType.MANA_PAYMENT_CHOICE);

  if (!paymentStep) return;

  await handlers.submitResolutionResponse({
    gameId,
    stepId: String(paymentStep.id),
    selections: { payment: [] },
    cancelled: false,
  });
}

describe('reveal → player_choice socket integration (Layer 3)', () => {
  const gameId = 'test_reveal_player_choice_socket';
  const playerId = 'p1';
  const previousSpellPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousSpellLegacy = process.env.ORACLE_IR_SPELL_LEGACY;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
  });

  afterEach(async () => {
    if (previousSpellPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousSpellPrimary;
    }
    if (previousSpellLegacy === undefined) {
      delete process.env.ORACLE_IR_SPELL_LEGACY;
    } else {
      process.env.ORACLE_IR_SPELL_LEGACY = previousSpellLegacy;
    }
    await resetGame(gameId);
  });

  it("casts Green Sun's Twilight through the socket, queues LIBRARY_SEARCH, and resumes to hand", async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedGreenSunCastGame(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await requestCastSpellForSocket(io as any, socket as any, { gameId, cardId: 'greensun_card' }, { xValue: 1 });
    await payQueuedSpellMana(handlers, gameId, playerId);

    expect(emitted.filter((entry) => entry.event === 'error')).toHaveLength(0);
    expect(((game.state as any).stack || []).length).toBe(1);

    game.resolveTopOfStack();

    const searchStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect((searchStep as any)?.effectProgramPrompt).toBeFalsy();
    expect((searchStep as any)?.availableCards?.map((card: any) => card.id).sort()).toEqual(['lib-1', 'lib-2']);
    expect(String((searchStep as any)?.oracleIrChoiceStepJson || '')).toContain('player_choice');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(searchStep!.id),
      selections: ['lib-2'],
      cancelled: false,
    });

    const handIds = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id);
    const libraryIds = (game.libraries?.get(playerId) || []).map((card: any) => card.id);
    expect(handIds).toEqual(['lib-2']);
    expect(libraryIds).toEqual(['lib-3', 'lib-1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 15000);

  it("casts Green Sun's Twilight at X=5, resumes LIBRARY_SEARCH, then OPTION_CHOICE battlefield destination", async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedGreenSunCastGame(game, playerId);
    (game.state as any).manaPool[playerId] = {
      W: 0, U: 0, B: 0, R: 0, G: 6, C: 0,
      white: 0, blue: 0, black: 0, red: 0, green: 6, colorless: 0,
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await requestCastSpellForSocket(io as any, socket as any, { gameId, cardId: 'greensun_card' }, { xValue: 5 });
    await payQueuedSpellMana(handlers, gameId, playerId);

    expect(emitted.filter((entry) => entry.event === 'error')).toHaveLength(0);
    game.resolveTopOfStack();

    const searchStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searchStep).toBeTruthy();
    expect(Number((searchStep as any)?.oracleIrXValue)).toBe(5);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(searchStep!.id),
      selections: ['lib-2'],
      cancelled: false,
    });

    const destinationStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any).oracleIrMoveZoneDestinationChoice);
    expect(destinationStep).toBeTruthy();

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(destinationStep!.id),
      selections: ['battlefield'],
      cancelled: false,
    });

    const elvesOnBattlefield = ((game.state as any).battlefield || []).some(
      (perm: any) => String(perm?.card?.name || perm?.name || '') === 'Llanowar Elves',
    );
    expect(elvesOnBattlefield).toBe(true);
    expect((game.libraries?.get(playerId) || []).map((card: any) => card.id)).toEqual(['lib-1', 'lib-3']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 15000);
});
