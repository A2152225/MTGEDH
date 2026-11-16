import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { dealCombatDamage } from '../src/state/modules/turn.js';

const GIANT_ORACLE = "If Cunning Giant is unblocked, you may have it assign its combat damage to a creature the defending player controls.";
const ORGG_ORACLE = "You may have Butcher Orgg assign its combat damage as though it weren't blocked.\nButcher Orgg can assign its combat damage divided as you choose among the defending player and/or any number of creatures they control.";

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

function setupCombat(game: any, p1: string, p2: string, attacker: any, defenderCreature: any) {
  (game as any).gameId = game.id || game.gameId;
  (game.state as any).players = [
    { id: p1, name: 'P1', life: 40 },
    { id: p2, name: 'P2', life: 40 },
  ];
  (game.state as any).life = { [p1]: 40, [p2]: 40 };
  (game.state as any).startingLife = 40;
  (game.state as any).turnPlayer = p1;
  (game.state as any).battlefield = [attacker, defenderCreature];
}

describe('Cunning Giant / Butcher Orgg combat damage assignment', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_special_cdmg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('lets an unblocked Cunning Giant assign all damage to a defending creature, or cancel to hit the player', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const giant = {
      id: 'giant_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      blockedBy: [],
      card: { name: 'Cunning Giant', type_line: 'Creature — Giant', oracle_text: GIANT_ORACLE, power: '4', toughness: '5' },
    };
    const bear = {
      id: 'bear_1',
      controller: p2,
      owner: p2,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    setupCombat(game, p1, p2, giant, bear);

    dealCombatDamage(game as any);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.specialCombatDamageMode === 'redirect-unblocked') as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('target_selection');
    expect(step.mandatory).toBe(false);
    expect((game.state as any).life[p2]).toBe(40);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['bear_1'], cancelled: false });
    expect(Number(bear.markedDamage || 0)).toBeGreaterThanOrEqual(4);
    expect((game.state as any).life[p2]).toBe(40);
  });

  it('assigns unblocked Cunning Giant damage to the defending player when the choice is declined', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const giant = {
      id: 'giant_2',
      controller: p1,
      owner: p1,
      attacking: p2,
      blockedBy: [],
      card: { name: 'Cunning Giant', type_line: 'Creature — Giant', oracle_text: GIANT_ORACLE, power: '4', toughness: '5' },
    };
    const bear = {
      id: 'bear_2',
      controller: p2,
      owner: p2,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    setupCombat(game, p1, p2, giant, bear);
    dealCombatDamage(game as any);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.specialCombatDamageMode === 'redirect-unblocked') as any;
    expect(step).toBeDefined();
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [], cancelled: true });
    expect((game.state as any).life[p2]).toBe(36);
    expect(Number(bear.markedDamage || 0)).toBe(0);
  });

  it('lets Butcher Orgg divide combat damage among the defending player and their creatures', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1'; const p2 = 'p2';
    const orgg = {
      id: 'orgg_1',
      controller: p1,
      owner: p1,
      attacking: p2,
      blockedBy: [],
      card: { name: 'Butcher Orgg', type_line: 'Creature — Orgg', oracle_text: ORGG_ORACLE, power: '6', toughness: '6' },
    };
    const bear = {
      id: 'bear_3',
      controller: p2,
      owner: p2,
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
    };
    setupCombat(game, p1, p2, orgg, bear);
    dealCombatDamage(game as any);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.specialCombatDamageMode === 'divide') as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('combat_damage_assignment');
    expect(step.assignmentMode).toBe('free-division');
    expect(Array.isArray(step.recipients)).toBe(true);
    expect(step.recipients.some((r: any) => r.id === `player:${p2}` && r.type === 'player')).toBe(true);
    expect(step.recipients.some((r: any) => r.id === 'bear_3' && r.type === 'creature')).toBe(true);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: step.id,
      selections: { shares: [{ target: `player:${p2}`, amount: 4 }, { target: 'bear_3', amount: 2 }] },
      cancelled: false,
    });
    expect((game.state as any).life[p2]).toBe(36);
    expect(Number(bear.markedDamage || 0)).toBeGreaterThanOrEqual(2);
  });
});
