import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27.
const NORNS_ANNEX_ORACLE =
  "({W/P} can be paid with either {W} or 2 life.)\nCreatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
  } as any;
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('phyrexian attack cost payment via Resolution Queue (integration)', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `test_attack_cost_phyrexian_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  function seedAnnexGame(game: any, extras: Record<string, unknown> = {}) {
    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [p2]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: p1,
        owner: p1,
        tapped: false,
        summoningSickness: false,
        card: {
          name: 'Silvercoat Lion',
          type_line: 'Creature — Cat',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'annex_1',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          name: 'White Gate',
          type_line: 'Artifact',
          oracle_text: NORNS_ANNEX_ORACLE,
        },
      },
      ...((extras.battlefield as any[]) || []),
    ];
    return { p1, p2 };
  }

  it('prompts for {W/P} and attacks after paying white from a Plains', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const { p1, p2 } = seedAnnexGame(game);
    (game.state as any).battlefield.push({
      id: 'plains_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '{T}: Add {W}.' },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: p2 }],
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.attackCostPayment === true) as any;
    expect(step).toBeDefined();
    expect(step.attackCostAmount).toBe(0);
    expect(step.attackCostPhyrexianItems).toHaveLength(1);
    expect(step.attackCostPhyrexianItems[0].symbol).toBe('W');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: {
        optionId: 'pay_attack_cost',
        phyrexianChoices: [{ index: 0, payWithLife: false }],
      },
    });

    const attacker = (game.state as any).battlefield.find((perm: any) => perm.id === 'attacker_1');
    expect(attacker?.tapped).toBe(true);
    expect(attacker?.attacking).toBe(p2);
    expect((game.state as any).battlefield.find((perm: any) => perm.id === 'plains_1')?.tapped).toBe(true);
    expect(Number((game.state as any).life[p1])).toBe(40);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => entry?.attackCostPayment === true)).toBe(false);
  });

  it('pays {W/P} with 2 life when no white mana is available', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const { p1, p2 } = seedAnnexGame(game);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: p2 }],
    });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((entry: any) => entry?.attackCostPayment === true) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: {
        optionId: 'pay_attack_cost',
        phyrexianChoices: [{ index: 0, payWithLife: true }],
      },
    });

    const attacker = (game.state as any).battlefield.find((perm: any) => perm.id === 'attacker_1');
    expect(attacker?.tapped).toBe(true);
    expect(attacker?.attacking).toBe(p2);
    expect(Number((game.state as any).life[p1])).toBe(38);
    expect((game.state as any).players.find((player: any) => player.id === p1)?.life).toBe(38);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => entry?.attackCostPayment === true)).toBe(false);
  });
});
