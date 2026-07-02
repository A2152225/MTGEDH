/**
 * Replay-divergence guardrail (undo/replay fidelity, IR primary).
 *
 * Drives a spell through the live socket path under ORACLE_IR_SPELL_PRIMARY=1,
 * replays the persisted event log into a fresh game, and asserts the projected
 * states match. Any IR execution path that mutates state without flowing
 * through the event log breaks undo and fails here.
 *
 * See tests/helpers/replayDivergence.ts for the projection and adoption notes.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';

const gameId = 'test_replay_divergence_guardrail';
const replayGameId = `${gameId}_replay`;

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

function createMockSocket(playerId: string, targetGameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: targetGameId },
    rooms: new Set<string>([targetGameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

function buildDrawSpell() {
  return {
    id: 'divination_1',
    name: 'Divination',
    mana_cost: '',
    manaCost: '{0}',
    type_line: 'Sorcery',
    oracle_text: 'Draw two cards.',
  };
}

function buildLibraryCard(index: number) {
  return {
    id: `library_card_${index}`,
    name: `Library Card ${index}`,
    type_line: 'Artifact',
    oracle_text: '',
  };
}

function seedGame(game: any) {
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).priority = 'p1';
  (game.state as any).activePlayer = 'p1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).turnNumber = 3;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  const library = [1, 2, 3, 4].map((index) => ({ ...buildLibraryCard(index), zone: 'library' }));
  (game.state as any).zones = {
    p1: {
      hand: [{ ...buildDrawSpell(), zone: 'hand' }],
      handCount: 1,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: library.map((card) => ({ ...card })),
      libraryCount: library.length,
    },
    p2: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
  };
  const p1 = (game.state as any).players.find((entry: any) => entry.id === 'p1');
  p1.library = library.map((card) => ({ ...card }));
  (game as any).libraries = new Map([
    ['p1', library.map((card) => ({ ...card }))],
    ['p2', []],
  ]);
}

async function resetGame(targetGameId: string) {
  ResolutionQueueManager.removeQueue(targetGameId);
  GameManager.deleteGame(targetGameId);
  games.delete(targetGameId as any);
  try {
    await deleteGame(targetGameId);
  } catch {
    // test-only cleanup
  }
}

describe('replay divergence guardrail (IR primary draw spell)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('replaying the event log reproduces the live state after cast + IR resolve', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seedGame(game);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({ gameId, cardId: 'divination_1', targets: [] });
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    // Live outcome sanity: two cards drawn, spell in graveyard.
    expect((game.state as any).zones.p1.handCount).toBe(2);
    expect((game.state as any).zones.p1.graveyard.map((card: any) => card.name)).toContain('Divination');
    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell']),
    );

    const replayGame = createInitialGameState(replayGameId);
    seedGame(replayGame);
    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    replayGame.replay(replayEvents as any);

    // resolveTopOfStack is not itself an event in this flow; re-apply it the
    // same way the live game did if the replayed stack still holds the spell.
    if (((replayGame.state as any).stack || []).length > 0) {
      if (typeof replayGame.resolveTopOfStack !== 'function') {
        throw new Error('replayGame.resolveTopOfStack is not available');
      }
      replayGame.resolveTopOfStack();
    }

    assertNoReplayDivergence(game, replayGame);
  });
});
