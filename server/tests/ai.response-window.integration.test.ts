import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestCastSpellForSocket } = vi.hoisted(() => ({
  requestCastSpellForSocket: vi.fn(),
}));

vi.mock('../src/socket/game-actions.js', async () => {
  const actual = await vi.importActual<typeof import('../src/socket/game-actions.js')>('../src/socket/game-actions.js');
  return {
    ...actual,
    requestCastSpellForSocket,
  };
});

import { AIEngine, AIDecisionType } from '../../rules-engine/src/AIEngine.js';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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
  const gameId = `test_ai_response_window_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

describe('AI response-window integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    requestCastSpellForSocket.mockReset();
    trackedGameIds.length = 0;
  });

  afterEach(() => {
    for (const gameId of trackedGameIds) {
      cleanupGameAI(gameId);
      unregisterAIPlayer(gameId, playerId as any);
      games.delete(gameId as any);
    }
  });

  it('casts a hand instant on an opponent turn instead of hard-passing', async () => {
    const gameId = createTestGameId('hand_instant');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = 'opp1';
    (game.state as any).activePlayer = 'opp1';
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
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
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'opt_hand',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1, then draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
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
        cardId: 'opt_hand',
        fromZone: 'hand',
      }),
    );
  });

  it('casts a top-library instant on an opponent turn when the shared permission model allows it', async () => {
    const gameId = createTestGameId('library_instant');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = 'opp1';
    (game.state as any).activePlayer = 'opp1';
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
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
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 1,
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
  });

  it('casts a flashback instant from graveyard on an opponent turn through the shared cast request flow', async () => {
    const gameId = createTestGameId('graveyard_flashback');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = 'opp1';
    (game.state as any).activePlayer = 'opp1';
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
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
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'think_twice_1',
            name: 'Think Twice',
            type_line: 'Instant',
            oracle_text: 'Draw a card. Flashback {U}.',
            mana_cost: '{1}{U}',
            cmc: 2,
            zone: 'graveyard',
          },
        ],
        graveyardCount: 1,
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
        cardId: 'think_twice_1',
        fromZone: 'graveyard',
      }),
    );
  });

  it('casts a card-specific playable-from-exile instant on an opponent turn through the shared cast request flow', async () => {
    const gameId = createTestGameId('exile_spell');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = 'opp1';
    (game.state as any).activePlayer = 'opp1';
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).turnNumber = 4;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).playableFromExile = {
      [playerId]: {
        exile_opt_1: 4,
      },
    };
    (game.state as any).battlefield = [
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
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [
          {
            id: 'exile_opt_1',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1, then draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'exile',
          },
        ],
        exileCount: 1,
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
        cardId: 'exile_opt_1',
        fromZone: 'exile',
      }),
    );
  });
});