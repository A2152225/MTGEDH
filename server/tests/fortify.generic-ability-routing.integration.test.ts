import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
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

describe('Fortify generic ability routing (integration)', () => {
  const gameId = 'test_fortify_generic_activation';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('activates fortify through the parser-emitted id and attaches to a land on resolution', async () => {
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
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
    };
    (game.state as any).battlefield = [
      {
        id: 'fort_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'fort_card_1',
          name: 'Darksteel Garrison',
          type_line: 'Artifact - Fortification',
          oracle_text: 'Fortified land has indestructible.\nFortify {3}',
        },
      },
      {
        id: 'land_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'land_card_1',
          name: 'Plains',
          type_line: 'Basic Land - Plains',
          oracle_text: '{T}: Add {W}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'fort_1', abilityId: 'fort_card_1-fortify-0' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.abilityType).toBe('fortify');
    expect(step.validTargets).toHaveLength(1);
    expect(step.validTargets[0]?.id).toBe('land_1');

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['land_1'] });

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]?.abilityType).toBe('fortify');
    expect(stack[0]?.fortifyParams?.targetLandId).toBe('land_1');

    game.resolveTopOfStack();

    const fortification = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'fort_1');
    const land = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'land_1');
    expect(fortification?.attachedTo).toBe('land_1');
    expect(land?.attachedEquipment).toContain('fort_1');
    expect((game.state as any).manaPool?.[playerId]?.colorless).toBe(0);
  });
});