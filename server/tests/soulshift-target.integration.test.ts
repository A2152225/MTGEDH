import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
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
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

describe('soulshift target keyword automation (integration)', () => {
  const gameId = 'soulshift_target_keyword_integration';
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

  it('queues a soulshift target step with only legal spirit cards from your graveyard', () => {
    const game = seedGame(gameId, playerId, opponentId);
    const soulshiftPermanent = {
      id: 'soulshift_source',
      controller: playerId,
      owner: playerId,
      power: 3,
      toughness: 3,
      counters: {},
      card: {
        id: 'soulshift_card',
        name: 'Soulshift Test Creature',
        type_line: 'Creature — Spirit',
        oracle_text: 'Soulshift 2 (When this creature dies, you may return target Spirit card with mana value 2 or less from your graveyard to your hand.)',
        power: '3',
        toughness: '3',
        cmc: 4,
      },
    };
    const validSpirit = {
      id: 'valid_spirit_card',
      name: 'Helpful Spirit',
      type_line: 'Creature — Spirit',
      mana_cost: '{1}{W}',
      cmc: 2,
    };
    const expensiveSpirit = {
      id: 'expensive_spirit_card',
      name: 'Big Spirit',
      type_line: 'Creature — Spirit',
      mana_cost: '{3}{W}',
      cmc: 4,
    };
    const nonSpirit = {
      id: 'non_spirit_card',
      name: 'Bear Cub',
      type_line: 'Creature — Bear',
      mana_cost: '{1}{G}',
      cmc: 2,
    };

    (game.state as any).battlefield.push(soulshiftPermanent);
    (game.state as any).zones[playerId].graveyard.push(validSpirit, expensiveSpirit, nonSpirit);
    (game.state as any).zones[playerId].graveyardCount = 3;

    expect(movePermanentToGraveyard(game as any, 'soulshift_source')).toBe(true);
    game.resolveTopOfStack();

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.SOULSHIFT_TARGET
    ) as any;

    expect(step).toBeDefined();
    expect(step.value).toBe(2);
    expect(Array.isArray((game.state as any).pendingKeywordChoice) ? (game.state as any).pendingKeywordChoice : []).toHaveLength(0);
    expect((step.spirits || []).map((target: any) => target.id)).toEqual(['valid_spirit_card']);

    const sanitized = sanitizeStepForClient(gameId, step as any);
    expect(sanitized.type).toBe('soulshift_target');
    expect((sanitized.spirits || []).map((target: any) => target.id)).toEqual(['valid_spirit_card']);
  });

  it('returns the selected spirit card to hand through submitResolutionResponse', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    const soulshiftPermanent = {
      id: 'soulshift_source',
      controller: playerId,
      owner: playerId,
      power: 3,
      toughness: 3,
      counters: {},
      card: {
        id: 'soulshift_card',
        name: 'Soulshift Test Creature',
        type_line: 'Creature — Spirit',
        oracle_text: 'Soulshift 2 (When this creature dies, you may return target Spirit card with mana value 2 or less from your graveyard to your hand.)',
        power: '3',
        toughness: '3',
        cmc: 4,
      },
    };
    const validSpirit = {
      id: 'valid_spirit_card',
      name: 'Helpful Spirit',
      type_line: 'Creature — Spirit',
      mana_cost: '{1}{W}',
      cmc: 2,
    };

    (game.state as any).battlefield.push(soulshiftPermanent);
    (game.state as any).zones[playerId].graveyard.push(validSpirit);
    (game.state as any).zones[playerId].graveyardCount = 1;

    expect(movePermanentToGraveyard(game as any, 'soulshift_source')).toBe(true);
    game.resolveTopOfStack();

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.SOULSHIFT_TARGET
    ) as any;
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['valid_spirit_card'],
    });

    const playerZones = (game.state as any).zones[playerId];
    expect((playerZones.hand || []).map((card: any) => card.id)).toContain('valid_spirit_card');
    expect((playerZones.graveyard || []).map((card: any) => card.id)).not.toContain('valid_spirit_card');
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});