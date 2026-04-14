import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
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

describe('activation-cost simple mana auto-tap (integration)', () => {
  const reflectedGameId = 'test_activation_cost_autotap_reflected_simple_sources';
  const multiColorGameId = 'test_activation_cost_autotap_multi_color_simple_source';

  beforeAll(async () => {
    await initDb();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(reflectedGameId);
    ResolutionQueueManager.removeQueue(multiColorGameId);
    games.delete(reflectedGameId as any);
    games.delete(multiColorGameId as any);
  });

  it('uses the full amplified output of simple auto-tapped sources for activation costs', async () => {
    createGameIfNotExists(reflectedGameId, 'commander', 40);
    const game = ensureGame(reflectedGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'tome_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'tome_card_1',
          name: 'Arcane Encyclopedia',
          type_line: 'Artifact',
          oracle_text: '{3}, {T}: Draw a card.',
        },
      },
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'forest_card_1',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      },
      {
        id: 'forest_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'forest_card_2',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '({T}: Add {G}.)',
        },
      },
      {
        id: 'reflection_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'reflection_card_1',
          name: 'Mana Reflection',
          type_line: 'Enchantment',
          oracle_text: 'If you tap a permanent for mana, it produces twice as much of that mana instead.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(reflectedGameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: reflectedGameId,
      permanentId: 'tome_1',
      abilityId: 'tome_1-ability-0',
    });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect(((game.state as any).stack || [])).toHaveLength(1);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'tome_1')?.tapped).toBe(true);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'forest_1')?.tapped).toBe(true);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'forest_2')?.tapped).toBe(true);
    expect((game.state as any).manaPool[playerId]).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 1,
      colorless: 0,
    });
  });

  it('preserves leftover mana from simple all-at-once multi-color sources after paying a generic activation cost', async () => {
    createGameIfNotExists(multiColorGameId, 'commander', 40);
    const game = ensureGame(multiColorGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'tome_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'tome_card_1',
          name: 'Test Tome',
          type_line: 'Artifact',
          oracle_text: '{1}, {T}: Draw a card.',
        },
      },
      {
        id: 'rakdos_carnarium_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'rakdos_carnarium_card_1',
          name: 'Rakdos Carnarium',
          type_line: 'Land',
          oracle_text: 'Rakdos Carnarium enters tapped.\nWhen Rakdos Carnarium enters, return a land you control to its owner\'s hand.\n{T}: Add {B}{R}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(multiColorGameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: multiColorGameId,
      permanentId: 'tome_1',
      abilityId: 'tome_1-ability-0',
    });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect(((game.state as any).stack || [])).toHaveLength(1);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'tome_1')?.tapped).toBe(true);
    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'rakdos_carnarium_1')?.tapped).toBe(true);
    const pool = (game.state as any).manaPool[playerId] || {};
    const remainingMana = Number(pool.white || 0) + Number(pool.blue || 0) + Number(pool.black || 0)
      + Number(pool.red || 0) + Number(pool.green || 0) + Number(pool.colorless || 0);
    expect(remainingMana).toBe(1);
  });
});