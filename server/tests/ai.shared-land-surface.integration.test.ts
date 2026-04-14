import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  const gameId = `test_ai_shared_land_surface_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

describe('AI shared land-surface integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    trackedGameIds.length = 0;
  });

  afterEach(() => {
    for (const gameId of trackedGameIds) {
      cleanupGameAI(gameId);
      unregisterAIPlayer(gameId, playerId as any);
      games.delete(gameId as any);
    }
  });

  it('plays a land from the graveyard when shared land permissions allow it', async () => {
    const gameId = createTestGameId('graveyard_land');
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
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0 };
    (game.state as any).landPlayPermissions = {
      [playerId]: ['graveyard'],
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [
          {
            id: 'wasteland_1',
            name: 'Wasteland',
            type_line: 'Land',
            oracle_text: '{T}: Add {C}.',
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
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect((((game.state as any).battlefield) || []).map((perm: any) => String(perm?.card?.id || ''))).toContain('wasteland_1');
    expect((((game.state as any).zones?.[playerId]?.graveyard) || []).map((card: any) => String(card?.id || ''))).toEqual([]);
    expect(Number((game.state as any).landsPlayedThisTurn?.[playerId] || 0)).toBe(1);
  });

  it('plays a land from exile only when the shared playableFromExile marker allows that specific card', async () => {
    const gameId = createTestGameId('exile_land');
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
    (game.state as any).turnNumber = 4;
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0 };
    (game.state as any).playableFromExile = {
      [playerId]: {
        mountain_exile_1: 4,
      },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
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
            id: 'mountain_exile_1',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
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
    (game.state as any).battlefield = [];

    registerAIPlayer(gameId, playerId as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);

    expect((((game.state as any).battlefield) || []).map((perm: any) => String(perm?.card?.id || ''))).toContain('mountain_exile_1');
    expect((((game.state as any).zones?.[playerId]?.exile) || []).map((card: any) => String(card?.id || ''))).toEqual([]);
    expect(Number((game.state as any).landsPlayedThisTurn?.[playerId] || 0)).toBe(1);
  });
});