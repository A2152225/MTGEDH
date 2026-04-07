import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('AI cast sequencing integration', () => {
  const gameId = 'test_ai_cast_sequencing';
  const playerId = 'ai1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    requestCastSpellForSocket.mockReset();
    cleanupGameAI(gameId);
    unregisterAIPlayer(gameId, playerId as any);
    games.delete(gameId as any);
  });

  it('does not chain additional spell attempts after a cast loses priority', async () => {
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
      {
        id: 'island_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'island_card_2',
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
            id: 'spell_1',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Scry 1, then draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'hand',
          },
          {
            id: 'spell_2',
            name: 'Consider',
            type_line: 'Instant',
            oracle_text: 'Look at the top card of your library. You may put that card into your graveyard. Draw a card.',
            mana_cost: '{U}',
            cmc: 1,
            zone: 'hand',
          },
        ],
        handCount: 2,
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
    expect((game.state as any).priority).toBeNull();
    expect(((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => String(card?.id || ''))).toEqual([
      'spell_1',
      'spell_2',
    ]);
  });
});