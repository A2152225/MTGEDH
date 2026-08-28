import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const SILENT_ARBITER_ORACLE =
  'No more than one creature can attack each combat.\nNo more than one creature can block each combat.';

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

describe('Silent Arbiter max blockers each combat', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `max_blockers_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('rejects two unique blockers and accepts one creature blocking one attacker', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'arbiter_1',
        controller: defendingPlayerId,
        card: {
          id: 'arbiter_card',
          name: 'Gate Warden',
          type_line: 'Artifact Creature — Construct',
          oracle_text: SILENT_ARBITER_ORACLE,
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears'),
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
      attackers: [{ creatureId: 'bear_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [
        { blockerId: 'wall_1', attackerId: 'bear_1' },
        { blockerId: 'wall_2', attackerId: 'bear_1' },
      ],
    });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('TOO_MANY_BLOCKERS');
    expect((game.state as any).blockersDeclaredBy || []).not.toContain(defendingPlayerId);

    emitted.length = 0;
    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'wall_1', attackerId: 'bear_1' }],
    });
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });
});
