import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
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

function seedCombatGame(gameId: string, attackingPlayerId: PlayerID, defendingPlayerId: PlayerID) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: attackingPlayerId, name: 'Attacker', spectator: false, life: 40 },
    { id: defendingPlayerId, name: 'Defender', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
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

function createRotWolf(id: string, controller: PlayerID) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    basePower: 1,
    baseToughness: 1,
    card: {
      id: `${id}_card`,
      name: 'Rot Wolf',
      type_line: 'Creature — Wolf',
      oracle_text:
        'Infect (This creature deals damage to creatures in the form of -1/-1 counters and to players in the form of poison counters.)\nPoisonous 1 (Whenever this creature deals combat damage to a player, that player gets a poison counter.)',
      keywords: ['Infect', 'Poisonous'],
      power: '1',
      toughness: '1',
    },
  };
}

describe('combat infect/wither socket integration', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `combat_infect_socket_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('socket declareAttackers + combat damage exposes poison counters in client view (Rot Wolf pattern)', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [createRotWolf('rot_wolf_1', attackingPlayerId)];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    const lifeBefore = (game.state as any).life[defendingPlayerId];

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'rot_wolf_1', targetPlayerId: defendingPlayerId }],
    });

    const rotWolf = (game.state as any).battlefield.find((perm: any) => perm.id === 'rot_wolf_1');
    expect(rotWolf?.attacking).toBe(defendingPlayerId);

    (game.state as any).step = 'declareBlockers';
    game.applyEvent({ type: 'nextStep' });

    expect((game.state as any).life[defendingPlayerId]).toBe(lifeBefore);
    expect((game.state as any).poisonCounters?.[defendingPlayerId]).toBe(2);

    const defenderView = game.viewFor(defendingPlayerId);
    const attackerView = game.viewFor(attackingPlayerId);

    expect(defenderView.poisonCounters?.[defendingPlayerId]).toBe(2);
    expect(attackerView.poisonCounters?.[defendingPlayerId]).toBe(2);
  });
});
