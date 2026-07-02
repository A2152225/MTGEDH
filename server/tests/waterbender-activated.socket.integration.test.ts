import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const WATERBENDER_ORACLE =
  "Whenever a creature you control deals combat damage to a player, put a quest counter on this enchantment. Then if it has four or more quest counters on it, draw a card.\n" +
  "Waterbend {4}: Target creature can't be blocked this turn. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)";

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
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function hasUnblockableThisTurn(perm: any): boolean {
  const temporaryAbilities = Array.isArray(perm?.temporaryAbilities) ? perm.temporaryAbilities : [];
  return temporaryAbilities.some((entry: any) =>
    String(entry?.ability || entry || '').toLowerCase().includes("can't be blocked"));
}

function seedWaterbenderGame(game: any, playerId: string) {
  Object.assign(game.state as any, {
    players: [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }],
    startingLife: 40,
    life: { [playerId]: 40 },
    phase: 'precombat_main',
    step: 'MAIN1',
    turnPlayer: playerId,
    activePlayer: playerId,
    turnNumber: 3,
    priority: playerId,
    stack: [],
    manaPool: {
      [playerId]: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 4, white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    },
    battlefield: [
      {
        id: 'enchant-1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'enchant_card',
          name: 'Waterbender Ascension',
          type_line: 'Enchantment',
          oracle_text: WATERBENDER_ORACLE,
        },
      },
      {
        id: 'bf-target',
        controller: playerId,
        owner: playerId,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ],
    zones: {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    },
  });
}

describe('Waterbender Ascension activated ability socket integration (Layer 3)', () => {
  const gameId = 'test_waterbender_activated_socket';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('activates waterbend, targets a creature, and grants unblockable through stack IR', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);
    seedWaterbenderGame(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'enchant-1',
      abilityId: 'enchant_card-ability-0',
    });

    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(targetStep!.id),
      selections: ['bf-target'],
      cancelled: false,
    });

    expect(((game.state as any).stack || []).length).toBe(1);

    game.resolveTopOfStack();

    const target = ((game.state as any).battlefield || []).find((perm: any) => perm.id === 'bf-target');
    expect(hasUnblockableThisTurn(target)).toBe(true);
    expect(((game.state as any).stack || []).length).toBe(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 15000);
});
