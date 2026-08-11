import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { initializeAIResolutionHandler } from '../src/socket/resolution.js';
import { AIEngine, AIDecisionType } from '../../rules-engine/src/AIEngine.js';

async function resetTestGame(gameId: string, playerId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  unregisterAIPlayer(gameId, playerId as any);
  await deleteGame(gameId);
}

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
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

describe('AI mana ability integration', () => {
  const playerId = 'ai1';
  const gameId = 'test_ai_mana_ability_integration';
  const trackedGameIds: string[] = [];

  beforeAll(async () => {
    await initDb();
    initializeAIResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    trackedGameIds.length = 0;
    await resetTestGame(gameId, playerId);
  });

  afterEach(async () => {
    while (trackedGameIds.length > 0) {
      const trackedGameId = trackedGameIds.pop();
      if (trackedGameId) {
        await resetTestGame(trackedGameId, playerId);
      }
    }
    await resetTestGame(gameId, playerId);
  });

  async function setupTestGame(suffix: string) {
    const localGameId = `${gameId}_${suffix}_${Math.random().toString(36).slice(2, 10)}`;
    trackedGameIds.push(localGameId);
    await resetTestGame(localGameId, playerId);
    createGameIfNotExists(localGameId, 'commander', 40);
    const game = ensureGame(localGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    return { localGameId, game };
  }

  it('does not standalone-tap lands for mana with nothing to spend it on', async () => {
    const { localGameId, game } = await setupTestGame('no_standalone_tap');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: 'opp1', name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, opp1: 40 };
    (game.state as any).lifeLostThisTurn = { [playerId]: 0 };
    (game.state as any).damageTakenThisTurnByPlayer = { [playerId]: 0 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UPKEEP';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      opp1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'attrition_1',
            name: 'Attrition',
            type_line: 'Enchantment',
            oracle_text: '{B}, Sacrifice a creature: Destroy target creature.',
            mana_cost: '{1}{B}{B}',
            cmc: 3,
            zone: 'hand',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
      },
      opp1: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
        exile: [],
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'swamp_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'swamp_card_1',
          name: 'Swamp',
          type_line: 'Basic Land — Swamp',
          oracle_text: '({T}: Add {B}.)',
        },
      },
      {
        id: 'swamp_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          id: 'swamp_card_2',
          name: 'Swamp',
          type_line: 'Basic Land — Swamp',
          oracle_text: '({T}: Add {B}.)',
        },
      },
    ];

    registerAIPlayer(localGameId, playerId as any);
    // Even if the decision engine proposes a Swamp tap, the AI must refuse it as a
    // free-standing priority action (payment/retention paths activate mana separately).
    vi.spyOn(AIEngine.prototype, 'makeDecision').mockResolvedValue({
      type: AIDecisionType.ACTIVATE_ABILITY,
      playerId,
      action: {
        activate: true,
        permanentId: 'swamp_1',
        cardName: 'Swamp',
        abilityText: '({T}: Add {B}.)',
      },
      reasoning: 'Test-selected activation for Swamp',
      confidence: 1,
    } as any);

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as any);
    try {
      await handleAIPriority(createNoopIo(), localGameId, playerId as any);
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      setTimeoutSpy.mockRestore();
    }

    const swamps = ((game.state as any).battlefield || []).filter((perm: any) => String(perm?.card?.name || '') === 'Swamp');
    expect(swamps).toHaveLength(2);
    expect(swamps.every((perm: any) => perm.tapped !== true)).toBe(true);
    const totalMana = Object.values((game.state as any).manaPool?.[playerId] || {}).reduce((sum: number, amount: any) => sum + Number(amount || 0), 0);
    expect(totalMana).toBe(0);
    expect(getEvents(localGameId).some((event: any) => event?.type === 'activateManaAbility')).toBe(false);
  });
});
