import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { executeDeclareBlockers } from '../src/socket/ai-handlers/aiPriorityPassCombatExecutors.js';
import { executeDeclareAttackers } from '../src/socket/combat-handlers/combatDeclareAttackersExecute.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const SILENT_ARBITER_ORACLE =
  'No more than one creature can attack each combat.\nNo more than one creature can block each combat.';
const ARCHANGEL_ORACLE =
  "Flying\nAs long as this creature is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.\nAs long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
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
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [attackingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [defendingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };
  return game;
}

function createCreature(id: string, controller: string, name: string) {
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
  };
}

function createPlains(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      name: 'Plains',
      type_line: 'Basic Land — Plains',
      oracle_text: '{T}: Add {W}.',
    },
  };
}

function createArchangel(controller: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'angel_1',
    controller,
    owner: controller,
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
    ...extra,
  };
}

function createGateWarden(controller: string) {
  return {
    id: 'arbiter_1',
    controller,
    card: {
      id: 'arbiter_card',
      name: 'Gate Warden',
      type_line: 'Artifact Creature — Construct',
      oracle_text: SILENT_ARBITER_ORACLE,
    },
  };
}

describe('AI / combat execute honors Silent Arbiter-style caps', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `ai_max_atk_blk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
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

  it('executeDeclareAttackers throws TOO_MANY_ATTACKERS for two attackers and accepts one', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createGateWarden(defendingPlayerId),
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'),
      createCreature('bear_2', attackingPlayerId, 'Runeclaw Bear'),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    await expect(
      executeDeclareAttackers(io as any, gameId, attackingPlayerId, [
        { creatureId: 'bear_1', targetPlayerId: defendingPlayerId },
        { creatureId: 'bear_2', targetPlayerId: defendingPlayerId },
      ]),
    ).rejects.toMatchObject({
      code: 'TOO_MANY_ATTACKERS',
      message: 'No more than 1 creatures can attack this combat.',
    });

    const bear1AfterReject = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1');
    const bear2AfterReject = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_2');
    expect(bear1AfterReject?.attacking).toBeFalsy();
    expect(bear2AfterReject?.attacking).toBeFalsy();

    await executeDeclareAttackers(io as any, gameId, attackingPlayerId, [
      { creatureId: 'bear_1', targetPlayerId: defendingPlayerId },
    ]);

    const bear1 = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1');
    const bear2 = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_2');
    expect(bear1?.attacking).toBe(defendingPlayerId);
    expect(bear2?.attacking).toBeFalsy();
  });

  it('AI executeDeclareBlockers trims two unique walls to one under the block cap', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createGateWarden(defendingPlayerId),
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood'),
      createCreature('wall_2', defendingPlayerId, 'Wall of Stone'),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'bear_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';
    (game.state as any).blockersDeclaredBy = [];

    await executeDeclareBlockers(io as any, gameId, defendingPlayerId, [
      { blockerId: 'wall_1', attackerId: 'bear_1' },
      { blockerId: 'wall_2', attackerId: 'bear_1' },
    ]);

    const wall1 = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1');
    const wall2 = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_2');
    const bear = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1');
    const uniqueBlockerIds = new Set(
      [wall1, wall2]
        .filter((perm: any) => Array.isArray(perm?.blocking) && perm.blocking.includes('bear_1'))
        .map((perm: any) => String(perm.id)),
    );
    expect(uniqueBlockerIds.size).toBe(1);
    expect(uniqueBlockerIds.has('wall_1')).toBe(true);
    expect(wall2?.blocking || []).toEqual([]);
    expect(bear?.blockedBy).toEqual(['wall_1']);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('AI pays Archangel block tax and declares the blocker', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createArchangel(attackingPlayerId, { attacking: defendingPlayerId, tapped: true }),
      { ...createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'), attacking: defendingPlayerId },
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood'),
      createPlains('plains_1', defendingPlayerId),
    ];
    (game.state as any).step = 'declareBlockers';
    (game.state as any).blockersDeclaredBy = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    await executeDeclareBlockers(io as any, gameId, defendingPlayerId, [
      { blockerId: 'wall_1', attackerId: 'bear_1' },
    ]);

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1')?.blocking).toEqual(['bear_1']);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1')?.blockedBy).toEqual(['wall_1']);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'plains_1')?.tapped).toBe(true);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('AI drops an extra unique blocker when it cannot pay the full Archangel tax', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createArchangel(attackingPlayerId, { attacking: defendingPlayerId, tapped: true }),
      { ...createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'), attacking: defendingPlayerId },
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood'),
      createCreature('wall_2', defendingPlayerId, 'Wall of Stone'),
      createPlains('plains_1', defendingPlayerId),
    ];
    (game.state as any).step = 'declareBlockers';
    (game.state as any).blockersDeclaredBy = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    await executeDeclareBlockers(io as any, gameId, defendingPlayerId, [
      { blockerId: 'wall_1', attackerId: 'bear_1' },
      { blockerId: 'wall_2', attackerId: 'bear_1' },
    ]);

    const wall1 = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1');
    const wall2 = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_2');
    expect(wall1?.blocking).toEqual(['bear_1']);
    expect(wall2?.blocking || []).toEqual([]);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'plains_1')?.tapped).toBe(true);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('AI declares no blockers when it cannot pay Archangel tax', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createArchangel(attackingPlayerId, { attacking: defendingPlayerId, tapped: true }),
      { ...createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'), attacking: defendingPlayerId },
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood'),
    ];
    (game.state as any).step = 'declareBlockers';
    (game.state as any).blockersDeclaredBy = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);

    await executeDeclareBlockers(io as any, gameId, defendingPlayerId, [
      { blockerId: 'wall_1', attackerId: 'bear_1' },
    ]);

    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1')?.blocking).toBeFalsy();
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });
});
