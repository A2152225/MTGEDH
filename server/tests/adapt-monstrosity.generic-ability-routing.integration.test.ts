import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
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

describe('Adapt and monstrosity generic ability routing (integration)', () => {
  beforeAll(async () => {
    await initDb();
    await new Promise(resolve => setTimeout(resolve, 0));
    createNoopIo();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue('test_adapt_generic_activation');
    ResolutionQueueManager.removeQueue('test_monstrosity_generic_activation');
    games.delete('test_adapt_generic_activation' as any);
    games.delete('test_monstrosity_generic_activation' as any);
  });

  it('activates adapt through the parser-emitted generic id', async () => {
    const gameId = 'test_adapt_generic_activation';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'adapt_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'adapt_card_1',
          name: 'Adapt Creature',
          type_line: 'Creature - Mutant',
          oracle_text: '{1}{G}: Adapt 2',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'adapt_1', abilityId: 'adapt_card_1-adapt-0' });

    const permanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'adapt_1');
    expect(permanent?.counters?.['+1/+1']).toBe(2);
    expect((game.state as any).manaPool?.[playerId]?.green).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);
  });

  it('activates monstrosity through the parser-emitted generic id', async () => {
    const gameId = 'test_monstrosity_generic_activation';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 5 },
    };
    (game.state as any).battlefield = [
      {
        id: 'monster_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'monster_card_1',
          name: 'Monstrous Creature',
          type_line: 'Creature - Beast',
          oracle_text: '{5}{G}{G}: Monstrosity 3',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'monster_1', abilityId: 'monster_card_1-monstrosity-0' });

    const permanent = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'monster_1');
    expect(permanent?.counters?.['+1/+1']).toBe(3);
    expect(permanent?.isMonstrous).toBe(true);
    expect(permanent?.monstrous).toBe(true);
    expect((game.state as any).manaPool?.[playerId]?.green).toBe(0);
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);
  });
});