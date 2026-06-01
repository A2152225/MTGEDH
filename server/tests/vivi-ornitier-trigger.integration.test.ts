import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
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

describe('Vivi Ornitier generic noncreature cast triggers (integration)', () => {
  const gameId = 'test_vivi_ornitier';
  const trackedGameIds = new Set<string>();

  function trackGameId(trackedGameId: string) {
    trackedGameIds.add(trackedGameId);
    ResolutionQueueManager.removeQueue(trackedGameId);
    games.delete(trackedGameId as any);
    return trackedGameId;
;  }

  async function resetTrackedGames() {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
    trackedGameIds.clear();
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    trackedGameIds.clear();
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetTrackedGames();
    await resetGame(gameId);
  });

  it('triggers Vivi Ornitier on cast of noncreature spell, and resolves counter + opponent damage', async () => {
    const persistentGameId = trackGameId(`${gameId}_noncreature`);
    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    // Put Vivi Ornitier on the battlefield
    (game.state as any).battlefield = [
      {
        id: 'vivi_perm_id',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'vivi_card_id',
          name: 'Vivi Ornitier',
          type_line: 'Legendary Creature — Wizard',
          oracle_text: '{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier\'s power. Activate only during your turn and only once each turn.\nWhenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'sol_ring_id',
            name: 'Sol Ring',
            type_line: 'Artifact',
            oracle_text: '{T}: Add {C}{C}.',
            mana_cost: '{1}',
          }
        ],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).stack = [];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, persistentGameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    // Act: Cast a noncreature spell (Sol Ring)
    await handlers['castSpellFromHand']({ gameId: persistentGameId, cardId: 'sol_ring_id' });

    const stack = (game.state as any).stack || [];
    // Sol Ring and Vivi's trigger should be on stack
    expect(stack).toHaveLength(2);

    const trigger = stack.find((item: any) => item.type === 'triggered_ability');
    expect(trigger).toBeDefined();
    expect(trigger.sourceName).toBe('Vivi Ornitier');
    expect(trigger.description).toContain('deals 1 damage to each opponent');

    // Resolve Vivi's cast trigger
    game.resolveTopOfStack();

    // Verify trigger effects:
    // 1. Vivi Ornitier has a +1/+1 counter
    const vivi = (game.state as any).battlefield?.find((p: any) => p.id === 'vivi_perm_id');
    expect(vivi).toBeDefined();
    expect(vivi.counters).toBeDefined();
    expect(vivi.counters['+1/+1']).toBe(1);

    // 2. Opponent (P2) has lost 1 life
    expect((game.state as any).life[p2]).toBe(39);
    expect((game.state as any).life[p1]).toBe(40);

    // Verify stack has only the cast Sol Ring remaining
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0].card.name).toBe('Sol Ring');
  });
});
