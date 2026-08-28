import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const ARCHANGEL_ORACLE =
  "Flying\nAs long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.\nAs long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.";

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

function seedCombatGame(gameId: string, attackingPlayerId: string, defendingPlayerId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: attackingPlayerId, name: 'Attacker', spectator: false, life: 40 },
    { id: defendingPlayerId, name: 'Defender', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [attackingPlayerId]: 40, [defendingPlayerId]: 40 };
  (game.state as any).turnPlayer = attackingPlayerId;
  (game.state as any).activePlayer = attackingPlayerId;
  (game.state as any).priority = attackingPlayerId;
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [attackingPlayerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    [defendingPlayerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    [attackingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [defendingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  (game.state as any).battlefield = [];
  return game;
}

function createCreature(id: string, controller: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    basePower: 2,
    baseToughness: 2,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
    ...extra,
  };
}

describe('Archangel of Tithes block tax via Resolution Queue', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `test_block_cost_payment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('prompts for {1} while Archangel is attacking and applies the block after paying', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'angel_1',
        controller: attackingPlayerId,
        owner: attackingPlayerId,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'angel_card',
          name: 'Tithe Angel',
          type_line: 'Creature — Angel',
          oracle_text: ARCHANGEL_ORACLE,
          power: '3',
          toughness: '5',
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood'),
      {
        id: 'plains_1',
        controller: defendingPlayerId,
        owner: defendingPlayerId,
        tapped: false,
        card: {
          name: 'Plains',
          type_line: 'Basic Land — Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);
    registerResolutionHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [
        { creatureId: 'angel_1', targetPlayerId: defendingPlayerId },
        { creatureId: 'bear_1', targetPlayerId: defendingPlayerId },
      ],
    });
    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'wall_1', attackerId: 'bear_1' }],
    });

    const wall = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1');
    expect(wall?.blocking).toBeFalsy();
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.blockCostPayment === true) as any;
    expect(step).toBeDefined();
    expect(step.blockCostAmount).toBe(1);

    await defenderSocket.handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: 'pay_block_cost',
    });

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1')?.blocking).toEqual(['bear_1']);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1')?.blockedBy).toEqual(['wall_1']);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'plains_1')?.tapped).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => entry?.blockCostPayment === true)).toBe(false);
  });

  it('does not tax blockers when Archangel is not attacking', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'angel_1',
        controller: attackingPlayerId,
        owner: attackingPlayerId,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'angel_card',
          name: 'Tithe Angel',
          type_line: 'Creature — Angel',
          oracle_text: ARCHANGEL_ORACLE,
          power: '3',
          toughness: '5',
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood'),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'bear_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'wall_1', attackerId: 'bear_1' }],
    });

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1')?.blocking).toEqual(['bear_1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => entry?.blockCostPayment === true)).toBe(false);
  });

  it('charges {2} for two unique blockers and refuses when the defender cannot pay', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'angel_1',
        controller: attackingPlayerId,
        owner: attackingPlayerId,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'angel_card',
          name: 'Tithe Angel',
          type_line: 'Creature — Angel',
          oracle_text: ARCHANGEL_ORACLE,
          power: '3',
          toughness: '5',
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'),
      createCreature('bear_2', attackingPlayerId, 'Runeclaw Bear'),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood'),
      createCreature('wall_2', defendingPlayerId, 'Wall of Stone'),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [
        { creatureId: 'angel_1', targetPlayerId: defendingPlayerId },
        { creatureId: 'bear_1', targetPlayerId: defendingPlayerId },
        { creatureId: 'bear_2', targetPlayerId: defendingPlayerId },
      ],
    });
    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [
        { blockerId: 'wall_1', attackerId: 'bear_1' },
        { blockerId: 'wall_2', attackerId: 'bear_2' },
      ],
    });

    const error = emitted.find((entry) => entry.event === 'error' && entry.payload?.code === 'INSUFFICIENT_MANA_FOR_BLOCK');
    expect(error?.payload?.message).toMatch(/Need to pay \{2\}/);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1')?.blocking).toBeFalsy();
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => entry?.blockCostPayment === true)).toBe(false);
  });
});
