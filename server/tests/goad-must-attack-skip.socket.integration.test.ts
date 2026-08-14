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

function seedDeclareAttackersGame(gameId: string, attackingPlayerId: PlayerID, defendingPlayerId: PlayerID) {
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
  (game.state as any).turn = 5;
  (game.state as any).turnNumber = 5;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [attackingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [defendingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

function createCreature(id: string, controller: PlayerID, extras: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    enteredThisTurn: false,
    counters: {},
    card: {
      id: `${id}-card`,
      name: 'Goaded Beast',
      type_line: 'Creature — Beast',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
    ...extras,
  };
}

describe('goad must attack — skipDeclareAttackers (socket)', () => {
  const gameId = 'test_goad_must_attack_skip';
  const attackerId = 'p1' as PlayerID;
  const defenderId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('rejects skipDeclareAttackers when a goaded creature can attack', async () => {
    const game = seedDeclareAttackersGame(gameId, attackerId, defenderId);
    (game.state as any).battlefield = [
      createCreature('c1', attackerId, { goadedBy: [defenderId], goadedUntil: { [defenderId]: 99 } }),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(attackerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io, socket);

    await handlers['skipDeclareAttackers']({ gameId });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('GOAD_MUST_ATTACK');
    expect(String(err?.payload?.message || '')).toMatch(/must attack/i);
    expect(String((game.state as any).step)).toBe('declareAttackers');
    expect(Array.isArray((game.state as any).attackersDeclaredBy) ? (game.state as any).attackersDeclaredBy : []).not.toContain(attackerId);
  });

  it('rejects declareAttackers with no attackers when a goaded creature can attack', async () => {
    const game = seedDeclareAttackersGame(gameId, attackerId, defenderId);
    (game.state as any).battlefield = [
      createCreature('c1', attackerId, { goadedBy: [defenderId] }),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(attackerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io, socket);

    await handlers['declareAttackers']({ gameId, attackers: [] });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('GOAD_MUST_ATTACK');
    expect(String((game.state as any).step)).toBe('declareAttackers');
  });

  it('allows skipDeclareAttackers when the goaded creature is tapped', async () => {
    const game = seedDeclareAttackersGame(gameId, attackerId, defenderId);
    (game.state as any).battlefield = [
      createCreature('c1', attackerId, { goadedBy: [defenderId], tapped: true }),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(attackerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io, socket);

    await handlers['skipDeclareAttackers']({ gameId });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).not.toBe('GOAD_MUST_ATTACK');
    const skipChat = emitted.find((entry) =>
      entry.event === 'chat' && String(entry.payload?.message || '').includes('no creatures'),
    );
    expect(skipChat).toBeTruthy();
  });
});
