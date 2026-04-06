import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
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

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
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
          oracle_text: 'Whenever a creature you control dies, return target creature card from your graveyard to your hand.',
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
            id: 'gy_creature_1',
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
        graveyardCount: 2,
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
    });

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe('graveyard_selection');
    expect(step.targetPlayerId).toBe(playerId);
    expect(step.destination).toBe('hand');
    expect(step.validTargets.map((target: any) => String(target.id)).sort()).toEqual(['gy_creature_1', 'victim_card_1']);

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
      selections: ['gy_creature_1'],
    });

    const playerZones = (game.state as any).zones?.[playerId];
    expect((playerZones?.graveyard || []).some((card: any) => String(card?.id || '') === 'gy_creature_1')).toBe(false);
    expect((playerZones?.hand || []).some((card: any) => String(card?.id || '') === 'gy_creature_1')).toBe(true);

    const confirmEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'confirmGraveyardTargets') as any;
    expect(confirmEvent?.payload?.selectedCardIds).toEqual(['gy_creature_1']);
    expect(String(confirmEvent?.payload?.destination || '')).toBe('hand');
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
});