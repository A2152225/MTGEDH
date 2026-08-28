import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';
import { lookupLocalCardByNameSync } from '../src/services/localCardLookup.js';

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

describe('Oracle IR Chaos Warp and Jaheira Respite integration', () => {
  const baseId = 'test_oracle_ir_chaos_jaheira';
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

  it('Chaos Warp shuffles the target into its library and puts a revealed permanent onto the battlefield', async () => {
    const card = lookupLocalCardByNameSync('Chaos Warp');
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const gameId = `${baseId}_chaos_warp`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).manaPool = {
      [casterId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'target_perm',
        controller: opponentId,
        owner: opponentId,
        card: {
          id: 'target_card',
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
            id: 'chaos_warp_card',
            name: 'Chaos Warp',
            mana_cost: '{2}{R}',
            manaCost: '{2}{R}',
            type_line: 'Instant',
            oracle_text: oracleText,
            colors: ['R'],
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
    (game as any).libraries = new Map([
      [
        opponentId,
        [
          {
            id: 'library_bolt',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            zone: 'library',
          },
          {
            id: 'revealed_creature',
            name: 'Elite Vanguard',
            type_line: 'Creature — Human Soldier',
            power: '1',
            toughness: '1',
            zone: 'library',
          },
        ],
      ],
    ]);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    await castTargetPayAndResolve(game, handlers, gameId, casterId, 'chaos_warp_card', 'target_perm', [
      { permanentId: '__pool__:red', mana: 'R', count: 1 },
      { permanentId: '__pool__:colorless', mana: 'C', count: 2 },
    ]);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    expect(battlefield.some((perm) => String(perm?.id || '') === 'target_perm')).toBe(false);
    expect(
      battlefield.some((perm) => String(perm?.card?.name || '') === 'Elite Vanguard'),
    ).toBe(true);

    randomSpy.mockRestore();
  });

  it("Jaheira's Respite queues library search for up to the number of creatures attacking you", async () => {
    const card = lookupLocalCardByNameSync("Jaheira's Respite");
    const oracleText = String(card?.oracle_text || '').trim();
    expect(oracleText.length).toBeGreaterThan(0);

    const gameId = `${baseId}_jaheira`;
    const game = await setupTwoPlayerGame(gameId, casterId, opponentId);
    (game.state as any).combat = {
      attackers: [
        { id: 'atk_1', defendingPlayer: casterId },
        { id: 'atk_2', defendingPlayer: casterId },
      ],
    };
    (game.state as any).battlefield = [
      {
        id: 'atk_1',
        controller: opponentId,
        owner: opponentId,
        defendingPlayerId: casterId,
        card: { id: 'atk_card_1', name: 'Goblin', type_line: 'Creature — Goblin' },
      },
      {
        id: 'atk_2',
        controller: opponentId,
        owner: opponentId,
        defendingPlayerId: casterId,
        card: { id: 'atk_card_2', name: 'Goblin', type_line: 'Creature — Goblin' },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 3,
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
    (game as any).libraries = new Map([
      [
        casterId,
        [
          { id: 'forest_1', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
          { id: 'forest_2', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
          { id: 'forest_3', name: 'Forest', type_line: 'Basic Land — Forest', zone: 'library' },
        ],
      ],
    ]);
    (game.state as any).stack = [
      {
        id: 'jaheira_stack_1',
        type: 'spell',
        controller: casterId,
        card: {
          id: 'jaheira_card',
          name: "Jaheira's Respite",
          type_line: 'Instant',
          oracle_text: oracleText,
          mana_cost: '{2}{G}',
        },
        targets: [],
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, gameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);
    registerResolutionHandlers(createMockIo(emitted), socket as any);

    (game as any).resolveTopOfStack();

    const searchStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any;
    expect(searchStep).toBeDefined();
    expect(String(searchStep.playerId || '')).toBe(casterId);
    expect(Number(searchStep.maxSelections || 0)).toBe(2);
    expect(String(searchStep.searchFor || searchStep.description || '').toLowerCase()).toMatch(/basic land/);
  });
});
