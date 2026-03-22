import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
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
    sockets: {
      sockets: new Map(),
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

describe('Commander\'s Sphere generic sacrifice-draw routing (integration)', () => {
  const gameId = 'test_commander_sphere_generic_sacrifice_draw';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('activates the sacrifice-to-draw mode through a generic parsed ability id', async () => {
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'drawn_1', name: 'Drawn Card', type_line: 'Artifact', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'sphere_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'sphere_card_1',
          name: "Commander's Sphere",
          type_line: 'Artifact',
          oracle_text: "{T}: Add one mana of any color in your commander's color identity.\nSacrifice Commander's Sphere: Draw a card.",
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'sphere_1', abilityId: 'sphere_1-ability-1' });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.find((entry: any) => entry.id === 'sphere_1')).toBeUndefined();

    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(graveyard).toHaveLength(1);
    expect(String(graveyard[0]?.name || '')).toBe("Commander's Sphere");

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(0);

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand).toHaveLength(1);
    expect(String(hand[0]?.name || '')).toBe('Drawn Card');
  });
});