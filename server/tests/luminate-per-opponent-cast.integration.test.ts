import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

const LUMINATE_CAST_TEXT =
  'For each opponent, exile up to one target creature that player controls and that player gains life equal to its power.';

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

async function setupFourPlayerGame(testGameId: string, casterId: string) {
  await resetGame(testGameId);
  createGameIfNotExists(testGameId, 'commander', 40, undefined, casterId);
  const game = ensureGame(testGameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerIds = ['p_caster', 'p_opp1', 'p_opp2', 'p_opp3'] as const;
  (game.state as any).players = playerIds.map((id, seat) => ({
    id,
    name: id,
    spectator: false,
    life: 40,
    seat,
  }));
  (game.state as any).startingLife = 40;
  (game.state as any).life = Object.fromEntries(playerIds.map((id) => [id, 40]));
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = casterId;
  (game.state as any).priority = casterId;
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    p_caster: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    p_opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p_opp2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p_opp3: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  return game;
}

describe('Luminate-style per-opponent cast integration', () => {
  const gameId = 'test_luminate_per_opponent_cast';
  const casterId = 'p_caster';
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
    await resetGame(gameId);
  });

  afterEach(async () => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
    await resetGame(gameId);
  });

  it('casts with per-opponent targets, resolves exile, and grants life equal to each exiled power', async () => {
    const game = await setupFourPlayerGame(gameId, casterId);
    (game.state as any).battlefield = [
      {
        id: 'perm_o1',
        controller: 'p_opp1',
        owner: 'p_opp1',
        power: 5,
        card: {
          id: 'c1',
          name: 'Opp1 Creature',
          type_line: 'Creature',
          power: '5',
          toughness: '5',
        },
      },
      {
        id: 'perm_o2',
        controller: 'p_opp2',
        owner: 'p_opp2',
        power: 3,
        card: {
          id: 'c2',
          name: 'Opp2 Creature',
          type_line: 'Creature',
          power: '3',
          toughness: '3',
        },
      },
    ];
    (game.state as any).zones = {
      p_caster: {
        hand: [
          {
            id: 'luminate_test_1',
            name: 'Luminate Test',
            mana_cost: '{3}{W}',
            manaCost: '{3}{W}',
            type_line: 'Sorcery',
            oracle_text: LUMINATE_CAST_TEXT,
            colors: ['W'],
            image_uris: { small: 'https://example.com/luminate-test.jpg' },
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
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId, cardId: 'luminate_test_1' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION) as any;
    expect(targetStep).toBeDefined();
    expect(targetStep.perOpponent).toBe(true);
    expect(targetStep.minTargetsPerOpponent).toBe(0);
    expect(targetStep.maxTargetsPerOpponent).toBe(1);
    expect(Object.keys(targetStep.targetsPerOpponent || {})).toEqual(expect.arrayContaining(['p_opp1', 'p_opp2']));
    expect(targetStep.targetsPerOpponent.p_opp1?.map((entry: any) => entry.id)).toContain('perm_o1');
    expect(targetStep.targetsPerOpponent.p_opp2?.map((entry: any) => entry.id)).toContain('perm_o2');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['perm_o1', 'perm_o2'],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find(
      (entry: any) =>
        entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.targets).toEqual(['perm_o1', 'perm_o2']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [
          { permanentId: '__pool__:white', mana: 'W', count: 1 },
          { permanentId: '__pool__:colorless', mana: 'C', count: 3 },
        ],
      },
    });

    expect(Array.isArray((game.state as any).stack)).toBe(true);
    expect((game.state as any).stack.length).toBeGreaterThan(0);

    let safety = 0;
    while ((game.state as any).stack.length > 0 && safety++ < 12) {
      (game as any).resolveTopOfStack();
    }

    expect((game.state as any).battlefield || []).toHaveLength(0);
    expect((game.state as any).life.p_opp1).toBe(45);
    expect((game.state as any).life.p_opp2).toBe(43);
    expect((game.state as any).life.p_caster).toBe(40);
    expect((game.state as any).life.p_opp3).toBe(40);

    const exiledIds = new Set(
      ['p_opp1', 'p_opp2'].flatMap((playerId) =>
        ((game.state as any).zones?.[playerId]?.exile || []).map((card: any) => String(card?.id || '')),
      ),
    );
    expect(exiledIds.has('perm_o1') || exiledIds.has('c1')).toBe(true);
    expect(exiledIds.has('perm_o2') || exiledIds.has('c2')).toBe(true);
  });

  it('rejects two targets from the same opponent during per-opponent selection', async () => {
    const game = await setupFourPlayerGame(gameId, casterId);
    (game.state as any).battlefield = [
      {
        id: 'perm_o1a',
        controller: 'p_opp1',
        owner: 'p_opp1',
        card: { name: 'Opp1a', type_line: 'Creature', power: '2', toughness: '2' },
      },
      {
        id: 'perm_o1b',
        controller: 'p_opp1',
        owner: 'p_opp1',
        card: { name: 'Opp1b', type_line: 'Creature', power: '4', toughness: '4' },
      },
    ];
    (game.state as any).zones = {
      p_caster: {
        hand: [
          {
            id: 'luminate_test_1',
            name: 'Luminate Test',
            mana_cost: '{3}{W}',
            manaCost: '{3}{W}',
            type_line: 'Sorcery',
            oracle_text: LUMINATE_CAST_TEXT,
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
    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId, cardId: 'luminate_test_1' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === ResolutionStepType.TARGET_SELECTION,
    ) as any;
    expect(targetStep?.perOpponent).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep.id),
      selections: ['perm_o1a', 'perm_o1b'],
      cancelled: false,
    });

    const pendingCast = Object.values((game.state as any).pendingSpellCasts || {})[0] as any;
    expect(pendingCast?.targets || []).toHaveLength(0);

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) =>
        entry.type === ResolutionStepType.MANA_PAYMENT_CHOICE && (entry as any).spellPaymentRequired === true,
    );
    expect(paymentStep).toBeUndefined();
  });
});
