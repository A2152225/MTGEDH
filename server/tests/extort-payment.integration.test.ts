import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers, sanitizeStepForClient } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

describe('extort payment keyword automation (integration)', () => {
  const gameId = 'extort_payment_keyword_integration';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues an extort payment step on spell cast instead of falling back to pendingKeywordChoice', () => {
    const game = seedGame(gameId, playerId, opponentId);
    const extortPermanent = {
      id: 'extort_perm',
      controller: playerId,
      owner: playerId,
      counters: {},
      card: {
        id: 'extort_card',
        name: 'Extort Test Permanent',
        type_line: 'Creature — Spirit',
        oracle_text: 'Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)',
      },
    };

    (game.state as any).battlefield.push(extortPermanent);

    executeTriggerEffect(
      game as any,
      playerId,
      'Extort Test Permanent',
      'Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.',
      {
        source: 'extort_perm',
        permanentId: 'extort_perm',
        triggerType: 'cast',
        card: extortPermanent.card,
        spellCast: { card: { name: 'Test Spell' } },
      }
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.EXTORT_PAYMENT
    ) as any;

    expect(step).toBeDefined();
    expect(step.mandatory).toBe(false);
    expect(step.manaCost).toBe('{W/B}');
    expect(Array.isArray((game.state as any).pendingKeywordChoice) ? (game.state as any).pendingKeywordChoice : []).toHaveLength(0);

    const sanitized = sanitizeStepForClient(gameId, step as any);
    expect(sanitized.type).toBe('extort_payment');
    expect((sanitized as any).manaCost).toBe('{W/B}');
  });

  it('applies the selected extort payment through submitResolutionResponse', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    const extortPermanent = {
      id: 'extort_perm',
      controller: playerId,
      owner: playerId,
      counters: {},
      card: {
        id: 'extort_card',
        name: 'Extort Test Permanent',
        type_line: 'Creature — Spirit',
        oracle_text: 'Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.)',
      },
    };

    (game.state as any).battlefield.push(extortPermanent);
    (game.state as any).manaPool[playerId].white = 1;

    executeTriggerEffect(
      game as any,
      playerId,
      'Extort Test Permanent',
      'Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and you gain that much life.',
      {
        source: 'extort_perm',
        permanentId: 'extort_perm',
        triggerType: 'cast',
        card: extortPermanent.card,
        spellCast: { card: { name: 'Test Spell' } },
      }
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.EXTORT_PAYMENT
    ) as any;
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: {
        payment: [{ permanentId: '__pool__:white', mana: 'W', count: 1 }],
      },
    });

    expect((game.state as any).manaPool[playerId].white).toBe(0);
    expect((game.state as any).life[playerId]).toBe(41);
    expect((game.state as any).life[opponentId]).toBe(39);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});