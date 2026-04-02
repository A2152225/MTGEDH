import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
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

function buildSignetBaseline(playerId: string) {
  return {
    players: [{ id: playerId, name: 'P1', spectator: false, life: 40 }],
    startingLife: 40,
    life: { [playerId]: 40 },
    phase: 'precombatMain',
    turnPlayer: playerId,
    priority: playerId,
    stack: [],
    manaPool: {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    },
    battlefield: [
      {
        id: 'signet_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'signet_card_1',
          name: 'Rakdos Signet',
          type_line: 'Artifact',
          oracle_text: '{1}, {T}: Add {B}{R}.',
        },
      },
    ],
  };
}

describe('mana payment choice selection flow', () => {
  const signetGameId = 'test_mana_payment_choice_signet';
  const spellGameId = 'test_mana_payment_choice_spell';
  const mikokoroGameId = 'test_mana_payment_choice_mikokoro';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(signetGameId);
    ResolutionQueueManager.removeQueue(spellGameId);
    ResolutionQueueManager.removeQueue(mikokoroGameId);
    games.delete(signetGameId as any);
    games.delete(spellGameId as any);
    games.delete(mikokoroGameId as any);
  });

  it('lets a signet activation spend chosen floating mana and keep the rest', async () => {
    createGameIfNotExists(signetGameId, 'commander', 40);
    const game = ensureGame(signetGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign((game.state as any), buildSignetBaseline(playerId));

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, signetGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: signetGameId,
      permanentId: 'signet_1',
      abilityId: 'signet_1-ability-0',
    });

    const paymentStep = ResolutionQueueManager.getQueue(signetGameId).steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.activationPaymentChoice).toBe(true);
    expect(paymentStep.activationPaymentContext).toBe('mana_ability');
    expect(paymentStep.manaCost).toBe('{1}');

    await handlers['submitResolutionResponse']({
      gameId: signetGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:colorless', mana: 'C', count: 1 }],
      },
    });

    const signet = (game.state as any).battlefield.find((entry: any) => entry.id === 'signet_1');
    expect(signet?.tapped).toBe(true);
    expect((game.state as any).manaPool[playerId]).toEqual({
      white: 0,
      blue: 0,
      black: 1,
      red: 2,
      green: 0,
      colorless: 0,
    });

    const persistedEvents = getEvents(signetGameId);
    const activationEvent = [...persistedEvents].reverse().find((event: any) => String(event?.type) === 'activateBattlefieldAbility') as any;
    const manaEvent = [...persistedEvents].reverse().find((event: any) => String(event?.type) === 'activateManaAbility') as any;

    expect(activationEvent?.payload?.permanentId).toBe('signet_1');
    expect(activationEvent?.payload?.paymentManaDelta).toEqual({ colorless: -1 });
    expect(manaEvent?.payload?.permanentId).toBe('signet_1');
    expect(manaEvent?.payload?.manaColor).toBe('MULTI');
    expect(manaEvent?.payload?.addedMana).toEqual({ black: 1, red: 1 });

    const replayGame = createInitialGameState('test_mana_payment_choice_signet_replay');
    Object.assign((replayGame.state as any), buildSignetBaseline(playerId));
    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(activationEvent?.payload || {}) } as any);
    replayGame.applyEvent({ type: 'activateManaAbility', ...(manaEvent?.payload || {}) } as any);

    const replaySignet = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'signet_1');
    expect(replaySignet?.tapped).toBe(true);
    expect((replayGame.state as any).manaPool[playerId]).toEqual({
      white: 0,
      blue: 0,
      black: 1,
      red: 2,
      green: 0,
      colorless: 0,
    });
  });

  it('lets spell payment spend chosen floating mana and preserve colorless mana', async () => {
    createGameIfNotExists(spellGameId, 'commander', 40);
    const game = ensureGame(spellGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
    };
    (game.state as any).zones = {
      [playerId]: {
        hand: [
          {
            id: 'bauble_1',
            name: "Wayfarer's Bauble",
            mana_cost: '{1}',
            manaCost: '{1}',
            type_line: 'Artifact',
            oracle_text: '{2}, {T}, Sacrifice Wayfarer\'s Bauble: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
            image_uris: { small: 'https://example.com/bauble.jpg' },
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, spellGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['requestCastSpell']({ gameId: spellGameId, cardId: 'bauble_1' });

    const paymentStep = ResolutionQueueManager
      .getQueue(spellGameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.manaCost).toBe('{1}');

    await handlers['submitResolutionResponse']({
      gameId: spellGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: '__pool__:red', mana: 'R', count: 1 }],
      },
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.cardId).toBe('bauble_1');

    emitted.length = 0;
    await handlers['completeCastSpell'](continueEvent?.payload);

    const castError = emitted.find((event) => event.event === 'error');
    expect(castError).toBeUndefined();
    expect((game.state as any).manaPool[playerId]).toEqual({
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 1,
    });

    const handIds = (((game.state as any).zones?.[playerId]?.hand) || []).map((card: any) => card.id);
    expect(handIds).not.toContain('bauble_1');

    const stackNames = ((game.state as any).stack || []).map((entry: any) => entry.card?.name || entry.sourceName || entry.id);
    expect(stackNames).toContain("Wayfarer's Bauble");
  });

  it('lets Mikokoro exact-payment pick a single land that produces extra mana from Dictates', async () => {
    createGameIfNotExists(mikokoroGameId, 'commander', 40);
    const game = ensureGame(mikokoroGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, p2: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mikokoro_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'mikokoro_card_1',
          name: 'Mikokoro, Center of the Sea',
          type_line: 'Legendary Land',
          oracle_text: '{T}: Add {C}.\n{2}, {T}: Each player draws a card.',
        },
      },
      {
        id: 'island_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'island_card_1',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '({T}: Add {U}.)',
        },
      },
      {
        id: 'island_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'island_card_2',
          name: 'Island',
          type_line: 'Basic Land — Island',
          oracle_text: '({T}: Add {U}.)',
        },
      },
      {
        id: 'dictate_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'dictate_card_1',
          name: 'Dictate of Karametra',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
        },
      },
      {
        id: 'dictate_2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'dictate_card_2',
          name: 'Dictate of Karametra',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, mikokoroGameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId: mikokoroGameId,
      permanentId: 'mikokoro_1',
      abilityId: 'mikokoro_1-ability-1',
    });

    const paymentStep = ResolutionQueueManager.getQueue(mikokoroGameId).steps[0] as any;
    expect(paymentStep.type).toBe('mana_payment_choice');
    expect(paymentStep.activationPaymentChoice).toBe(true);
    expect(paymentStep.activationPaymentContext).toBe('battlefield_group_draw');
    expect(paymentStep.manaCost).toBe('{2}');

    await handlers['submitResolutionResponse']({
      gameId: mikokoroGameId,
      stepId: String(paymentStep.id),
      selections: {
        payment: [{ permanentId: 'island_1', mana: 'U', count: 2 }],
      },
    });

    const mikokoro = (game.state as any).battlefield.find((entry: any) => entry.id === 'mikokoro_1');
    const island1 = (game.state as any).battlefield.find((entry: any) => entry.id === 'island_1');
    const island2 = (game.state as any).battlefield.find((entry: any) => entry.id === 'island_2');
    expect(mikokoro?.tapped).toBe(true);
    expect(island1?.tapped).toBe(true);
    expect(island2?.tapped).toBe(false);
    expect((game.state as any).manaPool[playerId]).toEqual({
      white: 0,
      blue: 1,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    expect(((game.state as any).stack || []).some((entry: any) => String(entry?.sourceName || '') === 'Mikokoro, Center of the Sea')).toBe(true);

    const persistedEvents = getEvents(mikokoroGameId);
    const activationEvent = [...persistedEvents].reverse().find((event: any) => String(event?.type) === 'activateBattlefieldAbility') as any;
    expect(activationEvent?.payload?.permanentId).toBe('mikokoro_1');
    expect(activationEvent?.payload?.paymentManaDelta).toEqual({ blue: 1 });

    const replayGame = createInitialGameState('test_mana_payment_choice_mikokoro_replay');
    Object.assign((replayGame.state as any), {
      players: [
        { id: playerId, name: 'P1', spectator: false, life: 40 },
        { id: 'p2', name: 'P2', spectator: false, life: 40 },
      ],
      startingLife: 40,
      life: { [playerId]: 40, p2: 40 },
      phase: 'precombatMain',
      turnPlayer: playerId,
      priority: playerId,
      stack: [],
      manaPool: {
        [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      battlefield: [
        {
          id: 'mikokoro_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          card: {
            id: 'mikokoro_card_1',
            name: 'Mikokoro, Center of the Sea',
            type_line: 'Legendary Land',
            oracle_text: '{T}: Add {C}.\n{2}, {T}: Each player draws a card.',
          },
        },
        {
          id: 'island_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          card: {
            id: 'island_card_1',
            name: 'Island',
            type_line: 'Basic Land — Island',
            oracle_text: '({T}: Add {U}.)',
          },
        },
        {
          id: 'island_2',
          controller: playerId,
          owner: playerId,
          tapped: false,
          card: {
            id: 'island_card_2',
            name: 'Island',
            type_line: 'Basic Land — Island',
            oracle_text: '({T}: Add {U}.)',
          },
        },
        {
          id: 'dictate_1',
          controller: playerId,
          owner: playerId,
          tapped: false,
          card: {
            id: 'dictate_card_1',
            name: 'Dictate of Karametra',
            type_line: 'Enchantment',
            oracle_text: 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
          },
        },
        {
          id: 'dictate_2',
          controller: playerId,
          owner: playerId,
          tapped: false,
          card: {
            id: 'dictate_card_2',
            name: 'Dictate of Karametra',
            type_line: 'Enchantment',
            oracle_text: 'Whenever a player taps a land for mana, that player adds one mana of any type that land produced.',
          },
        },
      ],
    });

    replayGame.applyEvent({ type: 'activateBattlefieldAbility', ...(activationEvent?.payload || {}) } as any);

    const replayMikokoro = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'mikokoro_1');
    const replayIsland1 = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'island_1');
    const replayIsland2 = (replayGame.state as any).battlefield.find((entry: any) => entry.id === 'island_2');
    expect(replayMikokoro?.tapped).toBe(true);
    expect(replayIsland1?.tapped).toBe(true);
    expect(replayIsland2?.tapped).toBe(false);
    expect((replayGame.state as any).manaPool[playerId]).toEqual({
      white: 0,
      blue: 1,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    });
    expect(((replayGame.state as any).stack || []).some((entry: any) => String(entry?.sourceName || '') === 'Mikokoro, Center of the Sea')).toBe(true);
  });
});