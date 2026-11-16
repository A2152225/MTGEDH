import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[], gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

import { dealCombatDamage } from '../src/state/modules/turn.js';

const FORMATION_ORACLE =
  'Rather than the attacking player, you assign the combat damage of each creature attacking you. You can divide that creature\'s combat damage as you choose among any of the creatures blocking it.';

describe('Defensive Formation combat damage assignment (defender routes to DamageAssignmentModal)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_def_form_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  function setup(game: any, p1: string, p2: string, attacker: any, extras: any[]) {
    (game as any).gameId = game.id || game.gameId;
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).startingLife = 40;
    (game.state as any).turnPlayer = p1;
    (game.state as any).battlefield = [attacker, ...extras];
  }

  it('queues a blockers-mode assignment step for the defending player, not the attacker', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const attacker = {
      id: 'ogre_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      blockedBy: ['bear_1', 'wall_1'],
      card: { name: 'Gray Ogre', type_line: 'Creature — Ogre', oracle_text: '', power: '4', toughness: '4' },
    };
    const bear = { id: 'bear_1', controller: p2, owner: p2, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } };
    const wall = { id: 'wall_1', controller: p2, owner: p2, card: { name: 'Wall of Stone', type_line: 'Creature — Wall', power: '0', toughness: '5' } };
    const formation = {
      id: 'form_1',
      controller: p2,
      owner: p2,
      card: { name: 'Defensive Formation', type_line: 'Enchantment', oracle_text: FORMATION_ORACLE },
    };
    setup(game, p1, p2, attacker, [bear, wall, formation]);

    dealCombatDamage(game as any);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.specialCombatDamageMode === 'defensive-formation') as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('combat_damage_assignment');
    expect(step.playerId).toBe(p2);
    expect(step.assignmentMode).toBe('blockers');
    expect(step.requireLethalOrder).toBe(false);
    expect(step.attackerId).toBe('ogre_1');
    expect(step.blockerIds).toEqual(expect.arrayContaining(['bear_1', 'wall_1']));
    expect((game.state as any).life[p2]).toBe(40);
    expect(Number(bear.markedDamage || 0)).toBe(0);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p2, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { shares: [{ target: 'bear_1', amount: 2 }, { target: 'wall_1', amount: 2 }] },
      cancelled: false,
    });
    expect(Number(bear.markedDamage || 0)).toBeGreaterThanOrEqual(2);
    expect(Number(wall.markedDamage || 0)).toBeGreaterThanOrEqual(2);
    expect((game.state as any).life[p2]).toBe(40);
  });

  it('lets the defender assign all of a trampler\'s damage to the blocker (no overflow)', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const attacker = {
      id: 'rhino_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      blockedBy: ['bear_2'],
      card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', oracle_text: 'Trample', power: '4', toughness: '4', keywords: ['trample'] },
    };
    const bear = { id: 'bear_2', controller: p2, owner: p2, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } };
    const formation = {
      id: 'form_2',
      controller: p2,
      owner: p2,
      card: { name: 'Defensive Formation', type_line: 'Enchantment', oracle_text: FORMATION_ORACLE },
    };
    setup(game, p1, p2, attacker, [bear, formation]);
    dealCombatDamage(game as any);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.specialCombatDamageMode === 'defensive-formation') as any;
    expect(step).toBeDefined();
    expect(step.hasTrample).toBe(true);
    expect(step.playerId).toBe(p2);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p2, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { shares: [{ target: 'bear_2', amount: 4 }] },
      cancelled: false,
    });
    expect(Number(bear.markedDamage || 0)).toBeGreaterThanOrEqual(4);
    expect((game.state as any).life[p2]).toBe(40);
  });
});
