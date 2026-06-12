import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

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

describe('Gwenna mana color selection (G1 regression)', () => {
  const gameId = 'test_gwenna_mana_color_selection';
  const playerId = 'p1';
  const gwennaId = 'perm_gwenna';
  const abilityId = `${gwennaId}-ability-0`;

  const gwennaOracle =
    '{T}: Add two mana in any combination of colors. Spend this mana only to cast creature spells or activate abilities of creature sources.\n' +
    'Whenever you cast a creature spell with power 5 or greater, put a +1/+1 counter on Gwenna and untap it.';

  async function resetGame() {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map() },
    } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame();
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'main';
    (game.state as any).step = 'precombat_main';
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: gwennaId,
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'gwenna_card',
          name: 'Gwenna, Eyes of Gaea',
          type_line: 'Legendary Creature — Elf Druid',
          oracle_text: gwennaOracle,
          power: '2',
          toughness: '3',
        },
      },
    ];
  });

  afterEach(async () => {
    await resetGame();
  });

  it('queues distribution mana selection for two mana in any combination', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.activateBattlefieldAbility?.({ gameId, permanentId: gwennaId, abilityId });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('mana_color_selection');
    expect(step.selectionKind).toBe('distribution');
    expect(step.totalAmount).toBe(2);

    const game = ensureGame(gameId)!;
    expect((game.state as any).battlefield.find((p: any) => p.id === gwennaId)?.tapped).toBe(true);
    expect((game.state as any).priority).toBeNull();
  });

  it('rejects a second activation while mana color selection is pending', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.activateBattlefieldAbility?.({ gameId, permanentId: gwennaId, abilityId });

    const game = ensureGame(gameId)!;
    (game.state as any).battlefield.find((p: any) => p.id === gwennaId).tapped = false;

    await handlers.activateBattlefieldAbility?.({ gameId, permanentId: gwennaId, abilityId });

    const errors = emitted.filter((entry) => entry.event === 'error');
    expect(errors.some((entry) => entry.payload?.code === 'RESOLUTION_PENDING')).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);
  });

  it('adds distributed mana and restores priority after completion', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io, socket);
    registerInteractionHandlers(io, socket);

    await handlers.activateBattlefieldAbility?.({ gameId, permanentId: gwennaId, abilityId });

    const step = ResolutionQueueManager.getQueue(gameId).steps[0] as any;

    await handlers.submitResolutionResponse?.({
      gameId,
      stepId: step.id,
      selections: { G: 1, U: 1 },
    });

    const game = ensureGame(gameId)!;
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
    expect((game.state as any).manaPool?.[playerId]?.green).toBe(1);
    expect((game.state as any).manaPool?.[playerId]?.blue).toBe(1);
    expect((game.state as any).priority).toBe(playerId);
  });
});
