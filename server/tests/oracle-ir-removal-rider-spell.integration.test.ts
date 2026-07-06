import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';

const NATURES_CLAIM_TEXT =
  'Destroy target artifact or enchantment. Its controller gains 4 life.';
const BEAST_WITHIN_TEXT =
  'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.';
const SWORDS_TEXT = 'Exile target creature. Its controller gains life equal to its power.';
const PATH_TEXT =
  'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  GameManager.deleteGame(gameId);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
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

async function setupTwoPlayerGame(testGameId: string, casterId: string, opponentId: string) {
  await resetGame(testGameId);
  createGameIfNotExists(testGameId, 'commander', 40, undefined, casterId);
  const game = ensureGame(testGameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [
    { id: casterId, name: casterId, spectator: false, life: 40, seat: 0 },
    { id: opponentId, name: opponentId, spectator: false, life: 40, seat: 1 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [casterId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = casterId;
  (game.state as any).priority = casterId;
  (game.state as any).stack = [];
  return game;
}

async function castTargetPayAndResolve(
  game: any,
  handlers: Record<string, Function>,
  gameId: string,
  casterId: string,
  cardId: string,
  targetId: string,
  payment: Array<{ permanentId: string; mana: string; count: number }>,
) {
  await handlers.castSpellFromHand({ gameId, cardId });

  let queue = ResolutionQueueManager.getQueue(gameId);
  const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
  if (targetStep) {
    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: [targetId],
      cancelled: false,
    });
  }

  queue = ResolutionQueueManager.getQueue(gameId);
  const paymentStep = queue.steps.find(
    (entry: any) =>
      entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
  ) as any;
  expect(paymentStep).toBeDefined();

  await handlers.submitResolutionResponse({
    gameId,
    stepId: String(paymentStep.id),
    selections: { payment },
  });

  let safety = 0;
  while ((game.state as any).stack.length > 0 && safety++ < 12) {
    (game as any).resolveTopOfStack();
  }
}

describe('Oracle IR removal rider spell integration', () => {
  const baseId = 'test_oracle_ir_removal_rider_spell';
  const casterId = 'p_caster';
  const opponentId = 'p_opp';
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map() },
    } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    await resetGame(baseId);
  });

  afterEach(async () => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
    await resetGame(baseId);
  });

  it("Nature's Claim destroys the target and grants its controller 4 life via IR", async () => {
    const gameId = `${baseId}_natures_claim`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_ring',
        controller: opponentId,
        owner: opponentId,
        card: { id: 'ring_card', name: 'Sol Ring', type_line: 'Artifact' },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'claim_test',
            name: "Nature's Claim",
            mana_cost: '{G}',
            manaCost: '{G}',
            type_line: 'Instant',
            oracle_text: NATURES_CLAIM_TEXT,
            colors: ['G'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    await castTargetPayAndResolve(game, handlers, gameId, casterId, 'claim_test', 'perm_ring', [
      { permanentId: '__pool__:green', mana: 'G', count: 1 },
    ]);

    expect((game.state as any).battlefield || []).toHaveLength(0);
    expect((game.state as any).life[opponentId]).toBe(44);
    expect((game.state as any).life[casterId]).toBe(40);
  });

  it('Beast Within destroys the target and creates a Beast token for its controller via IR', async () => {
    const gameId = `${baseId}_beast_within`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_creature',
        controller: opponentId,
        owner: opponentId,
        card: {
          id: 'creature_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'beast_test',
            name: 'Beast Within',
            mana_cost: '{2}{G}',
            manaCost: '{2}{G}',
            type_line: 'Instant',
            oracle_text: BEAST_WITHIN_TEXT,
            colors: ['G'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    await castTargetPayAndResolve(game, handlers, gameId, casterId, 'beast_test', 'perm_creature', [
      { permanentId: '__pool__:green', mana: 'G', count: 1 },
      { permanentId: '__pool__:colorless', mana: 'C', count: 2 },
    ]);

    expect((game.state as any).battlefield || []).toHaveLength(1);
    const replacement = (game.state as any).battlefield[0];
    expect(replacement.controller).toBe(opponentId);
    expect(String(replacement.card?.name || '')).toMatch(/beast/i);
    expect(String(replacement.card?.power || replacement.power || '')).toBe('3');
    expect(String(replacement.card?.toughness || replacement.toughness || '')).toBe('3');
  });

  it('Swords-style exile grants life equal to the exiled creature power via IR', async () => {
    const gameId = `${baseId}_swords`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_big',
        controller: opponentId,
        owner: opponentId,
        power: 5,
        card: {
          id: 'big_creature',
          name: 'Big Creature',
          type_line: 'Creature',
          power: '5',
          toughness: '5',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'swords_test',
            name: 'Swords Test',
            mana_cost: '{W}',
            manaCost: '{W}',
            type_line: 'Instant',
            oracle_text: SWORDS_TEXT,
            colors: ['W'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [{ id: 'opp_lib_1', name: 'Plains', type_line: 'Basic Land — Plains' }],
        libraryCount: 1,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    await castTargetPayAndResolve(game, handlers, gameId, casterId, 'swords_test', 'perm_big', [
      { permanentId: '__pool__:white', mana: 'W', count: 1 },
    ]);

    expect((game.state as any).battlefield || []).toHaveLength(0);
    expect((game.state as any).life[opponentId]).toBe(45);
  });

  it('Path-style exile queues optional basic land search for the exiled creature controller via IR', async () => {
    const gameId = `${baseId}_path`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_creature',
        controller: opponentId,
        owner: opponentId,
        card: {
          id: 'creature_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'path_test',
            name: 'Path Test',
            mana_cost: '{W}',
            manaCost: '{W}',
            type_line: 'Instant',
            oracle_text: PATH_TEXT,
            colors: ['W'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [
          { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'island_1', name: 'Island', type_line: 'Basic Land — Island' },
        ],
        libraryCount: 2,
      },
    };
    (game as any).libraries = new Map([
      [
        opponentId,
        [
          { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
          { id: 'island_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
        ],
      ],
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    await castTargetPayAndResolve(game, handlers, gameId, casterId, 'path_test', 'perm_creature', [
      { permanentId: '__pool__:white', mana: 'W', count: 1 },
    ]);

    expect((game.state as any).battlefield || []).toHaveLength(0);

    const searchStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any;
    expect(searchStep).toBeDefined();
    expect(String(searchStep.playerId || '')).toBe(opponentId);
    expect(String(searchStep.searchFor || searchStep.description || '').toLowerCase()).toMatch(/basic land/);
  });

  it('Fateful Absence destroys the target and investigates for its controller via IR', async () => {
    const card = lookupLocalCardByNameSync('Fateful Absence');
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const gameId = `${baseId}_fateful_absence`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_creature',
        controller: opponentId,
        owner: opponentId,
        card: {
          id: 'creature_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'fateful_test',
            name: 'Fateful Absence',
            mana_cost: '{1}{W}',
            manaCost: '{1}{W}',
            type_line: 'Instant',
            oracle_text: oracleText,
            colors: ['W'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    await castTargetPayAndResolve(game, handlers, gameId, casterId, 'fateful_test', 'perm_creature', [
      { permanentId: '__pool__:white', mana: 'W', count: 1 },
      { permanentId: '__pool__:colorless', mana: 'C', count: 1 },
    ]);

    expect((game.state as any).battlefield?.filter((perm: any) => perm.id === 'perm_creature')).toHaveLength(0);
    const clues = (game.state as any).battlefield?.filter((perm: any) => /clue/i.test(perm.card?.name || '')) ?? [];
    expect(clues).toHaveLength(1);
    expect(clues[0]?.controller).toBe(opponentId);
  });

  it('Get Lost destroys the target and creates two Map tokens for its controller via IR', async () => {
    const card = lookupLocalCardByNameSync('Get Lost');
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const gameId = `${baseId}_get_lost`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 1, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'perm_creature',
        controller: opponentId,
        owner: opponentId,
        card: {
          id: 'creature_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'get_lost_test',
            name: 'Get Lost',
            mana_cost: '{W}{G}',
            manaCost: '{W}{G}',
            type_line: 'Instant',
            oracle_text: oracleText,
            colors: ['W', 'G'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    await castTargetPayAndResolve(game, handlers, gameId, casterId, 'get_lost_test', 'perm_creature', [
      { permanentId: '__pool__:white', mana: 'W', count: 1 },
      { permanentId: '__pool__:green', mana: 'G', count: 1 },
    ]);

    expect((game.state as any).battlefield?.filter((perm: any) => perm.id === 'perm_creature')).toHaveLength(0);
    const maps = (game.state as any).battlefield?.filter((perm: any) => /map/i.test(perm.card?.name || '')) ?? [];
    expect(maps).toHaveLength(2);
    expect(maps.every((perm: any) => perm.controller === opponentId)).toBe(true);
  });

  it('Entrapment Maneuver sacrifices an attacking creature and creates Soldiers equal to toughness via IR', async () => {
    const card = lookupLocalCardByNameSync('Entrapment Maneuver');
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const gameId = `${baseId}_entrapment_maneuver`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: opponentId,
        owner: opponentId,
        attacking: casterId,
        card: {
          id: 'attacker_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '3',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'entrapment_test',
            name: 'Entrapment Maneuver',
            mana_cost: '{3}{W}',
            manaCost: '{3}{W}',
            type_line: 'Instant',
            oracle_text: oracleText,
            colors: ['W'],
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: casterSocket, handlers: casterHandlers } = createMockSocket(casterId, gameId, emitted);
    const { socket: opponentSocket, handlers: opponentHandlers } = createMockSocket(opponentId, gameId, emitted);
    const io = createMockIo(emitted, [casterSocket, opponentSocket]);
    registerGameActions(io as any, casterSocket as any);
    registerResolutionHandlers(io as any, casterSocket as any);
    registerResolutionHandlers(io as any, opponentSocket as any);

    await casterHandlers.castSpellFromHand({ gameId, cardId: 'entrapment_test' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    const playerTargetStep = queue.steps.find(
      (entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(playerTargetStep).toBeDefined();
    await casterHandlers.submitResolutionResponse({
      gameId,
      stepId: String(playerTargetStep.id),
      selections: [opponentId],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find(
      (entry: any) =>
        entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    await casterHandlers.submitResolutionResponse({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:white', mana: 'W', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 3 },
        ],
      },
    });

    (game as any).resolveTopOfStack();

    queue = ResolutionQueueManager.getQueue(gameId);
    const sacrificeStep = queue.steps.find(
      (entry: any) =>
        entry.type === ResolutionStepType.TARGET_SELECTION
        && String(entry.oracleIrChoiceStepJson || '').includes('sacrifice'),
    ) as any;
    expect(sacrificeStep).toBeDefined();
    expect(String(sacrificeStep.playerId || '')).toBe(opponentId);

    await opponentHandlers.submitResolutionResponse({
      gameId,
      stepId: String(sacrificeStep.id),
      selections: ['attacker_1'],
      cancelled: false,
    });

    expect((game.state as any).battlefield?.some((perm: any) => perm.id === 'attacker_1')).toBe(false);
    const soldiers =
      (game.state as any).battlefield?.filter((perm: any) => /soldier/i.test(perm.card?.name || perm.name || '')) ?? [];
    expect(soldiers).toHaveLength(3);
    expect(soldiers.every((perm: any) => perm.controller === casterId)).toBe(true);
  });
});
