import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { triggerAbilityActivatedTriggers } from '../src/state/modules/triggers/ability-activated.js';
import { games } from '../src/socket/socket.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => {
      handlers[event] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('Vazi, Keen Negotiator ability-activated trigger', () => {
  const gameId = 'test_vazi_keen_negotiator_ability_trigger';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues target selection and resolves counter-plus-draw when an opponent used Treasure mana on an activated ability', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game as any).gameId = gameId;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'vazi_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'vazi_card_1',
          name: 'Vazi, Keen Negotiator',
          type_line: 'Legendary Creature — Human Advisor',
          oracle_text:
            "Haste\n{T}: Target opponent creates X Treasure tokens, where X is the number of Treasure tokens you created this turn.\nWhenever an opponent casts a spell or activates an ability, if mana from a Treasure was spent to cast it or activate it, put a +1/+1 counter on target creature, then draw a card.",
        },
      },
      {
        id: 'artifact_1',
        controller: p2,
        owner: p2,
        card: {
          id: 'artifact_card_1',
          name: 'Treasure-Fueled Device',
          type_line: 'Artifact',
        },
      },
      {
        id: 'target_creature',
        controller: p1,
        owner: p1,
        card: {
          id: 'target_creature_card',
          name: 'Target Creature',
          type_line: 'Creature — Test',
          power: '2',
          toughness: '2',
        },
        counters: {},
      },
    ];
    (game.state as any).stack = [
      {
        id: 'ability_stack_1',
        type: 'ability',
        controller: p2,
        source: 'artifact_1',
        sourceName: 'Treasure-Fueled Device',
        description: '{2}: Do a thing.',
        manaFromTreasureSpentKnown: true,
        manaFromTreasureSpent: true,
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).pendingDraws = {};

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const triggers = triggerAbilityActivatedTriggers(game as any, {
      activatedBy: p2,
      sourcePermanentId: 'artifact_1',
      isManaAbility: false,
      abilityText: '{2}: Do a thing.',
      stackItemId: 'ability_stack_1',
    });

    expect(triggers).toHaveLength(1);
    expect((triggers[0] as any).sourceName).toBe('Vazi, Keen Negotiator');
    expect((triggers[0] as any).requiresTarget).toBe(true);
    expect((triggers[0] as any).targetType).toBe('creature');

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any).targetedTriggeredAbility).toBe(true);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => target.id)).toEqual(['vazi_1', 'target_creature']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['target_creature'],
    });

    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === 'target_creature');
    expect(targetCreature?.counters?.['+1/+1']).toBe(1);
    expect((game.state as any).pendingDraws?.[p1]).toBe(1);
  });

  it('does not trigger when the activated ability was deterministically not paid with Treasure mana', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'vazi_1',
        controller: p1,
        owner: p1,
        card: { name: 'Vazi, Keen Negotiator', type_line: 'Legendary Creature — Human Advisor' },
      },
      {
        id: 'artifact_1',
        controller: p2,
        owner: p2,
        card: { name: 'Treasure-Fueled Device', type_line: 'Artifact' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'ability_stack_1',
        type: 'ability',
        controller: p2,
        source: 'artifact_1',
        sourceName: 'Treasure-Fueled Device',
        description: '{2}: Do a thing.',
        manaFromTreasureSpentKnown: true,
        manaFromTreasureSpent: false,
      },
    ];
    (game.state as any).pendingDraws = {};

    const triggers = triggerAbilityActivatedTriggers(game as any, {
      activatedBy: p2,
      sourcePermanentId: 'artifact_1',
      isManaAbility: false,
      abilityText: '{2}: Do a thing.',
      stackItemId: 'ability_stack_1',
    });

    expect(triggers).toHaveLength(0);
    expect(((game.state as any).stack || []).map((item: any) => item.sourceName || item.card?.name)).toEqual([
      'Treasure-Fueled Device',
    ]);
  });

  it('replayed pushTriggeredAbility still queues target selection and resolves the chosen creature effect', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    const p2 = 'p2' as any;
    (game as any).gameId = gameId;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'vazi_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'vazi_card_1',
          name: 'Vazi, Keen Negotiator',
          type_line: 'Legendary Creature — Human Advisor',
        },
      },
      {
        id: 'target_creature',
        controller: p1,
        owner: p1,
        card: {
          id: 'target_creature_card',
          name: 'Target Creature',
          type_line: 'Creature — Test',
          power: '2',
          toughness: '2',
        },
        counters: {},
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).pendingDraws = {};

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'trigger_vazi_replay_1',
      sourceId: 'vazi_1',
      sourceName: 'Vazi, Keen Negotiator',
      controllerId: p1,
      description: 'Put a +1/+1 counter on target creature, then draw a card.',
      triggerType: 'ability_activated',
      effect:
        'Whenever an opponent casts a spell or activates an ability, if mana from a Treasure was spent to cast it or activate it, put a +1/+1 counter on target creature, then draw a card.',
      mandatory: true,
      triggeringPlayer: p2,
      activatedAbilityIsManaAbility: false,
      triggeringStackItemId: 'ability_stack_1',
      requiresTarget: true,
      targetType: 'creature',
    });

    expect(((game.state as any).stack || [])).toHaveLength(1);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps[0] as any).targetedTriggeredAbility).toBe(true);
    expect(((queue.steps[0] as any).validTargets || []).map((target: any) => target.id)).toEqual(['vazi_1', 'target_creature']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((queue.steps[0] as any).id),
      selections: ['target_creature'],
    });

    const targetCreature = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === 'target_creature');
    expect(targetCreature?.counters?.['+1/+1']).toBe(1);
    expect((game.state as any).pendingDraws?.[p1]).toBe(1);
  });
});