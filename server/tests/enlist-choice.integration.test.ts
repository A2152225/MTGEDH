import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, getEffectivePower } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
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

function seedCombatGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

function createEnlistAttacker(playerId: string) {
  return {
    id: 'enlist_attacker',
    controller: playerId,
    owner: playerId,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: 2,
    baseToughness: 2,
    card: {
      id: 'enlist_attacker_card',
      name: 'Enlist Attacker',
      type_line: 'Creature — Soldier',
      oracle_text: 'Enlist (As this creature attacks, you may tap an untapped nonattacking creature you control without summoning sickness. When you do, add its power to this creature until end of turn.)',
      power: '2',
      toughness: '2',
    },
  };
}

describe('enlist choice keyword automation (integration)', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `enlist_choice_keyword_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  it('queues enlist with only untapped nonattacking creatures that can be tapped', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createEnlistAttacker(playerId),
      {
        id: 'helper_valid',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'helper_valid_card',
          name: 'Ready Helper',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: 'helper_hasty',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        summoningSickness: true,
        basePower: 4,
        baseToughness: 1,
        card: {
          id: 'helper_hasty_card',
          name: 'Hasty Helper',
          type_line: 'Creature — Warrior',
          oracle_text: 'Haste',
          power: '4',
          toughness: '1',
        },
      },
      {
        id: 'helper_sick',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        summoningSickness: true,
        basePower: 6,
        baseToughness: 6,
        card: {
          id: 'helper_sick_card',
          name: 'Sick Helper',
          type_line: 'Creature — Knight',
          oracle_text: '',
          power: '6',
          toughness: '6',
        },
      },
      {
        id: 'helper_tapped',
        controller: playerId,
        owner: playerId,
        tapped: true,
        counters: {},
        summoningSickness: false,
        basePower: 5,
        baseToughness: 5,
        card: {
          id: 'helper_tapped_card',
          name: 'Tapped Helper',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          power: '5',
          toughness: '5',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'enlist_attacker', targetPlayerId: opponentId }],
    });

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION && entry?.enlistChoice === true
    ) as any;

    expect(step).toBeDefined();
    expect((step.validTargets || []).map((entry: any) => entry.id)).toEqual(['helper_valid', 'helper_hasty']);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('adds the enlisted creature power through submitResolutionResponse and applies boosted combat damage', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, playerId, opponentId);

    (game.state as any).battlefield = [
      createEnlistAttacker(playerId),
      {
        id: 'helper_valid',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        summoningSickness: false,
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'helper_valid_card',
          name: 'Ready Helper',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          power: '3',
          toughness: '3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'enlist_attacker', targetPlayerId: opponentId }],
    });

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION && entry?.enlistChoice === true
    ) as any;
    expect(step).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['helper_valid'],
    });

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const attacker = battlefield.find((perm: any) => perm?.id === 'enlist_attacker');
    const helper = battlefield.find((perm: any) => perm?.id === 'helper_valid');

    expect(attacker?.attacking).toBe(opponentId);
    expect(helper?.tapped).toBe(true);
    expect(attacker?.temporaryPowerBoost).toBe(3);
    expect(getEffectivePower(attacker)).toBe(5);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId).some((entry: any) => entry?.enlistChoice === true)).toBe(false);

    attacker.blockedBy = [];
    game.applyEvent({ type: 'nextStep' });
    game.applyEvent({ type: 'nextStep' });

    expect((game.state as any).life?.[opponentId]).toBe(35);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});