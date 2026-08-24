import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
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

describe('Counterspell target prompt metadata (integration)', () => {
  const gameId = 'test_counterspell_target_prompt_metadata';
  const p1 = 'p1';
  const p2 = 'p2';
  const trackedGameIds = new Set<string>();

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
    trackedGameIds.clear();
  });

  it('shows the target spell name and image instead of the raw stack id', async () => {
    const testGameId = `${gameId}_${Math.random().toString(36).slice(2, 10)}`;
    trackedGameIds.add(testGameId);
    createGameIfNotExists(testGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(testGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).priority = p1;
    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'counterspell_1',
            name: 'Counterspell',
            mana_cost: '{U}{U}',
            manaCost: '{U}{U}',
            type_line: 'Instant',
            oracle_text: 'Counter target spell.',
            image_uris: { small: 'https://example.com/counterspell.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game.state as any).stack = [
      {
        id: 'stack_spell_1',
        type: 'spell',
        controller: p2,
        card: {
          name: 'Lightning Bolt',
          type_line: 'Instant',
          image_uris: { small: 'https://example.com/lightning-bolt.jpg' },
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, testGameId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId: testGameId, cardId: 'counterspell_1' });

    const prompt = emitted.find((event) => event.event === 'resolutionStepPrompt');
    expect(prompt?.payload?.step?.type).toBe('target_selection');

    const stackTarget = (prompt?.payload?.step?.validTargets || [])[0];
    expect(stackTarget?.id).toBe('stack_spell_1');
    expect(stackTarget?.label).toBe('Lightning Bolt');
    expect(stackTarget?.imageUrl).toBe('https://example.com/lightning-bolt.jpg');
    // Newer target list types stack objects as `stack` (not a battlefield `card`).
    expect(stackTarget?.type).toBe('stack');
    expect(stackTarget?.description).toBe('stack');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('counterspell_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('counterspell_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('target_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.spellCastContext?.cardId).toBe('counterspell_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.validTargets?.[0]?.id).toBe('stack_spell_1');
  });
});