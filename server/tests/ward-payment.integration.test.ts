import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
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

describe('ward mana payment flow', () => {
  const gameId = 'test_ward_mana_payment_flow';
  const casterId = 'p1';
  const defenderId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues mana ward payment without requiring floating mana and allows untapped lands to pay it', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, casterId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: casterId, name: 'Caster', spectator: false, life: 40 },
      { id: defenderId, name: 'Defender', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [casterId]: 40, [defenderId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = casterId;
    (game.state as any).priority = casterId;
    (game.state as any).manaPool = {
      [casterId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [defenderId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mountain_1',
        controller: casterId,
        tapped: false,
        card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' },
      },
      {
        id: 'mountain_2',
        controller: casterId,
        tapped: false,
        card: { name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '{T}: Add {R}.' },
      },
      {
        id: 'ward_creature',
        controller: defenderId,
        tapped: false,
        card: {
          name: 'Shielded Bear',
          type_line: 'Creature — Bear',
          oracle_text: 'Ward {1}',
        },
      },
    ];
    (game.state as any).zones = {
      [casterId]: {
        hand: [
          {
            id: 'bolt_1',
            name: 'Lightning Bolt',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
            image_uris: { small: 'https://example.com/bolt.jpg' },
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

    await handlers['requestCastSpell']({ gameId, cardId: 'bolt_1' });

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['ward_creature'],
    });

    const wardStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).wardPayment === true) as any;
    expect(wardStep).toBeDefined();
    expect(wardStep.wardCost).toBe('{1}');

    const insufficientManaError = emitted.find((event) => event.event === 'error' && event.payload?.code === 'INSUFFICIENT_MANA');
    expect(insufficientManaError).toBeUndefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(wardStep.id),
      selections: {
        payment: [{ permanentId: 'mountain_2', mana: 'R', count: 1 }],
      },
    });

    expect((game.state as any).battlefield.find((entry: any) => entry.id === 'mountain_2')?.tapped).toBe(true);

    const wardPaidChat = emitted.find((event) => event.event === 'chat' && String(event.payload?.message || '').includes('paid ward {1}'));
    expect(wardPaidChat).toBeTruthy();

    const spellPaymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(spellPaymentStep).toBeDefined();
  });

  it('leaves an uncounterable pending spell intact when ward is declined', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, casterId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: casterId, name: 'Caster', spectator: false, life: 40 },
      { id: defenderId, name: 'Defender', spectator: false, life: 40 },
    ];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).priority = casterId;
    (game.state as any).pendingSpellCasts = {
      effect_ward_uncounterable: {
        cardId: 'rending_1',
        cardName: 'Rending Volley',
        playerId: casterId,
        fromZone: 'hand',
        targets: ['ward_creature'],
        card: {
          id: 'rending_1',
          name: 'Rending Volley',
          type_line: 'Instant',
          oracle_text: "Rending Volley can't be countered by spells or abilities. Rending Volley deals 4 damage to target white or blue creature you don't control.",
        },
      },
    };
    (game.state as any).pendingTargets = {
      effect_ward_uncounterable: ['ward_creature'],
    };

    ResolutionQueueManager.addStep(gameId, {
      type: 'mana_payment_choice' as any,
      playerId: casterId as any,
      sourceId: 'effect_ward_uncounterable',
      sourceName: 'Shielded Bear',
      description: 'Shielded Bear has ward {1}. Pay {1} or the spell/ability will be countered.',
      mandatory: false,
      cardName: 'Shielded Bear',
      manaCost: '{1}',
      wardPayment: true,
      wardPaymentType: 'mana',
      wardCost: '{1}',
      wardPermanentId: 'ward_creature',
      wardPermanentName: 'Shielded Bear',
      wardPermanentController: defenderId,
      wardTriggeredBy: 'effect_ward_uncounterable',
    } as any);
    ResolutionQueueManager.addStep(gameId, {
      type: 'mana_payment_choice' as any,
      playerId: casterId as any,
      sourceId: 'rending_1',
      sourceName: 'Rending Volley',
      description: 'Pay costs to cast Rending Volley.',
      mandatory: true,
      cardId: 'rending_1',
      cardName: 'Rending Volley',
      manaCost: '{R}',
      spellPaymentRequired: true,
      effectId: 'effect_ward_uncounterable',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(casterId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);

    const wardStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => (entry as any).wardPayment === true) as any;
    expect(wardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(wardStep.id),
      selections: {},
      cancelled: true,
    });

    expect((game.state as any).pendingSpellCasts?.effect_ward_uncounterable).toBeDefined();

    const spellPaymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((entry: any) => (entry as any).spellPaymentRequired === true && String((entry as any).effectId || '') === 'effect_ward_uncounterable');
    expect(spellPaymentStep).toBeDefined();

    const wardChat = emitted.find((event) => event.event === 'chat' && String(event.payload?.message || '').includes("can't be countered"));
    expect(wardChat).toBeTruthy();
  });
});