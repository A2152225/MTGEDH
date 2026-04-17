import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, getEffectivePower, getEffectiveToughness } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src/index.js';

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
    { id: attackingPlayerId, name: 'Attacker', spectator: false, life: 30 },
    { id: defendingPlayerId, name: 'Defender', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [attackingPlayerId]: 30, [defendingPlayerId]: 40 };
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
      type_line: 'Creature - Soldier',
      oracle_text: oracleText,
      power: String(basePower),
      toughness: String(baseToughness),
    },
  };
}

describe('attack keyword trigger de-duplication', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `attack_keyword_dedup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('pushes only one dethrone trigger from reminder text and adds one counter on resolution', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createCreature(
        'dethrone_attacker',
        attackingPlayerId,
        'Dethrone Attacker',
        'Dethrone (Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)',
        2,
        2
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'dethrone_attacker', targetPlayerId: defendingPlayerId }],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const sourceTriggers = stack.filter((item: any) => item?.source === 'dethrone_attacker');
    expect(sourceTriggers).toHaveLength(1);
    expect(sourceTriggers[0]?.triggerType).toBe('dethrone');

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const attacker = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'dethrone_attacker');
    expect(attacker?.counters?.['+1/+1']).toBe(1);
  });

  it('pushes only one training trigger from reminder text and adds one counter on resolution', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createCreature(
        'training_attacker',
        attackingPlayerId,
        'Training Attacker',
        'Training (Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.)',
        2,
        2
      ),
      createCreature('larger_attacker', attackingPlayerId, 'Larger Attacker', '', 4, 4),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [
        { creatureId: 'training_attacker', targetPlayerId: defendingPlayerId },
        { creatureId: 'larger_attacker', targetPlayerId: defendingPlayerId },
      ],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const sourceTriggers = stack.filter((item: any) => item?.source === 'training_attacker');
    expect(sourceTriggers).toHaveLength(1);
    expect(sourceTriggers[0]?.triggerType).toBe('training');

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const attacker = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'training_attacker');
    expect(attacker?.counters?.['+1/+1']).toBe(1);
  });

  it('pushes only one bushido trigger from reminder text and applies the bonus once', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createCreature('attacker', attackingPlayerId, 'Attacker', '', 2, 2),
      createCreature(
        'bushido_blocker',
        defendingPlayerId,
        'Bushido Blocker',
        'Bushido 1 (Whenever this creature blocks or becomes blocked, it gets +1/+1 until end of turn.)',
        2,
        2
      ),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'attacker', targetPlayerId: defendingPlayerId }],
    });

    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'bushido_blocker', attackerId: 'attacker' }],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const sourceTriggers = stack.filter((item: any) => item?.source === 'bushido_blocker');
    expect(sourceTriggers).toHaveLength(1);
    expect(sourceTriggers[0]?.triggerType).toBe('bushido');

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const blocker = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'bushido_blocker');
    expect(blocker?.temporaryPowerBoost).toBe(1);
    expect(blocker?.temporaryToughnessBoost).toBe(1);
    expect(getEffectivePower(blocker)).toBe(3);
    expect(getEffectiveToughness(blocker)).toBe(3);
  });
});