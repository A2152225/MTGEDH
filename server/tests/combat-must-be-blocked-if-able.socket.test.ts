import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { executeDeclareBlockers } from '../src/socket/ai-handlers/aiPriorityPassCombatExecutors.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

// Quoted from mtg_data.db / oracle-cards (is_token = 0), 2026-08-25.
const LURE_ORACLE =
  'Enchant creature\nAll creatures able to block enchanted creature do so.';
const FIRE_FIEND_ORACLE =
  'Haste\nThis creature must be blocked if able.\n{R}: This creature gets +1/+0 until end of turn.';

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

function createCreature(id: string, controller: string, name: string, oracleText: string) {
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
      oracle_text: oracleText,
      power: '2',
      toughness: '2',
    },
  };
}

describe('must-be-blocked-if-able declare-blockers submit', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `must_be_blocked_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('rejects an empty declaration when a Lure host is attacking and a legal blocker is unused', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'bear_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears', ''),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
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
      blockers: [],
    });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('MUST_BE_BLOCKED_IF_ABLE');
    expect((game.state as any).blockersDeclaredBy || []).not.toContain(defendingPlayerId);
  });

  it('accepts leaving a flying Lure host unblocked when no legal blocker exists', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const flyer = createCreature('drake_1', attackingPlayerId, 'Wind Drake', 'Flying');
    flyer.card.type_line = 'Creature — Drake';
    flyer.card.keywords = ['Flying'];

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'drake_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      flyer,
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'drake_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [],
    });

    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('rejects skipDeclareBlockers when a Lure host is attacking and a legal blocker is unused', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'bear_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears', ''),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
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

    await defenderSocket.handlers.skipDeclareBlockers({ gameId });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('MUST_BE_BLOCKED_IF_ABLE');
    expect((game.state as any).blockersDeclaredBy || []).not.toContain(defendingPlayerId);
  });

  it('allows skipDeclareBlockers when a flying Lure host has no legal blocker', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const flyer = createCreature('drake_1', attackingPlayerId, 'Wind Drake', 'Flying');
    flyer.card.type_line = 'Creature — Drake';
    flyer.card.keywords = ['Flying'];

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'drake_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      flyer,
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'drake_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.skipDeclareBlockers({ gameId });

    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('AI empty declare auto-assigns a legal blocker onto a Lure host instead of skipping', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'bear_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears', ''),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'bear_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';
    (game.state as any).blockersDeclaredBy = [];

    await executeDeclareBlockers(io as any, gameId, defendingPlayerId, []);

    const wall = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1');
    const bear = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1');
    expect(wall?.blocking).toEqual(['bear_1']);
    expect(bear?.blockedBy).toEqual(['wall_1']);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('AI empty declare stays empty when a flying Lure host has no legal blocker', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const flyer = createCreature('drake_1', attackingPlayerId, 'Wind Drake', 'Flying');
    flyer.card.type_line = 'Creature — Drake';
    flyer.card.keywords = ['Flying'];

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'drake_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      flyer,
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'drake_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';
    (game.state as any).blockersDeclaredBy = [];

    await executeDeclareBlockers(io as any, gameId, defendingPlayerId, []);

    const wall = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1');
    const drake = (game.state as any).battlefield.find((perm: any) => perm.id === 'drake_1');
    expect(wall?.blocking || []).toEqual([]);
    expect(drake?.blockedBy || []).toEqual([]);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('rejects declaring only one of two able blockers versus a Lure host', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'bear_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears', ''),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
      createCreature('wall_2', defendingPlayerId, 'Wall of Roots', ''),
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

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('MUST_BE_BLOCKED_IF_ABLE');
    expect((game.state as any).blockersDeclaredBy || []).not.toContain(defendingPlayerId);
  });

  it('AI empty declare auto-assigns every able blocker onto a Lure host', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      {
        id: 'lure_1',
        controller: attackingPlayerId,
        attachedTo: 'bear_1',
        card: {
          id: 'lure_card',
          name: 'Lure',
          type_line: 'Enchantment — Aura',
          oracle_text: LURE_ORACLE,
        },
      },
      createCreature('bear_1', attackingPlayerId, 'Grizzly Bears', ''),
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
      createCreature('wall_2', defendingPlayerId, 'Wall of Roots', ''),
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

    await executeDeclareBlockers(io as any, gameId, defendingPlayerId, []);

    const wall1 = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_1');
    const wall2 = (game.state as any).battlefield.find((perm: any) => perm.id === 'wall_2');
    const bear = (game.state as any).battlefield.find((perm: any) => perm.id === 'bear_1');
    expect(wall1?.blocking).toEqual(['bear_1']);
    expect(wall2?.blocking).toEqual(['bear_1']);
    expect(bear?.blockedBy).toEqual(['wall_1', 'wall_2']);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });

  it('accepts assigning only one of two able blockers versus Goblin Fire Fiend', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const fiend = createCreature('fiend_1', attackingPlayerId, 'Goblin Fire Fiend', FIRE_FIEND_ORACLE);
    fiend.card.type_line = 'Creature — Goblin Berserker';

    (game.state as any).battlefield = [
      fiend,
      createCreature('wall_1', defendingPlayerId, 'Wall of Wood', ''),
      createCreature('wall_2', defendingPlayerId, 'Wall of Roots', ''),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'fiend_1', targetPlayerId: defendingPlayerId }],
    });
    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [{ blockerId: 'wall_1', attackerId: 'fiend_1' }],
    });

    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
    expect((game.state as any).blockersDeclaredBy).toContain(defendingPlayerId);
  });
});
