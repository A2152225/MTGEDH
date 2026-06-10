import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
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
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('ward during pending spell cast targeting', () => {
  const gameId = 'test_ward_spell_cast_pending';
  const casterId = 'p1';
  const defenderId = 'p2';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues ward payment for a pending spell cast even when stack is uninitialized', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, casterId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: casterId, name: 'Caster', spectator: false, life: 40 },
      { id: defenderId, name: 'Defender', spectator: false, life: 40 },
    ];
    delete (game.state as any).stack;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = casterId;
    (game.state as any).priority = casterId;
    (game.state as any).battlefield = [
      {
        id: 'thassa_1',
        controller: defenderId,
        tapped: false,
        card: {
          name: 'Thassa, Deep-Dwelling',
          type_line: 'Legendary Enchantment Creature — God',
          oracle_text: 'Indestructible\nWard {3}\nAt the beginning of your end step, exile up to one other target creature you control, then return it to the battlefield under its owner\'s control.',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'exile_spell_1',
            name: 'Exile Target Permanent',
            mana_cost: '{2}{U}',
            manaCost: '{2}{U}',
            type_line: 'Instant',
            oracle_text: 'Exile target permanent.',
            image_uris: { small: 'https://example.com/exile.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [defenderId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'exile_spell_1' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'target_selection',
    ) as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['thassa_1'],
    });

    const wardStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && (entry as any).wardPayment === true,
    ) as any;
    expect(wardStep).toBeDefined();
    expect(wardStep.wardCost).toBe('{3}');
    expect(String(wardStep.wardTriggeredBy || '')).toBe(String(targetStep.sourceId || ''));

    const pendingCastKey = String(targetStep.sourceId || '');
    expect((game.state as any).pendingSpellCasts?.[pendingCastKey]).toBeDefined();
  });

  it('declining ward counters the pending spell and leaves the ward creature on the battlefield', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, casterId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: casterId, name: 'Caster', spectator: false, life: 40 },
      { id: defenderId, name: 'Defender', spectator: false, life: 40 },
    ];
    (game.state as any).stack = [];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = casterId;
    (game.state as any).priority = casterId;
    (game.state as any).battlefield = [
      {
        id: 'thassa_1',
        controller: defenderId,
        tapped: false,
        card: {
          name: 'Thassa, Deep-Dwelling',
          type_line: 'Legendary Enchantment Creature — God',
          oracle_text: 'Ward {3}',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'exile_spell_1',
            name: 'Exile Target Permanent',
            mana_cost: '{2}{U}',
            manaCost: '{2}{U}',
            type_line: 'Instant',
            oracle_text: 'Exile target permanent.',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
      [defenderId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId, cardId: 'exile_spell_1' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'target_selection',
    ) as any;

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['thassa_1'],
    });

    const wardStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && (entry as any).wardPayment === true,
    ) as any;
    expect(wardStep).toBeDefined();

    const pendingCastKey = String(wardStep.wardTriggeredBy || targetStep.sourceId || '');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(wardStep.id),
      cancelled: true,
      selections: { payment: [] },
    });

    expect((game.state as any).pendingSpellCasts?.[pendingCastKey]).toBeUndefined();
    expect((game.state as any).battlefield.some((entry: any) => entry.id === 'thassa_1')).toBe(true);
    expect((game.state as any).zones?.[defenderId]?.exile?.length || 0).toBe(0);

    const spellPaymentStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true,
    );
    expect(spellPaymentStep).toBeUndefined();
  });
});
