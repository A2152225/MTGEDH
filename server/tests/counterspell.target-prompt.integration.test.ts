import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
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

describe('Counterspell target prompt metadata (integration)', () => {
  const gameId = 'test_counterspell_target_prompt_metadata';
  const p1 = 'p1';
  const p2 = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('shows the target spell name and image instead of the raw stack id', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).phase = 'main1';
    (game.state as any).priority = p1;
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
    const { socket, handlers } = createMockSocket(p1, gameId, emitted);
    const io = createNoopIo();

    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'counterspell_1' });

    const prompt = emitted.find((event) => event.event === 'resolutionStepPrompt');
    expect(prompt?.payload?.step?.type).toBe('target_selection');

    const stackTarget = (prompt?.payload?.step?.validTargets || [])[0];
    expect(stackTarget?.id).toBe('stack_spell_1');
    expect(stackTarget?.label).toBe('Lightning Bolt');
    expect(stackTarget?.imageUrl).toBe('https://example.com/lightning-bolt.jpg');
    expect(stackTarget?.type).toBe('card');
    expect(stackTarget?.description).toBe('stack');
  });
});