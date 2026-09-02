import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
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

describe('Cultivate Oracle IR battlefield-entry replacements', () => {
  const gameId = 'test_cultivate_oracle_ir_battlefield_entry_replacements';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('completes Cultivate library search and applies battlefield-entry replacements without ReferenceError', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 3,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'forest_a', name: 'Forest', type_line: 'Basic Land ? Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'plains_b', name: 'Plains', type_line: 'Basic Land ? Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        { id: 'spell_c', name: 'Giant Growth', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'growth.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'cultivate_stack_entry_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'cultivate_entry_1',
          name: 'Cultivate',
          type_line: 'Sorcery',
          oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
          mana_cost: '{2}{G}',
        },
        targets: [],
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).filter(
      (entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH,
    ) as any[];
    expect(steps).toHaveLength(1);
    const step = steps[0];
    expect(step.oracleIrChoiceStepJson).toBeTruthy();

    await expect(handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['forest_a', 'plains_b'],
      splitAssignments: {
        toBattlefield: ['forest_a'],
        toHand: ['plains_b'],
      },
    })).resolves.toBeUndefined();

    const liveBattlefield = (game.state as any).battlefield || [];
    const forest = liveBattlefield.find((permanent: any) => permanent?.card?.id === 'forest_a');
    expect(forest).toBeDefined();
    expect(forest.tapped).toBe(true);
    expect(forest.battlefieldEntryReplacement).toMatchObject({
      applied: true,
      eventType: 'battlefield-entry',
      reason: 'battlefield_entry_replacement',
      metadata: {
        controllerId: playerId,
        entersTapped: true,
      },
    });
    expect(((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => card.id)).toEqual(['plains_b']);
  });
});
