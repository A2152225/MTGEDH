import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Mutate trigger targeting (integration)', () => {
  const gameId = 'test_mutate_trigger_targeting';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('routes mutate graveyard-return triggers through GRAVEYARD_SELECTION', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'host_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'host_card_1',
          name: 'Mutation Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_perm_1',
            name: 'Broken Monument',
            type_line: 'Artifact',
            mana_cost: '{3}',
            zone: 'graveyard',
          },
          {
            id: 'gy_spell_1',
            name: 'Spent Spell',
            type_line: 'Instant',
            mana_cost: '{1}{U}',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game.state as any).stack = [
      {
        id: 'stack_mutate_graveyard_1',
        type: 'spell',
        controller: playerId,
        alternateCostId: 'mutate',
        targets: ['host_1'],
        card: {
          id: 'mutate_graveyard_1',
          name: 'Boneyard Lurker',
          type_line: 'Creature - Nightmare Beast',
          oracle_text: 'Mutate {2}{B/G}{B/G}\nWhenever this creature mutates, return target permanent card from your graveyard to your hand.',
          zone: 'stack',
          power: '4',
          toughness: '4',
          isMutating: true,
          mutateTarget: 'host_1',
          mutateOnTop: true,
          alternateCostId: 'mutate',
        },
      },
    ];

    game.resolveTopOfStack();

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'host_1',
      sourceName: 'Boneyard Lurker',
      description: 'return target permanent card from your graveyard to your hand.',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'hand',
      targetFilterPermanentOnly: true,
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('graveyard_selection');
    expect(step.targetPlayerId).toBe(playerId);
    expect(step.destination).toBe('hand');
    expect(step.triggeredAbilityGraveyardSelection).toBe(true);
    expect(step.validTargets.map((target: any) => String(target.id))).toEqual(['gy_perm_1']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers.submitResolutionResponse).toBe('function');
    await handlers.submitResolutionResponse({
      gameId,
      stepId: step.id,
      selections: ['gy_perm_1'],
    });

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'gy_perm_1')).toBe(false);
    expect((playerZones?.hand || []).some((card: any) => String(card?.id || '') === 'gy_perm_1')).toBe(true);

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(persisted?.payload?.selectedCardIds).toEqual(['gy_perm_1']);
    expect(String(persisted?.payload?.destination || '')).toBe('hand');
  });

  it('allows mutate destroy triggers to target planeswalkers through generic TARGET_SELECTION', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'host_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'host_card_2',
          name: 'Mutation Host',
          type_line: 'Creature - Bat',
          oracle_text: 'Flying',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'opp_creature_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'opp_creature_card_1',
          name: 'Opponent Creature',
          type_line: 'Creature - Elf',
          oracle_text: '',
          zone: 'battlefield',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: 'opp_walker_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: { loyalty: 4 },
        card: {
          id: 'opp_walker_card_1',
          name: 'Opponent Walker',
          type_line: 'Legendary Planeswalker - Test',
          oracle_text: '',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'stack_mutate_destroy_1',
        type: 'spell',
        controller: playerId,
        alternateCostId: 'mutate',
        targets: ['host_2'],
        card: {
          id: 'mutate_destroy_1',
          name: 'Dirge Bat',
          type_line: 'Creature - Bat',
          oracle_text: 'Mutate {4}{B}{B}\nFlash\nFlying\nWhenever this creature mutates, destroy target creature or planeswalker an opponent controls.',
          zone: 'stack',
          power: '3',
          toughness: '3',
          isMutating: true,
          mutateTarget: 'host_2',
          mutateOnTop: true,
          alternateCostId: 'mutate',
        },
      },
    ];

    game.resolveTopOfStack();

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'host_2',
      sourceName: 'Dirge Bat',
      description: 'destroy target creature or planeswalker an opponent controls.',
      requiresTarget: true,
      targetType: 'creature or planeswalker',
      targetConstraint: 'opponent',
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('target_selection');
    expect(step.validTargets.map((target: any) => String(target.id)).sort()).toEqual(['opp_creature_1', 'opp_walker_1']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers.submitResolutionResponse).toBe('function');
    await handlers.submitResolutionResponse({
      gameId,
      stepId: step.id,
      selections: ['opp_walker_1'],
    });

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((permanent: any) => String(permanent?.id || '') === 'opp_walker_1')).toBe(false);
    expect(battlefield.some((permanent: any) => String(permanent?.id || '') === 'opp_creature_1')).toBe(true);
  });

  it('routes mutate graveyard-cast triggers through GRAVEYARD_SELECTION and into a free cast from graveyard', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [
      {
        id: 'host_3',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'host_card_3',
          name: 'Mutation Host',
          type_line: 'Creature - Elemental Dinosaur Cat',
          oracle_text: 'Flying',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_spell_2',
            name: 'Divination',
            mana_cost: '{2}{U}',
            manaCost: '{2}{U}',
            type_line: 'Sorcery',
            oracle_text: 'Draw two cards.',
            zone: 'graveyard',
          },
          {
            id: 'gy_creature_2',
            name: 'Dead Creature',
            mana_cost: '{2}{G}',
            manaCost: '{2}{G}',
            type_line: 'Creature - Bear',
            oracle_text: '',
            zone: 'graveyard',
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [
          { id: 'draw_1', name: 'Draw One', type_line: 'Instant', oracle_text: '', zone: 'library' },
          { id: 'draw_2', name: 'Draw Two', type_line: 'Instant', oracle_text: '', zone: 'library' },
        ],
        libraryCount: 2,
      },
    };
    (game.state as any).stack = [
      {
        id: 'stack_mutate_cast_1',
        type: 'spell',
        controller: playerId,
        alternateCostId: 'mutate',
        targets: ['host_3'],
        card: {
          id: 'mutate_cast_1',
          name: 'Vadrok, Apex of Thunder',
          type_line: 'Creature - Elemental Dinosaur Cat',
          oracle_text: 'Mutate {1}{W/U}{R}{R}\nFlying, first strike\nWhenever this creature mutates, you may cast target noncreature card with mana value 3 or less from your graveyard without paying its mana cost.',
          zone: 'stack',
          power: '3',
          toughness: '3',
          isMutating: true,
          mutateTarget: 'host_3',
          mutateOnTop: true,
          alternateCostId: 'mutate',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    game.resolveTopOfStack();

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'host_3',
      sourceName: 'Vadrok, Apex of Thunder',
      description: 'you may cast target noncreature card with mana value 3 or less from your graveyard without paying its mana cost.',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetAction: 'cast',
      targetFilterExcludeTypes: ['creature'],
      targetFilterMaxManaValue: 3,
      targetCastWithoutPayingManaCost: true,
      targetCastIsOptional: true,
    });

    game.resolveTopOfStack();

    let targetStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    if (targetStep?.type === 'option_choice') {
      await handlers.submitResolutionResponse({
        gameId,
        stepId: targetStep.id,
        selections: 'yes',
      });
      targetStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    }

    expect(targetStep.type).toBe('graveyard_selection');
    expect(targetStep.destination).toBe('cast');
    expect(targetStep.validTargets.map((target: any) => String(target.id))).toEqual(['gy_spell_2']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: targetStep.id,
      selections: ['gy_spell_2'],
    });

    const castChoiceStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    expect(castChoiceStep.type).toBe('option_choice');
    expect(String(castChoiceStep.castFromGraveyardCardId || '')).toBe('gy_spell_2');
    expect(castChoiceStep.castFromGraveyardWithoutPayingManaCost).toBe(true);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: castChoiceStep.id,
      selections: 'cast',
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(String(paymentStep.manaCost || '{0}')).toContain('0');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: paymentStep.id,
      selections: { payment: [] },
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.effectId).toBeDefined();
    expect(continueEvent?.payload?.alternateCostId).toBe('free');

    emitted.length = 0;
    await handlers.completeCastSpell(continueEvent?.payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => String(card?.id || ''));
    expect(graveyardIds).not.toContain('gy_spell_2');

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => String(entry?.card?.id || '') === 'gy_spell_2');
    expect(stackItem).toBeDefined();
    expect(stackItem?.castFromGraveyard).toBe(true);
    expect(stackItem?.castWithoutPayingManaCost).toBe(true);
  });
});