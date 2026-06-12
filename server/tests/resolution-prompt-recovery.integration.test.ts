import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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

describe('resolution prompt recovery', () => {
  const gameId = 'test_resolution_prompt_recovery';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => {} }),
      emit: () => {},
      sockets: { sockets: new Map() },
    } as any);
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('re-emits the next pending step when the client requests getMyNextResolutionStep', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: null,
      players: [{ id: 'p1', name: 'P1', spectator: false, life: 40 }],
      zones: { p1: { hand: [], library: [], graveyard: [], exile: [] } },
      battlefield: [],
      stack: [],
    });

    ResolutionQueueManager.addStep(gameId, {
      id: 'step_mana_color_1',
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose mana colors',
      mandatory: true,
      selectionKind: 'distribution',
      totalAmount: 2,
      availableColors: ['W', 'U', 'B', 'R', 'G'],
      cardName: 'Gwenna, Eyes of Gaea',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const handlers: Record<string, Function> = {};
    const socket = {
      data: { playerId: 'p1', spectator: false, gameId },
      rooms: new Set([gameId]),
      on: (event: string, handler: Function) => {
        handlers[event] = handler;
      },
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
    } as any;

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['getMyNextResolutionStep']?.({ gameId });

    const prompt = emitted.find((entry) => entry.event === 'resolutionStepPrompt');
    expect(prompt?.payload?.step?.id).toBe('step_mana_color_1');
    expect(prompt?.payload?.step?.type).toBe('mana_color_selection');
  });
});
