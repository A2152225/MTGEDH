import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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

function createCreature(id: string, controller: string, name: string, oracleText: string, basePower: number, baseToughness: number) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    basePower,
    baseToughness,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature - Horror',
      oracle_text: oracleText,
      power: String(basePower),
      toughness: String(baseToughness),
    },
  };
}

describe('afflict block trigger automation', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `afflict_block_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('pushes an afflict trigger when the attacker becomes blocked and makes the defending player lose life on resolution', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createCreature('afflict_attacker', attackingPlayerId, 'Afflict Attacker', 'Afflict 2', 3, 3),
      createCreature('blocker_one', defendingPlayerId, 'Blocker One', '', 2, 2),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'afflict_attacker', targetPlayerId: defendingPlayerId }],
    });

    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'blocker_one', attackerId: 'afflict_attacker' }],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const trigger = stack.find((item: any) => item?.source === 'afflict_attacker');
    expect(trigger?.triggerType).toBe('afflict');
    expect(trigger?.defendingPlayer).toBe(defendingPlayerId);

    const triggerEvent = getEvents(gameId).find((event) => {
      const payload = (event as any).payload || {};
      return event.type === 'pushTriggeredAbility' && payload.triggerType === 'afflict';
    });
    expect(triggerEvent).toBeTruthy();
    expect((game.state as any).life[defendingPlayerId]).toBe(40);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect((game.state as any).life[defendingPlayerId]).toBe(38);
    expect(((game.state as any).stack || []).length).toBe(0);
  });

  it('replays a persisted afflict trigger and uses the defending player snapshot for life loss', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const attacker = createCreature('afflict_attacker', attackingPlayerId, 'Afflict Attacker', 'Afflict 2', 3, 3);
    (attacker as any).attacking = defendingPlayerId;
    (attacker as any).blockedBy = ['blocker_one'];

    const blocker = createCreature('blocker_one', defendingPlayerId, 'Blocker One', '', 2, 2);
    (blocker as any).blocking = ['afflict_attacker'];

    (game.state as any).battlefield = [attacker, blocker];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'afflict_trigger_replay',
      sourceId: 'afflict_attacker',
      sourceName: 'Afflict Attacker',
      controllerId: attackingPlayerId,
      description: 'Defending player loses 2 life when this creature becomes blocked',
      triggerType: 'afflict',
      effect: 'Defending player loses 2 life when this creature becomes blocked',
      mandatory: true,
      value: {
        blockingCreatureIds: ['blocker_one'],
        defendingPlayer: defendingPlayerId,
      },
      defendingPlayer: defendingPlayerId,
      targetPlayer: defendingPlayerId,
      triggeringPlayer: attackingPlayerId,
    } as any);

    expect((game.state as any).life[defendingPlayerId]).toBe(40);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    expect((game.state as any).life[defendingPlayerId]).toBe(38);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});