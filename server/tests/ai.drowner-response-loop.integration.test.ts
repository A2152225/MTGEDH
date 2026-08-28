import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIDecisionType, AIEngine } from '../../rules-engine/src/AIEngine.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { cleanupGameAI, handleAIPriority, registerAIPlayer, unregisterAIPlayer } from '../src/socket/ai.js';
import { initializeAIResolutionHandler, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const playerId = 'ai_drowner';
const opponentId = 'opp_upkeep';
const trackedGameIds: string[] = [];

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

async function cleanupTrackedGame(gameId: string) {
  cleanupGameAI(gameId);
  unregisterAIPlayer(gameId, playerId as any);
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createTestGameId(): string {
  const gameId = `test_ai_drowner_response_loop_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

describe('AI Drowner of Secrets response-window activation', () => {
  beforeAll(async () => {
    await initDb();
    const io = createNoopIo();
    initializePriorityResolutionHandler(io);
    initializeAIResolutionHandler(io);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    trackedGameIds.length = 0;
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await cleanupTrackedGame(gameId);
    }
  });

  it('taps a Merfolk as the activation cost instead of no-op looping on an opponent upkeep', async () => {
    const gameId = createTestGameId();
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'AI', spectator: false, isAI: true, life: 40 },
      { id: opponentId, name: 'Opponent', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).activePlayer = opponentId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'upkeep';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'drowner',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'drowner-card',
          name: 'Drowner of Secrets',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: 'Tap an untapped Merfolk you control: Target player mills a card.',
        },
      },
      {
        id: 'helper',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'helper-card',
          name: 'Merfolk Helper',
          type_line: 'Creature — Merfolk Wizard',
          oracle_text: '',
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
        exile: [],
        exileCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        library: [
          { id: 'milled_1', name: 'Top Card', type_line: 'Artifact', oracle_text: '' },
        ],
        libraryCount: 1,
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
      action: {
        activate: true,
        permanentId: 'drowner',
        cardName: 'Drowner of Secrets',
        abilityText: 'Tap an untapped Merfolk you control: Target player mills a card.',
      },
      reasoning: 'Test-selected Drowner activation',
      confidence: 1,
    } as any);

    await handleAIPriority(createNoopIo(), gameId, playerId as any);
    await new Promise((resolve) => setImmediate(resolve));

    const battlefield = Array.isArray((game.state as any).battlefield) ? (game.state as any).battlefield : [];
    const tappedMerfolk = battlefield.filter((perm: any) => Boolean(perm?.tapped));
    const pendingSteps = ResolutionQueueManager.getQueue(gameId).steps;
    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];

    expect(tappedMerfolk.length).toBeGreaterThan(0);
    expect(
      pendingSteps.some((step: any) => String(step?.type || '') === 'target_selection')
      || stack.some((item: any) => String(item?.sourceName || '') === 'Drowner of Secrets'),
    ).toBe(true);
  });
});
