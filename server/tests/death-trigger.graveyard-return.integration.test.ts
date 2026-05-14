import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
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

describe('Death trigger graveyard returns (integration)', () => {
  const gameId = 'test_death_trigger_graveyard_return';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('resolves enchanted-creature death returns through persisted bound graveyard metadata', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'enchanted_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'enchanted_card_1',
          name: 'Doomed Traveler',
          type_line: 'Creature - Human Soldier',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'vigor_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        attachedTo: 'enchanted_1',
        card: {
          id: 'vigor_card_1',
          name: 'Demonic Vigor',
          type_line: 'Enchantment - Aura',
          oracle_text: 'Enchant creature\nWhen enchanted creature dies, return that card to its owner\'s hand.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
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

    expect(movePermanentToGraveyard(game as any, 'enchanted_1')).toBe(true);

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'vigor_1',
      sourceName: 'Demonic Vigor',
      triggerType: 'creature_dies',
      targetZone: 'graveyard',
      targetDestination: 'hand',
      destinationUsesSelectedCardOwner: true,
      boundGraveyardCardId: 'enchanted_card_1',
    });

    const pushEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'pushTriggeredAbility') as any;
    expect(pushEvent?.payload).toMatchObject({
      sourceName: 'Demonic Vigor',
      triggerType: 'creature_dies',
      targetZone: 'graveyard',
      targetDestination: 'hand',
      destinationUsesSelectedCardOwner: true,
      boundGraveyardCardId: 'enchanted_card_1',
    });

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'enchanted_card_1')).toBe(false);
    expect((playerZones?.hand || []).some((card: any) => String(card?.id || '') === 'enchanted_card_1')).toBe(true);

    const confirmEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload?.selectedCardIds).toEqual(['enchanted_card_1']);
    expect(String(confirmEvent?.payload?.destination || '')).toBe('hand');
  });

  it('returns enchanted creatures to the battlefield under the aura controller for Fool\'s Demise', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'fooled_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'fooled_card_1',
          name: 'Distracted Guard',
          type_line: 'Creature - Human Soldier',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
      {
        id: 'fools_demise_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        attachedTo: 'fooled_1',
        card: {
          id: 'fools_demise_card_1',
          name: "Fool's Demise",
          type_line: 'Enchantment - Aura',
          oracle_text: 'Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under your control.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'fooled_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      source: 'fools_demise_1',
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      boundGraveyardCardId: 'fooled_card_1',
      boundGraveyardOwnerId: opponentId,
    });

    game.resolveTopOfStack();

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'fooled_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: controllerId,
      owner: opponentId,
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['fooled_card_1'],
      destination: 'battlefield',
      targetPlayerId: opponentId,
    });
  });

  it('routes death triggers targeting your graveyard through GRAVEYARD_SELECTION with persisted metadata', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'reclaimer_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'reclaimer_card_1',
          name: 'Grave Reclaimer',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a creature you control dies, return target Dragon creature card from your graveyard to your hand.',
          zone: 'battlefield',
        },
      },
      {
        id: 'victim_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'victim_card_1',
          name: 'Fallen Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
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
            id: 'gy_dragon_1',
            name: 'Reclaimed Dragon',
            type_line: 'Creature - Dragon',
            mana_cost: '{4}{R}',
            zone: 'graveyard',
            power: '4',
            toughness: '4',
          },
          {
            id: 'gy_non_dragon_1',
            name: 'Reclaimed Skeleton',
            type_line: 'Creature - Skeleton',
            mana_cost: '{1}{B}',
            zone: 'graveyard',
            power: '1',
            toughness: '1',
          },
          {
            id: 'gy_noncreature_1',
            name: 'Spent Spell',
            type_line: 'Instant',
            mana_cost: '{1}{U}',
            zone: 'graveyard',
          },
        ],
        graveyardCount: 3,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'victim_1')).toBe(true);

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'reclaimer_1',
      sourceName: 'Grave Reclaimer',
      triggerType: 'creature_dies',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'hand',
      targetGraveyardScope: 'your',
      targetFilterTypes: ['creature'],
      targetFilterRequiredTypeWords: ['dragon'],
    });

    const pushEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'pushTriggeredAbility') as any;
    expect(pushEvent?.payload).toMatchObject({
      sourceName: 'Grave Reclaimer',
      triggerType: 'creature_dies',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'hand',
      targetGraveyardScope: 'your',
      targetFilterTypes: ['creature'],
      targetFilterRequiredTypeWords: ['dragon'],
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('graveyard_selection');
    expect(step.targetPlayerId).toBe(playerId);
    expect(step.destination).toBe('hand');
    expect(step.validTargets.map((target: any) => String(target.id))).toEqual(['gy_dragon_1']);

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
      selections: ['gy_dragon_1'],
    });

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'gy_dragon_1')).toBe(false);
    expect((playerZones?.hand || []).some((card: any) => String(card?.id || '') === 'gy_dragon_1')).toBe(true);

    const confirmEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload?.selectedCardIds).toEqual(['gy_dragon_1']);
    expect(String(confirmEvent?.payload?.destination || '')).toBe('hand');
  });

  it('uses the dying creature\'s power for graveyard mana-value limits on death-trigger targets', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'power_reclaimer_die_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 1,
        card: {
          id: 'power_reclaimer_die_card_1',
          name: 'Power Reclaimer',
          type_line: 'Creature - Spirit',
          mana_cost: '{4}{B}',
          oracle_text: 'When this creature dies, return target creature card with mana value less than or equal to this creature\'s power from your graveyard to the battlefield.',
          zone: 'battlefield',
          power: '3',
          toughness: '1',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_mv3_target',
            name: 'Three-Drop Witness',
            type_line: 'Creature - Human',
            mana_cost: '{2}{G}',
            zone: 'graveyard',
            power: '3',
            toughness: '2',
          },
          {
            id: 'gy_mv4_target',
            name: 'Four-Drop Giant',
            type_line: 'Creature - Giant',
            mana_cost: '{3}{G}',
            zone: 'graveyard',
            power: '4',
            toughness: '4',
          },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'power_reclaimer_die_1')).toBe(true);

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'power_reclaimer_die_1',
      sourceName: 'Power Reclaimer',
      requiresTarget: true,
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      targetGraveyardScope: 'your',
      targetFilterTypes: ['creature'],
      targetFilterMaxManaValue: 3,
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('graveyard_selection');
    expect(step.targetPlayerId).toBe(playerId);
    expect(step.destination).toBe('battlefield');
    expect(step.validTargets.map((target: any) => String(target.id))).toEqual(['gy_mv3_target']);
  });

  it('routes Junji death modal reanimation through MODAL_CHOICE and excludes Dragon creature cards', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'junji_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 5,
        baseToughness: 5,
        card: {
          id: 'junji_card_1',
          name: 'Junji, the Midnight Sky',
          type_line: 'Legendary Creature - Dragon Spirit',
          oracle_text: 'Flying, menace\nWhen Junji, the Midnight Sky dies, choose one —\n• Each opponent discards two cards and loses 2 life.\n• Put target non-Dragon creature card from a graveyard onto the battlefield under your control.',
          zone: 'battlefield',
          power: '5',
          toughness: '5',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_dragon_1',
            name: 'Ancient Whelp',
            type_line: 'Creature - Dragon',
            mana_cost: '{4}{R}',
            zone: 'graveyard',
            power: '4',
            toughness: '4',
          },
          {
            id: 'gy_bear_1',
            name: 'Returned Bear',
            type_line: 'Creature - Bear',
            mana_cost: '{2}{G}',
            zone: 'graveyard',
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'junji_1')).toBe(true);

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'junji_1',
      sourceName: 'Junji, the Midnight Sky',
      triggerType: 'creature_dies',
      requiresChoice: true,
    });
    expect((triggerStack[0] as any).modalOptions).toEqual([
      'each opponent discards two cards and loses 2 life.',
      'put target non-dragon creature card from a graveyard onto the battlefield under your control.',
    ]);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const modalStep = queue.steps[0] as any;
    expect(modalStep.type).toBe('modal_choice');
    expect(modalStep.options.map((option: any) => String(option.id))).toEqual(['option_1', 'option_2']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: modalStep.id,
      selections: ['option_2'],
    });

    const updatedQueue = ResolutionQueueManager.getQueue(gameId);
    expect(updatedQueue.steps).toHaveLength(1);
    const graveyardStep = updatedQueue.steps[0] as any;
    expect(graveyardStep.type).toBe('graveyard_selection');
    expect(graveyardStep.destination).toBe('battlefield');
    expect(graveyardStep.validTargets.map((target: any) => String(target.id))).toEqual(['gy_bear_1']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: graveyardStep.id,
      selections: ['gy_bear_1'],
    });

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'gy_bear_1')).toBe(false);

    const confirmEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    const createdPermanentId = String(confirmEvent?.payload?.createdPermanentIds?.[0] || '');
    expect(createdPermanentId).not.toBe('');

    const reanimatedPermanent = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => String(permanent?.id || '') === createdPermanentId,
    );
    expect(reanimatedPermanent).toBeDefined();
    expect(String(reanimatedPermanent?.controller || '')).toBe(playerId);
    expect(String(reanimatedPermanent?.card?.id || '')).toBe('gy_bear_1');
  });

  it('uses known death-trigger fallback modal parsing for Junji when oracle text is unavailable', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'junji_fallback_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 5,
        baseToughness: 5,
        card: {
          id: 'junji_fallback_card_1',
          name: 'Junji, the Midnight Sky',
          type_line: 'Legendary Creature - Dragon Spirit',
          oracle_text: '',
          zone: 'battlefield',
          power: '5',
          toughness: '5',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'gy_fallback_dragon_1',
            name: 'Ancient Whelp',
            type_line: 'Creature - Dragon',
            mana_cost: '{4}{R}',
            zone: 'graveyard',
            power: '4',
            toughness: '4',
          },
          {
            id: 'gy_fallback_bear_1',
            name: 'Returned Bear',
            type_line: 'Creature - Bear',
            mana_cost: '{2}{G}',
            zone: 'graveyard',
            power: '2',
            toughness: '2',
          },
        ],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'junji_fallback_1')).toBe(true);

    const triggerStack = (game.state as any).stack || [];
    expect(triggerStack).toHaveLength(1);
    expect(triggerStack[0]).toMatchObject({
      type: 'triggered_ability',
      source: 'junji_fallback_1',
      sourceName: 'Junji, the Midnight Sky',
      triggerType: 'creature_dies',
      requiresChoice: true,
    });
    expect((triggerStack[0] as any).modalOptions).toEqual([
      'Target opponent discards two cards and loses 2 life',
      'put target non-Dragon creature card from a graveyard onto the battlefield under your control',
    ]);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const modalStep = queue.steps[0] as any;
    expect(modalStep.type).toBe('modal_choice');
    expect(modalStep.options.map((option: any) => String(option.id))).toEqual(['option_1', 'option_2']);
  });

  it('schedules bound self-return at the next end step instead of moving immediately', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'scorpion_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 6,
        baseToughness: 5,
        card: {
          id: 'scorpion_card_1',
          name: 'The Scorpion God',
          type_line: 'Legendary Creature - God',
          oracle_text: "When The Scorpion God dies, return it to its owner's hand at the beginning of the next end step.",
          zone: 'battlefield',
          power: '6',
          toughness: '5',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
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

    expect(movePermanentToGraveyard(game as any, 'scorpion_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'scorpion_card_1')).toBe(true);
    expect((playerZones?.hand || []).some((card: any) => String(card?.id || '') === 'scorpion_card_1')).toBe(false);

    const pendingDelayed = (game.state as any).pendingDelayedGraveyardReturns || [];
    expect(pendingDelayed).toHaveLength(1);
    expect(pendingDelayed[0]).toMatchObject({
      cardId: 'scorpion_card_1',
      zoneOwnerId: playerId,
      destination: 'hand',
      sourceName: 'The Scorpion God',
    });

    const scheduleEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'scheduleDelayedGraveyardReturn') as any;
    expect(scheduleEvent?.payload?.entries).toHaveLength(1);
    expect(scheduleEvent?.payload?.entries?.[0]).toMatchObject({
      cardId: 'scorpion_card_1',
      zoneOwnerId: playerId,
      destination: 'hand',
    });
  });

  it('returns qualifying creatures with a flying counter after Luminous Broodmoth sees them die without flying', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'broodmoth_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 4,
        card: {
          id: 'broodmoth_card_1',
          name: 'Luminous Broodmoth',
          type_line: 'Creature - Insect',
          oracle_text: 'Flying\nWhenever a creature you control without flying dies, return it to the battlefield under its owner\'s control with a flying counter on it.',
          keywords: ['Flying'],
          zone: 'battlefield',
          power: '3',
          toughness: '4',
        },
      },
      {
        id: 'groundling_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'groundling_card_1',
          name: 'Groundling',
          type_line: 'Creature - Human Soldier',
          oracle_text: '',
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
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'groundling_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'groundling_card_1')).toBe(false);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'groundling_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: { flying: 1 },
    });
  });

  it('returns Ashcloud Phoenix face down through persisted graveyard-return metadata', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'ashcloud_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 1,
        card: {
          id: 'ashcloud_card_1',
          name: 'Ashcloud Phoenix',
          type_line: 'Creature - Phoenix',
          oracle_text: 'Flying\nWhen Ashcloud Phoenix dies, return it to the battlefield face down under your control.',
          keywords: ['Flying'],
          zone: 'battlefield',
          power: '4',
          toughness: '1',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
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

    expect(movePermanentToGraveyard(game as any, 'ashcloud_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'ashcloud_card_1')).toBe(false);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.faceUpCard?.id || '') === 'ashcloud_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      tapped: false,
      isFaceDown: true,
      faceDownType: 'effect',
      card: {
        name: 'Face-down Creature',
        type_line: 'Creature',
      },
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['ashcloud_card_1'],
      destination: 'battlefield',
      battlefieldFaceDown: true,
    });
  });

  it('returns Presumed Dead targets suspected through granted temporary death-trigger text', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).stack = [
      {
        id: 'presumed_dead_spell_1',
        type: 'spell',
        controller: playerId,
        source: 'hand',
        targets: ['presumed_target_1'],
        card: {
          id: 'presumed_dead_card_1',
          name: 'Presumed Dead',
          type_line: 'Instant',
          oracle_text: 'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner\'s control and suspect it."',
          zone: 'stack',
        },
      },
    ];
    (game.state as any).battlefield = [
      {
        id: 'presumed_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        temporaryPTMods: [],
        temporaryAbilities: [],
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'presumed_target_card_1',
          name: 'Night Market Lookout',
          type_line: 'Creature - Human Rogue',
          oracle_text: '',
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
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    game.resolveTopOfStack();

    const buffedCreature = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'presumed_target_1');
    const temporaryAbilities = Array.isArray(buffedCreature?.temporaryAbilities) ? buffedCreature.temporaryAbilities : [];
    expect(temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ability: 'when this creature dies, return it to the battlefield under its owner\'s control and suspect it.',
        }),
      ]),
    );

    expect(movePermanentToGraveyard(game as any, 'presumed_target_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      battlefieldControllerMode: 'owner',
      battlefieldSuspected: true,
      boundGraveyardCardId: 'presumed_target_card_1',
    });

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'presumed_target_card_1')).toBe(false);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'presumed_target_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      suspected: true,
      isSuspected: true,
      card: {
        suspected: true,
        isSuspected: true,
      },
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['presumed_target_card_1'],
      destination: 'battlefield',
      battlefieldSuspected: true,
      battlefieldControllerMode: 'owner',
    });
  });

  it('returns Perigee Beckoner targets tapped through granted temporary death-trigger text from a triggered ability', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 2;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).stack = [
      {
        id: 'perigee_trigger_1',
        type: 'triggered_ability',
        controller: playerId,
        source: 'perigee_beckoner_1',
        sourceName: 'Perigee Beckoner',
        description: 'Until end of turn, another target creature you control gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."',
        effect: 'Until end of turn, another target creature you control gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."',
        targets: ['perigee_target_1'],
        mandatory: true,
      },
    ];
    (game.state as any).battlefield = [
      {
        id: 'perigee_beckoner_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 3,
        card: {
          id: 'perigee_beckoner_card_1',
          name: 'Perigee Beckoner',
          type_line: 'Creature - Horror',
          oracle_text: 'When this creature enters, until end of turn, another target creature you control gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control."',
          zone: 'battlefield',
          power: '2',
          toughness: '3',
        },
      },
      {
        id: 'perigee_target_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        temporaryPTMods: [],
        temporaryAbilities: [],
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'perigee_target_card_1',
          name: 'Cloudrunner',
          type_line: 'Creature - Bird',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    game.resolveTopOfStack();

    const buffedCreature = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'perigee_target_1');
    const temporaryAbilities = Array.isArray(buffedCreature?.temporaryAbilities) ? buffedCreature.temporaryAbilities : [];
    expect(temporaryAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ability: 'when this creature dies, return it to the battlefield tapped under its owner\'s control.',
        }),
      ]),
    );

    expect(movePermanentToGraveyard(game as any, 'perigee_target_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      battlefieldControllerMode: 'owner',
      battlefieldTapped: true,
      boundGraveyardCardId: 'perigee_target_card_1',
    });

    game.resolveTopOfStack();

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'perigee_target_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      tapped: true,
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['perigee_target_card_1'],
      destination: 'battlefield',
      battlefieldControllerMode: 'owner',
      battlefieldTapped: true,
    });
  });

  it('returns another nonartifact creature that dies face down and tapped under Missy\'s control', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'missy_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 5,
        card: {
          id: 'missy_card_1',
          name: 'Missy',
          type_line: 'Legendary Creature - Time Lord Rogue',
          oracle_text: 'Whenever another nonartifact creature dies, return that card to the battlefield face down under your control tapped. It\'s a 2/2 Cyberman artifact creature.',
          zone: 'battlefield',
          power: '4',
          toughness: '5',
        },
      },
      {
        id: 'victim_missy_1',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'victim_missy_card_1',
          name: 'Silvercoat Lion',
          type_line: 'Creature - Cat',
          oracle_text: '',
          zone: 'battlefield',
          power: '3',
          toughness: '3',
        },
      },
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [p2]: {
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

    expect(movePermanentToGraveyard(game as any, 'victim_missy_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    const p2Zones = (game.state as any).zones?.[p2];
    expect((p2Zones?.graveyard || []).some((card: any) => String(card?.id || '') === 'victim_missy_card_1')).toBe(false);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.faceUpCard?.id || '') === 'victim_missy_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: p1,
      owner: p2,
      tapped: true,
      isFaceDown: true,
      faceDownType: 'effect',
      card: {
        name: 'Face-down Creature',
        type_line: 'Creature',
      },
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['victim_missy_card_1'],
      destination: 'battlefield',
      battlefieldTapped: true,
      battlefieldFaceDown: true,
    });
  });

  it('returns face-down permanents for Yarus and turns them face up using the underlying card identity', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'yarus_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'yarus_card_1',
          name: 'Yarus, Roar of the Old Gods',
          type_line: 'Legendary Creature - Centaur Druid',
          oracle_text: 'Whenever a face-down creature you control dies, return it to the battlefield face down under its owner\'s control if it\'s a permanent card, then turn it face up.',
          zone: 'battlefield',
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'manifested_land_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'face_down_placeholder_1',
          name: 'Face-down Creature',
          type_line: 'Creature',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
        isFaceDown: true,
        faceDownType: 'manifest',
        faceUpCard: {
          id: 'manifested_land_card_1',
          name: 'Hidden Meadow',
          type_line: 'Land',
          oracle_text: '',
          zone: 'battlefield',
        },
        canTurnFaceUp: true,
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'manifested_land_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      battlefieldControllerMode: 'owner',
      battlefieldFaceDown: true,
      battlefieldTurnFaceUp: true,
      boundGraveyardCardId: 'manifested_land_card_1',
    });

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'manifested_land_card_1')).toBe(true);

    game.resolveTopOfStack();

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'manifested_land_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      card: {
        id: 'manifested_land_card_1',
        name: 'Hidden Meadow',
        type_line: 'Land',
      },
    });
    expect(returnedPermanent?.isFaceDown).not.toBe(true);
    expect(returnedPermanent?.faceUpCard).toBeUndefined();

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['manifested_land_card_1'],
      destination: 'battlefield',
      battlefieldFaceDown: true,
      battlefieldTurnFaceUp: true,
      battlefieldControllerMode: 'owner',
    });
  });

  it('schedules Phytotitan for its owner\'s next upkeep and returns it tapped then', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 1;
    (game.state as any).turn = 1;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'phytotitan_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 7,
        baseToughness: 2,
        card: {
          id: 'phytotitan_card_1',
          name: 'Phytotitan',
          type_line: 'Creature - Plant Elemental',
          oracle_text: 'When Phytotitan dies, return it to the battlefield tapped under its owner\'s control at the beginning of their next upkeep.',
          zone: 'battlefield',
          power: '7',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
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

    expect(movePermanentToGraveyard(game as any, 'phytotitan_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    let playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'phytotitan_card_1')).toBe(true);

    const pendingDelayed = (game.state as any).pendingDelayedGraveyardReturns || [];
    expect(pendingDelayed).toHaveLength(1);
    expect(pendingDelayed[0]).toMatchObject({
      cardId: 'phytotitan_card_1',
      zoneOwnerId: playerId,
      destination: 'battlefield',
      fireAtStep: 'upkeep',
      fireAtPlayerId: playerId,
      battlefieldTapped: true,
    });

    (game.state as any).phase = 'beginning';
    (game.state as any).step = 'UNTAP';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 2;
    (game.state as any).turn = 2;

    game.nextStep();

    expect((game.state as any).stack).toHaveLength(1);
    game.resolveTopOfStack();

    playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'phytotitan_card_1')).toBe(false);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'phytotitan_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      tapped: true,
    });

    const scheduleEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'scheduleDelayedGraveyardReturn') as any;
    expect(scheduleEvent?.payload?.entries?.[0]).toMatchObject({
      cardId: 'phytotitan_card_1',
      fireAtStep: 'upkeep',
      fireAtPlayerId: playerId,
    });
  });

  it('matches Marchesa for creatures you control with a +1/+1 counter on them', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'marchesa_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'marchesa_card_1',
          name: 'Marchesa, the Black Rose',
          type_line: 'Legendary Creature - Human Wizard',
          oracle_text: 'Whenever a creature you control with a +1/+1 counter on it dies, return that card to the battlefield under your control at the beginning of the next end step.',
          zone: 'battlefield',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: 'subject_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { '+1/+1': 1 },
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'subject_card_1',
          name: 'Ambitious Mage',
          type_line: 'Creature - Human Wizard',
          oracle_text: '',
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
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'subject_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    const pendingDelayed = (game.state as any).pendingDelayedGraveyardReturns || [];
    expect(pendingDelayed).toHaveLength(1);
    expect(pendingDelayed[0]).toMatchObject({
      cardId: 'subject_card_1',
      zoneOwnerId: playerId,
      destination: 'battlefield',
      sourceName: 'Marchesa, the Black Rose',
    });
  });

  it('returns Villains with a finality counter through Thunderbolts Conspiracy', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'thunderbolts_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        card: {
          id: 'thunderbolts_card_1',
          name: 'Thunderbolts Conspiracy',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a Villain you control dies, return it to the battlefield under its owner\'s control with a finality counter on it.',
          zone: 'battlefield',
        },
      },
      {
        id: 'villain_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 2,
        card: {
          id: 'villain_card_1',
          name: 'Stage Villain',
          type_line: 'Creature - Villain Rogue',
          oracle_text: '',
          zone: 'battlefield',
          power: '3',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
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

    expect(movePermanentToGraveyard(game as any, 'villain_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      battlefieldControllerMode: 'owner',
      battlefieldCounters: { finality: 1 },
      boundGraveyardCardId: 'villain_card_1',
    });

    game.resolveTopOfStack();

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'villain_card_1')).toBe(false);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'villain_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: playerId,
      owner: playerId,
      counters: { finality: 1 },
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['villain_card_1'],
      destination: 'battlefield',
      battlefieldControllerMode: 'owner',
      battlefieldCounters: { finality: 1 },
    });
  });

  it('returns creatures damaged by Dread Slaver this turn under its controller\'s control', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'dread_slaver_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 5,
        card: {
          id: 'dread_slaver_card_1',
          name: 'Dread Slaver',
          type_line: 'Creature - Zombie',
          oracle_text: 'Whenever a creature dealt damage by this creature this turn dies, return it to the battlefield under your control.',
          zone: 'battlefield',
          power: '3',
          toughness: '5',
        },
      },
      {
        id: 'dread_victim_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'dread_victim_card_1',
          name: 'Doomed Guard',
          type_line: 'Creature - Human Soldier',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };
    (game.state as any).creaturesDamagedByThisCreatureThisTurn = {
      dread_slaver_1: {
        dread_victim_1: true,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'dread_victim_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      source: 'dread_slaver_1',
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      boundGraveyardCardId: 'dread_victim_card_1',
      boundGraveyardOwnerId: opponentId,
    });

    game.resolveTopOfStack();

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'dread_victim_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: controllerId,
      owner: opponentId,
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['dread_victim_card_1'],
      destination: 'battlefield',
      targetPlayerId: opponentId,
    });
  });

  it('returns creatures damaged by the equipped creature for Scythe of the Wretched', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'scythe_wielder_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'scythe_wielder_card_1',
          name: 'Ghoul Bladebearer',
          type_line: 'Creature - Zombie Warrior',
          oracle_text: '',
          zone: 'battlefield',
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'scythe_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        attachedTo: 'scythe_wielder_1',
        card: {
          id: 'scythe_card_1',
          name: 'Scythe of the Wretched',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Whenever a creature dealt damage by equipped creature this turn dies, return that card to the battlefield under your control.',
          zone: 'battlefield',
        },
      },
      {
        id: 'scythe_victim_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'scythe_victim_card_1',
          name: 'Hapless Infantry',
          type_line: 'Creature - Human Soldier',
          oracle_text: '',
          zone: 'battlefield',
          power: '3',
          toughness: '3',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };
    (game.state as any).creaturesDamagedByThisCreatureThisTurn = {
      scythe_wielder_1: {
        scythe_victim_1: true,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'scythe_victim_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      source: 'scythe_1',
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      boundGraveyardCardId: 'scythe_victim_card_1',
      boundGraveyardOwnerId: opponentId,
    });

    game.resolveTopOfStack();

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'scythe_victim_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: controllerId,
      owner: opponentId,
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['scythe_victim_card_1'],
      destination: 'battlefield',
      targetPlayerId: opponentId,
    });
  });

  it('returns equipped Samurai cards under the equipment controller\'s control', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'samurai_relic_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        attachedTo: 'samurai_target_1',
        card: {
          id: 'samurai_relic_card_1',
          name: 'Samurai Relic',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Whenever equipped creature dies, return that card to the battlefield under your control if it\'s a Samurai card.',
          zone: 'battlefield',
        },
      },
      {
        id: 'samurai_target_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'samurai_target_card_1',
          name: 'Wandering Ronin',
          type_line: 'Creature - Human Samurai',
          oracle_text: '',
          zone: 'battlefield',
          power: '3',
          toughness: '3',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'samurai_target_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      source: 'samurai_relic_1',
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      boundGraveyardCardId: 'samurai_target_card_1',
      boundGraveyardOwnerId: opponentId,
    });

    game.resolveTopOfStack();

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'samurai_target_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: controllerId,
      owner: opponentId,
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['samurai_target_card_1'],
      destination: 'battlefield',
      targetPlayerId: opponentId,
    });
  });

  it('does not bind equipped creature returns under your control when the dead card is not a Samurai', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'samurai_relic_2',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        attachedTo: 'not_samurai_target_1',
        card: {
          id: 'samurai_relic_card_2',
          name: 'Samurai Relic',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Whenever equipped creature dies, return that card to the battlefield under your control if it\'s a Samurai card.',
          zone: 'battlefield',
        },
      },
      {
        id: 'not_samurai_target_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 3,
        card: {
          id: 'not_samurai_target_card_1',
          name: 'Ordinary Mercenary',
          type_line: 'Creature - Human Mercenary',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '3',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'not_samurai_target_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).not.toHaveProperty('targetZone');
    expect((game.state as any).stack[0]).not.toHaveProperty('boundGraveyardCardId');

    game.resolveTopOfStack();

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'not_samurai_target_card_1',
    );
    expect(returnedPermanent).toBeUndefined();

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'not_samurai_target_card_1')).toBe(true);

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent).toBeUndefined();
  });

  it('schedules equipped creature returns for the next end step under the owner\'s control', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).turnNumber = 5;
    (game.state as any).phase = 'main1';
    (game.state as any).step = 'MAIN1';
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'resurrection_orb_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        attachedTo: 'orb_target_1',
        card: {
          id: 'resurrection_orb_card_1',
          name: 'Resurrection Orb',
          type_line: 'Artifact - Equipment',
          oracle_text: 'Whenever equipped creature dies, return that card to the battlefield under its owner\'s control at the beginning of the next end step.',
          zone: 'battlefield',
        },
      },
      {
        id: 'orb_target_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'orb_target_card_1',
          name: 'Borrowed Brute',
          type_line: 'Creature - Ogre Warrior',
          oracle_text: '',
          zone: 'battlefield',
          power: '4',
          toughness: '4',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'orb_target_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      source: 'resurrection_orb_1',
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      delayedReturnAt: 'next_end_step',
      battlefieldControllerMode: 'owner',
      boundGraveyardCardId: 'orb_target_card_1',
      boundGraveyardOwnerId: opponentId,
    });

    game.resolveTopOfStack();

    const pendingDelayed = (game.state as any).pendingDelayedGraveyardReturns || [];
    expect(pendingDelayed).toHaveLength(1);
    expect(pendingDelayed[0]).toMatchObject({
      cardId: 'orb_target_card_1',
      zoneOwnerId: opponentId,
      destination: 'battlefield',
      battlefieldControllerMode: 'owner',
      fireAtStep: 'end_step',
      createdBy: controllerId,
    });

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'orb_target_card_1')).toBe(true);

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const scheduleEvent = [...newEvents].reverse().find((event: any) => event.type === 'scheduleDelayedGraveyardReturn') as any;
    expect(scheduleEvent?.payload?.entries).toHaveLength(1);
    expect(scheduleEvent?.payload?.entries?.[0]).toMatchObject({
      cardId: 'orb_target_card_1',
      zoneOwnerId: opponentId,
      destination: 'battlefield',
      battlefieldControllerMode: 'owner',
      fireAtStep: 'end_step',
      createdBy: controllerId,
    });
  });

  it('schedules Grave Betrayal returns for the next end step under the trigger controller', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).turnNumber = 3;
    (game.state as any).phase = 'main1';
    (game.state as any).step = 'MAIN1';
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'grave_betrayal_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        counters: {},
        card: {
          id: 'grave_betrayal_card_1',
          name: 'Grave Betrayal',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a creature you don\'t control dies, return it to the battlefield under your control with an additional +1/+1 counter on it at the beginning of the next end step.',
          zone: 'battlefield',
        },
      },
      {
        id: 'opponent_victim_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'opponent_victim_card_1',
          name: 'Fallen Soldier',
          type_line: 'Creature - Human Soldier',
          oracle_text: '',
          zone: 'battlefield',
          power: '3',
          toughness: '3',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
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

    expect(movePermanentToGraveyard(game as any, 'opponent_victim_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      delayedReturnAt: 'next_end_step',
      battlefieldCounters: { '+1/+1': 1 },
      boundGraveyardCardId: 'opponent_victim_card_1',
      boundGraveyardOwnerId: opponentId,
    });

    game.resolveTopOfStack();

    expect(((game.state as any).battlefield || []).some((perm: any) => perm?.id === 'opponent_victim_1')).toBe(false);
    expect(((game.state as any).battlefield || []).some((perm: any) => String(perm?.card?.id || '') === 'opponent_victim_card_1')).toBe(false);

    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'opponent_victim_card_1')).toBe(true);

    const pendingDelayed = (game.state as any).pendingDelayedGraveyardReturns || [];
    expect(pendingDelayed).toHaveLength(1);
    expect(pendingDelayed[0]).toMatchObject({
      cardId: 'opponent_victim_card_1',
      zoneOwnerId: opponentId,
      createdBy: controllerId,
      destination: 'battlefield',
      battlefieldCounters: { '+1/+1': 1 },
      fireAtStep: 'end_step',
    });

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const scheduleEvent = [...newEvents].reverse().find((event: any) => event.type === 'scheduleDelayedGraveyardReturn') as any;
    expect(scheduleEvent?.payload?.entries).toHaveLength(1);
    expect(scheduleEvent?.payload?.entries?.[0]).toMatchObject({
      cardId: 'opponent_victim_card_1',
      zoneOwnerId: opponentId,
      createdBy: controllerId,
      destination: 'battlefield',
      battlefieldCounters: { '+1/+1': 1 },
      fireAtStep: 'end_step',
    });
  });

  it('schedules delayed battlefield returns after graveyard selection without moving the card immediately', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).pendingDelayedGraveyardReturns = [];
    (game.state as any).battlefield = [
      {
        id: 'reclaimer_delayed_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'reclaimer_delayed_card_1',
          name: 'Delayed Reclaimer',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a creature you control dies, return target creature card from your graveyard to the battlefield tapped under its owner\'s control at the beginning of the next end step.',
          zone: 'battlefield',
        },
      },
      {
        id: 'victim_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'victim_card_2',
          name: 'Bearer',
          type_line: 'Creature - Human',
          oracle_text: '',
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
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'victim_2')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('graveyard_selection');
    expect(step.delayedReturnAt).toBe('next_end_step');
    expect(step.destination).toBe('battlefield');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: step.id,
      selections: ['victim_card_2'],
    });

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'victim_card_2')).toBe(true);
    expect(((game.state as any).battlefield || []).some((perm: any) => String(perm?.card?.id || '') === 'victim_card_2')).toBe(false);

    const pendingDelayed = (game.state as any).pendingDelayedGraveyardReturns || [];
    expect(pendingDelayed).toHaveLength(1);
    expect(pendingDelayed[0]).toMatchObject({
      cardId: 'victim_card_2',
      zoneOwnerId: playerId,
      destination: 'battlefield',
      battlefieldControllerMode: 'owner',
    });

    const scheduleEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'scheduleDelayedGraveyardReturn') as any;
    expect(scheduleEvent?.payload?.entries).toHaveLength(1);
    expect(scheduleEvent?.payload?.entries?.[0]).toMatchObject({
      cardId: 'victim_card_2',
      zoneOwnerId: playerId,
      destination: 'battlefield',
      battlefieldControllerMode: 'owner',
    });
  });

  it('prompts for Vraska payment and returns the dying card as a tapped Treasure artifact', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    const eventsBefore = getEvents(gameId).length;
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).manaPool = {
      [controllerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'vraska_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        counters: {},
        basePower: 3,
        baseToughness: 3,
        card: {
          id: 'vraska_card_1',
          name: 'Vraska, the Silencer',
          type_line: 'Legendary Creature - Gorgon Assassin',
          oracle_text: 'Deathtouch\nWhenever a nontoken creature an opponent controls dies, you may pay {1}. If you do, return that card to the battlefield tapped under your control. It\'s a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color," and it loses all other card types.',
          zone: 'battlefield',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: 'vraska_victim_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'vraska_victim_card_1',
          name: 'Doomed Ranger',
          type_line: 'Creature - Human Scout',
          oracle_text: '',
          zone: 'battlefield',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'vraska_victim_1')).toBe(true);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0]).toMatchObject({
      source: 'vraska_1',
      boundGraveyardCardId: 'vraska_victim_card_1',
      targetZone: 'graveyard',
      targetDestination: 'battlefield',
      battlefieldTapped: true,
      battlefieldSetTypeLine: 'Artifact - Treasure',
    });
    expect(String((game.state as any).stack[0]?.effect || '').toLowerCase()).toContain('if you do, return that card');

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) => (step as any).optionalPaymentPrompt === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep).toMatchObject({
      type: 'option_choice',
      playerId: controllerId,
      optionalPaymentManaCost: '{1}',
      triggeredAbilityManaPaymentChoice: true,
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(controllerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: paymentStep.id,
      selections: 'pay_mana',
    });

    expect((game.state as any).manaPool[controllerId].colorless).toBe(0);
    const opponentZones = (game.state as any).zones?.[opponentId];
    expect((opponentZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'vraska_victim_card_1')).toBe(false);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'vraska_victim_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: controllerId,
      owner: opponentId,
      tapped: true,
      card: {
        type_line: 'Artifact - Treasure',
        oracle_text: '{t}, sacrifice this artifact: add one mana of any color,',
      },
    });
    expect(returnedPermanent?.basePower).toBeUndefined();
    expect(returnedPermanent?.baseToughness).toBeUndefined();

    const newEvents = getEvents(gameId).slice(eventsBefore);
    const confirmEvent = [...newEvents].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload).toMatchObject({
      selectedCardIds: ['vraska_victim_card_1'],
      destination: 'battlefield',
      battlefieldTapped: true,
      battlefieldSetTypeLine: 'Artifact - Treasure',
    });
  });

  it('prompts for Lim-Dul payment and returns the dying creature with Zombie added', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const controllerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: controllerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = controllerId;
    (game.state as any).priority = controllerId;
    (game.state as any).manaPool = {
      [controllerId]: { white: 0, blue: 0, black: 1, red: 0, green: 0, colorless: 1 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'lim_dul_1',
        controller: controllerId,
        owner: controllerId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 4,
        card: {
          id: 'lim_dul_card_1',
          name: 'Lim-Dul the Necromancer',
          type_line: 'Legendary Creature - Human Wizard',
          oracle_text: 'Whenever a creature an opponent controls dies, you may pay {1}{B}. If you do, return that card to the battlefield under your control. If it\'s a creature, it\'s a Zombie in addition to its other creature types.\n{1}{B}: Regenerate target Zombie.',
          zone: 'battlefield',
          power: '4',
          toughness: '4',
        },
      },
      {
        id: 'lim_dul_victim_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        counters: {},
        basePower: 4,
        baseToughness: 2,
        card: {
          id: 'lim_dul_victim_card_1',
          name: 'Fallen Ogre',
          type_line: 'Creature - Ogre Warrior',
          oracle_text: '',
          zone: 'battlefield',
          power: '4',
          toughness: '2',
        },
      },
    ];
    (game.state as any).zones = {
      [controllerId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
      [opponentId]: {
        hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0,
      },
    };

    expect(movePermanentToGraveyard(game as any, 'lim_dul_victim_1')).toBe(true);
    expect((game.state as any).stack[0]).toMatchObject({
      source: 'lim_dul_1',
      boundGraveyardCardId: 'lim_dul_victim_card_1',
      battlefieldGrantedTypes: ['Zombie'],
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) => (step as any).optionalPaymentPrompt === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.optionalPaymentManaCost).toBe('{1}{b}');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(controllerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: paymentStep.id,
      selections: 'pay_mana',
    });

    expect((game.state as any).manaPool[controllerId].black).toBe(0);
    expect((game.state as any).manaPool[controllerId].colorless).toBe(0);

    const returnedPermanent = ((game.state as any).battlefield || []).find(
      (perm: any) => String(perm?.card?.id || '') === 'lim_dul_victim_card_1',
    );
    expect(returnedPermanent).toMatchObject({
      controller: controllerId,
      owner: opponentId,
    });
    expect(String(returnedPermanent?.card?.type_line || '').toLowerCase()).toContain('ogre');
    expect(String(returnedPermanent?.card?.type_line || '').toLowerCase()).toContain('zombie');
  });
});