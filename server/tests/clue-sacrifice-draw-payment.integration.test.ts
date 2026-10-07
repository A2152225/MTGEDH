import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const gameId = 'test_clue_sacrifice_draw_payment';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
  return { socket, handlers };
}

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { await deleteGame(gameId); } catch { /* fresh db */ }
}

describe('Clue sacrifice-to-draw payment', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
  });

  afterEach(async () => {
    await resetGame();
  });

  it('#34 pays {2} from a mana source, then sacrifices the Clue and draws', async () => {
    await resetGame();
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 1,
        exile: [],
      },
    };
    (game as any).libraries = new Map([
      [p1, [{ id: 'lib_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' }]],
    ]);
    (game.state as any).battlefield = [
      {
        id: 'clue_1',
        controller: p1,
        owner: p1,
        isToken: true,
        tapped: false,
        card: {
          id: 'clue_card',
          name: 'Clue',
          type_line: 'Token Artifact — Clue',
          oracle_text: '{2}, Sacrifice this artifact: Draw a card.',
        },
      },
      {
        id: 'sol_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          id: 'sol_card',
          name: 'Sol Ring',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}{C}.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    const io = createMockIo(emitted);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'clue_1',
      abilityId: 'clue_card-ability-0',
    });

    expect((game.state as any).battlefield.some((p: any) => p.id === 'clue_1')).toBe(true);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.activationPaymentChoice === true) as any;
    expect(step).toBeTruthy();
    expect(step.activationPaymentContext).toBe('sacrifice_draw');
    expect(step.manaCost).toBe('{2}');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: {
        payment: [{ permanentId: 'sol_1', mana: 'C', count: 2, abilityId: 'sol_card-ability-0' }],
      },
    });

    expect(emitted.find((event) => event.event === 'error')).toBeUndefined();
    expect((game.state as any).battlefield.some((p: any) => p.id === 'clue_1')).toBe(false);
    expect((game.state as any).zones[p1].hand.map((card: any) => card.name)).toEqual(['Island']);
  });
});
