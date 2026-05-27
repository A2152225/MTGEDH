import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('miracle prompt resolution', () => {
  const gameId = 'test_miracle_prompt_resolution';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('persists decline responses and clears first-drawn flags', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'miracle_1',
            name: 'Terminus',
            type_line: 'Sorcery',
            oracle_text: 'Put all creatures on the bottom of their owners\' libraries. Miracle {W}',
            mana_cost: '{4}{W}{W}',
            isFirstDrawnThisTurn: true,
            drawnAt: 100,
          },
        ],
        handCount: 1,
        library: [],
        graveyard: [],
        exile: [],
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      sourceId: 'miracle_1',
      sourceName: 'Terminus',
      description: 'Miracle: You may cast Terminus for {W}.',
      mandatory: false,
      options: [
        { id: 'cast_miracle', label: 'Cast for Miracle ({W})' },
        { id: 'decline', label: "Don't cast" },
      ],
      minSelections: 1,
      maxSelections: 1,
      miraclePrompt: true,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
      normalCost: '{4}{W}{W}',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({ gameId, stepId: step.id, selections: ['decline'] });

    const card = (game.state as any).zones[playerId].hand[0] as any;
    expect(card.isFirstDrawnThisTurn).toBeUndefined();
    expect(card.drawnAt).toBeUndefined();

    const event = [...getEvents(gameId)].reverse().find((entry: any) => entry.type === 'miraclePromptResolve') as any;
    expect(event?.payload).toMatchObject({
      playerId,
      sourceId: 'miracle_1',
      sourceName: 'Terminus',
      resolvedStepId: step.id,
      miracleCardId: 'miracle_1',
      miracleCost: '{W}',
      choiceId: 'decline',
      accepted: false,
    });
  });
});