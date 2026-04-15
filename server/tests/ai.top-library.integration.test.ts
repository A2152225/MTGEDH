import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestCastSpellForSocket } = vi.hoisted(() => ({
  requestCastSpellForSocket: vi.fn(),
}));

const { debugWarn } = vi.hoisted(() => ({
  debugWarn: vi.fn(),
}));

vi.mock('../src/socket/game-actions.js', async () => {
  const actual = await vi.importActual<typeof import('../src/socket/game-actions.js')>('../src/socket/game-actions.js');
  return {
    ...actual,
    requestCastSpellForSocket,
  };
});

vi.mock('../src/utils/debug.js', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/debug.js')>('../src/utils/debug.js');
  return {
    ...actual,
    debugWarn,
  };
});

import { AIEngine, AIDecisionType } from '../../rules-engine/src/AIEngine.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function cleanupTrackedGame(gameId: string) {
  cleanupGameAI(gameId);
  unregisterAIPlayer(gameId, playerId as any);
  games.delete(gameId as any);
  deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
  } as any;
}

const trackedGameIds: string[] = [];
const playerId = 'ai1';

function createTestGameId(label: string): string {
  const gameId = `test_ai_top_library_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

describe('AI top-library integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    requestCastSpellForSocket.mockReset();
    debugWarn.mockReset();
    trackedGameIds.length = 0;
  });

  afterEach(() => {
    for (const gameId of trackedGameIds) {
      cleanupTrackedGame(gameId);
    }
  });

  it('plays a land from the top of the library when a player effect allows it', async () => {
    const gameId = createTestGameId('land');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
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
    (game.state as any).battlefield = [
      {
        id: 'future_sight_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'future_sight_card',
          name: 'Future Sight',
          type_line: 'Enchantment',
          oracle_text: 'Play with the top card of your library revealed. You may play the top card of your library.',
        },
      },
    ];
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'forest_top',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
          zone: 'library',
        },
        {
          id: 'opt_next',
          name: 'Opt',
          mana_cost: '{U}',
          type_line: 'Instant',
          oracle_text: 'Scry 1, then draw a card.',
          zone: 'library',
        },
      ]],
      ['opp1', []],
    ]);

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    const battlefieldCards = (((game.state as any).battlefield) || []).map((perm: any) => String(perm?.card?.id || ''));
    expect(battlefieldCards).toContain('forest_top');
    expect(Number((game.state as any).landsPlayedThisTurn?.[playerId] || 0)).toBe(1);
    expect(((game as any).libraries.get(playerId) || []).map((card: any) => String(card?.id || ''))).toEqual(['opt_next']);
  });

  it('casts the top library spell through the normal cast request pipeline', async () => {
    const gameId = createTestGameId('spell');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 2,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      opp1: {
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
    (game.state as any).battlefield = [
      {
        id: 'future_sight_perm',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'future_sight_card',
          name: 'Future Sight',
          type_line: 'Enchantment',
          oracle_text: 'Play with the top card of your library revealed. You may play the top card of your library.',
        },
      },
      {
        id: 'island_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'island_card_1',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '{T}: Add {U}.',
        },
      },
    ];
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'opt_top',
          name: 'Opt',
          mana_cost: '{U}',
          type_line: 'Instant',
          oracle_text: 'Scry 1, then draw a card.',
          zone: 'library',
        },
        {
          id: 'forest_next',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
          zone: 'library',
        },
      ]],
      ['opp1', []],
    ]);

    registerAIPlayer(gameId, playerId as any);

    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {},
      reasoning: 'No activated ability available',
      confidence: 1,
    } as any);

    requestCastSpellForSocket.mockImplementationOnce(async (_io: any, _socket: any, payload: any) => {
      const liveGame = ensureGame(String(payload?.gameId || ''));
      if (!liveGame) throw new Error('game missing during mocked cast');
      (liveGame.state as any).priority = null;
    });

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect(requestCastSpellForSocket).toHaveBeenCalledTimes(1);
    expect(requestCastSpellForSocket).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        gameId,
        cardId: 'opt_top',
        fromZone: 'library',
      }),
    );
    expect(
      debugWarn.mock.calls.some((call) => String(call[1] || '').includes('Shared cast request produced no state change')),
    ).toBe(false);
  });
});