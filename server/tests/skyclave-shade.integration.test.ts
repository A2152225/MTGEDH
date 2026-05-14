import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { getCastableSpellCandidates } from '../src/state/modules/can-respond.js';
import { playLand } from '../src/state/modules/stack.js';
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
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
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
    // Ignore cleanup failures for already-deleted test games.
  }
}

async function seedSkyclaveShadeGame(gameId: string, turnPlayer: string = 'p1') {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const shade = {
    id: 'shade_1',
    name: 'Skyclave Shade',
    mana_cost: '{1}{B}',
    manaCost: '{1}{B}',
    type_line: 'Creature — Shade',
    oracle_text: "Kicker {2}{B}\nThis creature can't block.\nIf this creature was kicked, it enters with two +1/+1 counters on it.\nLandfall — Whenever a land you control enters, if this card is in your graveyard and it's your turn, you may cast it from your graveyard this turn.",
    power: '3',
    toughness: '1',
    zone: 'graveyard',
  };
  const swamp = {
    id: 'swamp_1',
    name: 'Swamp',
    type_line: 'Basic Land — Swamp',
    oracle_text: '{T}: Add {B}.',
    zone: 'hand',
  };

  (game.state as any).players = [
    {
      id: 'p1',
      name: 'P1',
      spectator: false,
      life: 40,
      hand: [swamp],
      library: [],
      graveyard: [shade],
      exile: [],
      battlefield: [],
      commandZone: [],
      counters: {},
      manaPool: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 1 },
    },
    {
      id: 'p2',
      name: 'P2',
      spectator: false,
      life: 40,
      hand: [],
      library: [],
      graveyard: [],
      exile: [],
      battlefield: [],
      commandZone: [],
      counters: {},
      manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).turnNumber = 11;
  (game.state as any).turn = 11;
  (game.state as any).turnPlayer = turnPlayer;
  (game.state as any).activePlayer = turnPlayer;
  (game.state as any).priority = 'p1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).phase = 'precombatMain';
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).landsPlayedThisTurn = { p1: 0, p2: 0 };
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 1 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: [swamp],
      handCount: 1,
      library: [],
      libraryCount: 0,
      graveyard: [shade],
      graveyardCount: 1,
      exile: [],
      exileCount: 0,
    },
    p2: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };

  (game as any).libraries = new Map<string, any[]>([
    ['p1', []],
    ['p2', []],
  ]);

  return { game, playerId: 'p1' as const };
}

async function acceptSkyclaveLandfallPrompt(
  gameId: string,
  game: any,
  playerId: string,
  handlers: Record<string, Function>,
) {
  game.resolveTopOfStack();

  const optionalStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
    .find((step: any) => step?.effectProgramPrompt === true || step?.optionalTriggeredAbilityPrompt === true) as any;
  expect(optionalStep).toBeDefined();

  await handlers['submitResolutionResponse']({
    gameId,
    stepId: String(optionalStep.id),
    selections: ['yes'],
    cancelled: false,
  });
}

describe('Skyclave Shade', () => {
  const baseGameId = 'test_skyclave_shade';
  const trackedGameIds = [
    `${baseGameId}_grant`,
    `${baseGameId}_request`,
    `${baseGameId}_off_turn`,
    `${baseGameId}_replay`,
  ];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
  });

  it('grants a same-turn cast permission from graveyard and the permission expires next turn', async () => {
    const gameId = `${baseGameId}_grant`;
    const { game, playerId } = await seedSkyclaveShadeGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'swamp_1', fromZone: 'hand' });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.sourceName).toBe('Skyclave Shade');
    expect(String(stack[0]?.description || '').toLowerCase()).toContain('cast it from your graveyard this turn');

    await acceptSkyclaveLandfallPrompt(gameId, game, playerId, handlers);

    expect((game.state as any).playableFromGraveyard?.[playerId]?.shade_1).toBe(11);
    expect(
      getCastableSpellCandidates({ state: (game.state as any), libraries: (game as any).libraries } as any, playerId as any, { mode: 'main' })
        .some((candidate: any) => candidate?.card?.id === 'shade_1')
    ).toBe(true);

    (game.state as any).turnNumber = 12;
    (game.state as any).turn = 12;
    (game.state as any).turnPlayer = 'p2';
    (game.state as any).activePlayer = 'p2';

    expect(
      getCastableSpellCandidates({ state: (game.state as any), libraries: (game as any).libraries } as any, playerId as any, { mode: 'main' })
        .some((candidate: any) => candidate?.card?.id === 'shade_1')
    ).toBe(false);
  });

  it('allows the live graveyard cast request after the landfall trigger resolves', async () => {
    const gameId = `${baseGameId}_request`;
    const { game, playerId } = await seedSkyclaveShadeGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'swamp_1', fromZone: 'hand' });
    await acceptSkyclaveLandfallPrompt(gameId, game, playerId, handlers);

    await handlers['requestCastSpell']({ gameId, cardId: 'shade_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect((queue.steps || []).some((step: any) => step.cardId === 'shade_1')).toBe(true);
  });

  it('does not trigger while it is not your turn', async () => {
    const gameId = `${baseGameId}_off_turn`;
    const { game, playerId } = await seedSkyclaveShadeGame(gameId, 'p2');

    playLand(game as any, playerId as any, 'swamp_1');

    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) => String(item?.sourceName || '') === 'Skyclave Shade')).toBe(false);
    expect((game.state as any).playableFromGraveyard?.[playerId]?.shade_1).toBeUndefined();
  });

  it('replay restores the same-turn permission after the landfall trigger resolves', async () => {
    const gameId = `${baseGameId}_replay`;
    const { game, playerId } = await seedSkyclaveShadeGame(gameId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'swamp_1', fromZone: 'hand' });
    await acceptSkyclaveLandfallPrompt(gameId, game, playerId, handlers);

    const persistedEvents = getEvents(gameId);
    expect(persistedEvents.some((event: any) => event.type === 'playLand')).toBe(true);
    expect(persistedEvents.some((event: any) => event.type === 'optionalTriggeredAbilityChoice')).toBe(true);

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    expect((game.state as any).playableFromGraveyard?.[playerId]?.shade_1).toBe(11);
    expect(
      getCastableSpellCandidates({ state: (game.state as any), libraries: (game as any).libraries } as any, playerId as any, { mode: 'main' })
        .some((candidate: any) => candidate?.card?.id === 'shade_1')
    ).toBe(true);

    emitted.length = 0;
    await handlers['requestCastSpell']({ gameId, cardId: 'shade_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');
  });
});