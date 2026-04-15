import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

const trackedGameIds: string[] = [];
const playerId = 'ai1';

function cleanupTrackedGame(gameId: string) {
  cleanupGameAI(gameId);
  unregisterAIPlayer(gameId, playerId as any);
  games.delete(gameId as any);
  deleteGame(gameId);
}

function createTestGameId(label: string): string {
  const gameId = `test_ai_shared_mana_retention_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

describe('AI shared mana-retention integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    trackedGameIds.length = 0;
  });

  afterEach(() => {
    for (const gameId of trackedGameIds) {
      cleanupTrackedGame(gameId);
    }
  });

  it('routes retention taps through shared battlefield activation and prefers the painless colorless line', async () => {
    const gameId = createTestGameId('pain_land_colorless');
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnNumber = 7;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0 };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'upwelling_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'upwelling_card_1',
          name: 'Upwelling',
          type_line: 'Enchantment',
          oracle_text: 'Mana pools do not empty as steps and phases end.',
        },
      },
      ...Array.from({ length: 5 }, (_entry, index) => ({
        id: `battlefield_forge_${index + 1}`,
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: `battlefield_forge_card_${index + 1}`,
          name: 'Battlefield Forge',
          type_line: 'Land',
          oracle_text: '{T}: Add {C}.\n{T}: Add {R} or {W}. Battlefield Forge deals 1 damage to you.',
        },
      })),
    ];

    registerAIPlayer(gameId, playerId as any);

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), gameId, playerId as any);
    } finally {
      setTimeoutSpy.mockRestore();
    }

    expect((game.state as any).aiManaRetentionTaps?.[playerId]).toBe(7);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(2);
    expect((game.state as any).manaPool?.[playerId]?.white).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.red).toBe(0);
    expect((game.state as any).life?.[playerId]).toBe(40);
    expect((game.state as any).lifeLostThisTurn?.[playerId]).toBe(0);
    expect(((game.state as any).battlefield || []).filter((perm: any) => perm?.tapped).length).toBe(2);

    const activateBattlefieldEvents = getEvents(gameId).filter((event: any) => event?.type === 'activateBattlefieldAbility');
    expect(activateBattlefieldEvents).toHaveLength(2);
    expect(activateBattlefieldEvents.map((event: any) => String(event?.payload?.abilityId || ''))).toEqual([
      'battlefield_forge_card_1-ability-0',
      'battlefield_forge_card_2-ability-0',
    ]);
    expect(getEvents(gameId).some((event: any) => event?.type === 'activateAbility')).toBe(false);
  });
});