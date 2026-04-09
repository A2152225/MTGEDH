import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
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

describe('Spree requestCastSpell prompt persistence', () => {
  const gameId = 'test_spree_request_cast_prompt_persistence';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('persists the initial spree mode-selection prompt before any modes are chosen', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'spree_spell_1',
            name: 'Spree Test Spell',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Sorcery',
            oracle_text: 'Spree\n+ {1} - Deal 1 damage to any target.\n+ {R} - Draw a card.',
            image_uris: { small: 'https://example.com/spree-test.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerGameActions(createNoopIo() as any, socket as any);

    await handlers.requestCastSpell({ gameId, cardId: 'spree_spell_1' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    const modeStep = queue.steps.find((step: any) => step.type === 'mode_selection') as any;
    expect(modeStep).toBeDefined();
    expect(modeStep.modeSelectionPurpose).toBe('spree');
    expect((modeStep.modes || []).map((mode: any) => mode.id)).toEqual(['spree_0', 'spree_1']);

    const queuedCastEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('spree_spell_1');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mode_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.modeSelectionPurpose).toBe('spree');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.sourceId).toBe('spree_spell_1');
  });
});