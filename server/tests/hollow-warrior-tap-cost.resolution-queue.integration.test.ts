import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const HW_ORACLE =
  "This creature can't attack or block unless you tap an untapped creature you control not declared as an attacking or blocking creature this combat.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return { to: () => ({ emit: () => undefined }), emit: () => undefined } as any;
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[]) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

function baseGame(game: any, p1: string, p2: string) {
  (game.state as any).players = [{ id: p1, name: 'P1', life: 40 }, { id: p2, name: 'P2', life: 40 }];
  (game.state as any).turnPlayer = p1;
  (game.state as any).step = 'declareAttackers';
  (game.state as any).manaPool = { [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }, [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 } };
  (game.state as any).zones = { [p1]: { hand: [], graveyard: [], exile: [], handCount: 0 }, [p2]: { hand: [], graveyard: [], exile: [], handCount: 0 } };
}

describe('Hollow Warrior tap-creature attack cost (integration)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_hw_tap_cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((r) => setTimeout(r, 0));
  });

  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('prompts to tap a creature for Hollow Warrior and attacks after paying', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1'; const p2 = 'p2';
    baseGame(game, p1, p2);
    (game.state as any).battlefield = [
      { id: 'hw_1', controller: p1, owner: p1, tapped: false, summoningSickness: false, card: { name: 'Hollow Warrior', type_line: 'Artifact Creature \u2014 Golem Warrior', oracle_text: HW_ORACLE, power: '4', toughness: '4' } },
      { id: 'bear_1', controller: p1, owner: p1, tapped: false, summoningSickness: false, card: { name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2' } },
      { id: 'enemy_1', controller: p2, owner: p2, tapped: false, card: { name: 'Goblin', type_line: 'Creature \u2014 Goblin', oracle_text: '', power: '1', toughness: '1' } },
    ];
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerCombatHandlers(io, socket);
    await handlers['declareAttackers']({ gameId, attackers: [{ creatureId: 'hw_1', targetPlayerId: p2 }] });
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.attackCostPermanentPayment === true) as any;
    expect(step).toBeDefined();
    expect(step.permanentCostKind).toBe('tap');
    expect(step.minTargets).toBe(1);
    expect(step.validTargets.map((t: any) => t.id)).toEqual(['bear_1']);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['bear_1'], cancelled: false });
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.attackCostPermanentPayment === true)).toBe(false);
    const hw = (game.state as any).battlefield.find((p: any) => p.id === 'hw_1');
    const bear = (game.state as any).battlefield.find((p: any) => p.id === 'bear_1');
    expect(hw?.attacking).toBeTruthy();
    expect(bear?.tapped).toBe(true);
  });

  it('decline removes Hollow Warrior but lets another attacker through', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1'; const p2 = 'p2';
    baseGame(game, p1, p2);
    (game.state as any).battlefield = [
      { id: 'hw_1', controller: p1, owner: p1, tapped: false, summoningSickness: false, card: { name: 'Hollow Warrior', type_line: 'Artifact Creature \u2014 Golem Warrior', oracle_text: HW_ORACLE, power: '4', toughness: '4' } },
      { id: 'lion_1', controller: p1, owner: p1, tapped: false, summoningSickness: false, card: { name: 'Silvercoat Lion', type_line: 'Creature \u2014 Cat', oracle_text: '', power: '2', toughness: '2', colors: ['W'] } },
      { id: 'bear_1', controller: p1, owner: p1, tapped: false, summoningSickness: false, card: { name: 'Grizzly Bears', type_line: 'Creature \u2014 Bear', oracle_text: '', power: '2', toughness: '2' } },
    ];
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerCombatHandlers(io, socket);
    await handlers['declareAttackers']({
      gameId,
      attackers: [
        { creatureId: 'hw_1', targetPlayerId: p2 },
        { creatureId: 'lion_1', targetPlayerId: p2 },
      ],
    });
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.attackCostPermanentPayment === true) as any;
    expect(step).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: [], cancelled: true });
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.attackCostPermanentPayment === true)).toBe(false);
    const hw = (game.state as any).battlefield.find((p: any) => p.id === 'hw_1');
    const lion = (game.state as any).battlefield.find((p: any) => p.id === 'lion_1');
    const bear = (game.state as any).battlefield.find((p: any) => p.id === 'bear_1');
    expect(hw?.attacking).toBeFalsy();
    expect(lion?.attacking).toBeTruthy();
    expect(bear?.tapped).toBe(false);
  });

  it('no eligible creature auto-removes Hollow Warrior and continues', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1'; const p2 = 'p2';
    baseGame(game, p1, p2);
    (game.state as any).battlefield = [
      { id: 'hw_1', controller: p1, owner: p1, tapped: false, summoningSickness: false, card: { name: 'Hollow Warrior', type_line: 'Artifact Creature \u2014 Golem Warrior', oracle_text: HW_ORACLE, power: '4', toughness: '4' } },
      { id: 'lion_1', controller: p1, owner: p1, tapped: false, summoningSickness: false, card: { name: 'Silvercoat Lion', type_line: 'Creature \u2014 Cat', oracle_text: '', power: '2', toughness: '2', colors: ['W'] } },
    ];
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId); (socket.data as any).gameId = gameId;
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io, socket);
    registerCombatHandlers(io, socket);
    await handlers['declareAttackers']({
      gameId,
      attackers: [
        { creatureId: 'hw_1', targetPlayerId: p2 },
        { creatureId: 'lion_1', targetPlayerId: p2 },
      ],
    });
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.attackCostPermanentPayment === true)).toBe(false);
    const hw = (game.state as any).battlefield.find((p: any) => p.id === 'hw_1');
    const lion = (game.state as any).battlefield.find((p: any) => p.id === 'lion_1');
    expect(hw?.attacking).toBeFalsy();
    expect(lion?.attacking).toBeTruthy();
  });
});
