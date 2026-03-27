import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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
    data: { playerId, gameId, spectator: false },
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

function setupCastingGame(gameId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
    p2: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };

  return game;
}

describe('cast spell trigger persistence (integration)', () => {
  const merrowGameId = 'test_spell_cast_trigger_persistence_merrow';
  const rhysticGameId = 'test_spell_cast_trigger_persistence_rhystic';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    for (const gameId of [merrowGameId, rhysticGameId]) {
      ResolutionQueueManager.removeQueue(gameId);
      games.delete(gameId as any);
    }
  });

  it('persists targeted spell-cast triggers as pushTriggeredAbility events', async () => {
    const game = setupCastingGame(merrowGameId);
    (game.state as any).battlefield = [
      {
        id: 'reejerey_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'reejerey_card',
          name: 'Merrow Reejerey',
          type_line: 'Creature — Merfolk Soldier',
          oracle_text: 'Whenever you cast a Merfolk spell, you may tap or untap target permanent.',
        },
      },
      {
        id: 'target_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'target_perm_card',
          name: 'Test Relic',
          type_line: 'Artifact',
          oracle_text: '',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [
      {
        id: 'merfolk_spell_1',
        name: 'Judge of Currents',
        mana_cost: '{0}',
        manaCost: '{0}',
        type_line: 'Creature — Merfolk Wizard',
        oracle_text: 'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
      },
    ];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', merrowGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: merrowGameId,
      cardId: 'merfolk_spell_1',
      targets: [],
    });

    const triggerPushEvents = getEvents(merrowGameId).filter((event) => String(event?.type) === 'pushTriggeredAbility');
    expect(triggerPushEvents.length).toBeGreaterThan(0);

    const merrowTriggerEvent = triggerPushEvents.find(
      (event: any) => String(event?.payload?.sourceName || '') === 'Merrow Reejerey'
    ) as any;
    expect(merrowTriggerEvent).toBeDefined();
    expect(merrowTriggerEvent.payload).toMatchObject({
      sourceName: 'Merrow Reejerey',
      triggerType: 'cast_creature_type',
      mandatory: false,
      requiresTarget: true,
      targetType: 'permanent',
    });

    const persistedTrigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Merrow Reejerey'
    );
    expect(persistedTrigger).toMatchObject({
      requiresTarget: true,
      targetType: 'permanent',
    });
  });

  it('persists opponent spell-cast triggers as pushTriggeredAbility events', async () => {
    const game = setupCastingGame(rhysticGameId);
    (game.state as any).battlefield = [
      {
        id: 'rhystic_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'rhystic_card',
          name: 'Rhystic Study',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [
      {
        id: 'noncreature_spell_1',
        name: 'Test Insight',
        mana_cost: '{0}',
        manaCost: '{0}',
        type_line: 'Sorcery',
        oracle_text: 'Draw a card.',
      },
    ];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', rhysticGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId: rhysticGameId,
      cardId: 'noncreature_spell_1',
      targets: [],
    });

    const triggerPushEvents = getEvents(rhysticGameId).filter((event) => String(event?.type) === 'pushTriggeredAbility');
    expect(triggerPushEvents.length).toBeGreaterThan(0);

    const rhysticTriggerEvent = triggerPushEvents.find(
      (event: any) => String(event?.payload?.sourceName || '') === 'Rhystic Study'
    ) as any;
    expect(rhysticTriggerEvent).toBeDefined();
    expect(rhysticTriggerEvent.payload).toMatchObject({
      sourceName: 'Rhystic Study',
      triggerType: 'rhystic_study',
      targetPlayer: 'p1',
      triggeringPlayer: 'p1',
      effectData: {
        casterId: 'p1',
      },
    });

    const persistedTrigger = ((game.state as any).stack || []).find(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Rhystic Study'
    );
    expect(persistedTrigger).toMatchObject({
      targetPlayer: 'p1',
      triggeringPlayer: 'p1',
      effectData: expect.objectContaining({
        casterId: 'p1',
      }),
    });
  });
});