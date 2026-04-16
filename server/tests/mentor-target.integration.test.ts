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
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'DECLARE_ATTACKERS';
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

describe('mentor target keyword choice (integration)', () => {
  const gameId = 'mentor_target_keyword_integration';
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

  it('queues a mentor target step with the valid lesser-power attacker', () => {
    const game = seedGame(gameId, playerId, opponentId);
    const mentorPermanent = {
      id: 'mentor_perm',
      controller: playerId,
      attacking: true,
      power: 3,
      toughness: 3,
      counters: {},
      card: {
        id: 'mentor_card',
        name: 'Mentor Test Creature',
        type_line: 'Creature — Soldier',
        oracle_text: 'Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)',
        power: '3',
        toughness: '3',
      },
    };
    const smallerAttacker = {
      id: 'mentee_small',
      controller: playerId,
      attacking: true,
      power: 2,
      toughness: 2,
      counters: {},
      card: {
        id: 'mentee_small_card',
        name: 'Small Attacker',
        type_line: 'Creature — Soldier',
        power: '2',
        toughness: '2',
      },
    };
    const equalAttacker = {
      id: 'mentee_equal',
      controller: playerId,
      attacking: true,
      power: 3,
      toughness: 3,
      counters: {},
      card: {
        id: 'mentee_equal_card',
        name: 'Equal Attacker',
        type_line: 'Creature — Soldier',
        power: '3',
        toughness: '3',
      },
    };

    (game.state as any).battlefield.push(mentorPermanent, smallerAttacker, equalAttacker);

    executeTriggerEffect(
      game as any,
      playerId,
      'Mentor Test Creature',
      'Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.',
      {
        source: 'mentor_perm',
        permanentId: 'mentor_perm',
        triggerType: 'attacks',
        card: mentorPermanent.card,
        attackingCreatures: [mentorPermanent, smallerAttacker, equalAttacker],
      }
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.MENTOR_TARGET
    ) as any;

    expect(step).toBeDefined();
    expect(Array.isArray((game.state as any).pendingKeywordChoice) ? (game.state as any).pendingKeywordChoice : []).toHaveLength(0);
    expect((step.targets || []).map((target: any) => target.id)).toEqual(['mentee_small']);

    const sanitized = sanitizeStepForClient(gameId, step as any);
    expect(sanitized.type).toBe('mentor_target');
    expect((sanitized.targets || []).map((target: any) => target.id)).toEqual(['mentee_small']);
  });

  it('applies the selected mentor target through submitResolutionResponse', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    const mentorPermanent = {
      id: 'mentor_perm',
      controller: playerId,
      attacking: true,
      power: 3,
      toughness: 3,
      counters: {},
      card: {
        id: 'mentor_card',
        name: 'Mentor Test Creature',
        type_line: 'Creature — Soldier',
        oracle_text: 'Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)',
        power: '3',
        toughness: '3',
      },
    };
    const smallerAttacker = {
      id: 'mentee_small',
      controller: playerId,
      attacking: true,
      power: 2,
      toughness: 2,
      counters: {},
      card: {
        id: 'mentee_small_card',
        name: 'Small Attacker',
        type_line: 'Creature — Soldier',
        power: '2',
        toughness: '2',
      },
    };

    (game.state as any).battlefield.push(mentorPermanent, smallerAttacker);

    executeTriggerEffect(
      game as any,
      playerId,
      'Mentor Test Creature',
      'Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.',
      {
        source: 'mentor_perm',
        permanentId: 'mentor_perm',
        triggerType: 'attacks',
        card: mentorPermanent.card,
        attackingCreatures: [mentorPermanent, smallerAttacker],
      }
    );

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.MENTOR_TARGET
    ) as any;
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['mentee_small'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'mentee_small');
    expect(updatedPermanent?.counters?.['+1/+1']).toBe(1);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});