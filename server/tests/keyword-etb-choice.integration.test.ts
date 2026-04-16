import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { executeTriggerEffect, resolveTopOfStack, triggerETBEffectsForPermanent } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers, sanitizeStepForClient } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import type { PlayerID } from '../../shared/src/index.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

describe('queue-backed keyword ETB choices (integration)', () => {
  const gameId = 'keyword_etb_choice_integration';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

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

  it('queues a riot choice step and exposes option fields to clients', () => {
    const ctx: any = {
      gameId,
      state: {
        players: [{ id: playerId, name: 'P1' }, { id: opponentId, name: 'P2' }],
        startingLife: 40,
        life: { [playerId]: 40, [opponentId]: 40 },
        battlefield: [
          {
            id: 'riot_perm',
            controller: playerId,
            summoningSickness: true,
            card: {
              name: 'Riot Test Creature',
              type_line: 'Creature — Beast',
              oracle_text: 'Riot (This creature enters the battlefield with your choice of a +1/+1 counter or haste.)',
              image_uris: { small: 'https://example.com/riot.jpg' },
            },
          },
        ],
        zones: {
          [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
          [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
        },
      },
      libraries: new Map(),
    };

    executeTriggerEffect(ctx, playerId, 'Riot Test Creature', 'enters the battlefield', {
      sourceName: 'Riot Test Creature',
      source: 'riot_perm',
      permanentId: 'riot_perm',
      triggerType: 'etb',
      card: ctx.state.battlefield[0].card,
    });

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.RIOT_CHOICE
    ) as any;

    expect(step).toBeDefined();
    expect(Array.isArray((ctx.state as any).pendingKeywordChoice) ? (ctx.state as any).pendingKeywordChoice : []).toHaveLength(0);

    const sanitized = sanitizeStepForClient(gameId, step as any);
    expect(sanitized.type).toBe('riot_choice');
    expect(sanitized.options).toEqual([
      { id: 'counter', name: '+1/+1 counter', label: '+1/+1 counter' },
      { id: 'haste', name: 'Haste', label: 'Haste' },
    ]);
    expect(sanitized.minSelections).toBe(1);
    expect(sanitized.maxSelections).toBe(1);
    expect(sanitized.permanentId).toBe('riot_perm');
  });

  it('queues a riot choice when a permanent enters through triggerETBEffectsForPermanent', () => {
    const game = seedGame(gameId, playerId, opponentId);
    const riotPermanent = {
      id: 'riot_perm_live',
      controller: playerId,
      summoningSickness: true,
      counters: {},
      basePower: 2,
      baseToughness: 2,
      card: {
        name: 'Riot Test Creature',
        type_line: 'Creature — Beast',
        oracle_text: 'Riot (This creature enters the battlefield with your choice of a +1/+1 counter or haste.)',
        power: '2',
        toughness: '2',
      },
    };

    (game.state as any).battlefield.push(riotPermanent);
    triggerETBEffectsForPermanent(game as any, riotPermanent, playerId);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.RIOT_CHOICE
    ) as any;

    expect(step).toBeDefined();
    expect(step.permanentId).toBe('riot_perm_live');
  });

  it('queues a riot choice when a creature spell resolves onto the battlefield', () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).stack.push({
      id: 'riot_spell',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'riot_card',
        name: 'Riot Test Creature',
        type_line: 'Creature — Beast',
        oracle_text: 'Riot (This creature enters the battlefield with your choice of a +1/+1 counter or haste.)',
        power: '2',
        toughness: '2',
      },
    });

    resolveTopOfStack(game as any);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield).toHaveLength(1);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.RIOT_CHOICE
    ) as any;

    expect(step).toBeDefined();
    expect(step.permanentId).toBe(String(battlefield[0]?.id || ''));
  });

  it('defers tribute-dependent self ETB triggers until the opponent responds', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).stack.push({
      id: 'tribute_spell',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'tribute_card',
        name: 'Tribute Test Creature',
        type_line: 'Creature — Beast',
        oracle_text: "Tribute 3 (As this creature enters the battlefield, an opponent of your choice may place three +1/+1 counters on it.) When Tribute Test Creature enters the battlefield, if tribute wasn't paid, draw a card.",
        power: '2',
        toughness: '2',
      },
    });

    resolveTopOfStack(game as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    expect(permanent).toBeDefined();

    const tributeStep = ResolutionQueueManager.getStepsForPlayer(gameId, opponentId).find(
      (entry: any) => entry?.type === ResolutionStepType.TRIBUTE_CHOICE
    ) as any;
    expect(tributeStep).toBeDefined();
    expect(tributeStep.value).toBe(3);
    expect(tributeStep.permanentId).toBe(String(permanent?.id || ''));
    expect(
      ((game.state as any).stack || []).some(
        (entry: any) => entry?.type === 'triggered_ability' && String(entry?.source || '') === String(permanent?.id || '')
      )
    ).toBe(false);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(opponentId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(tributeStep.id),
      selections: ['decline'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === permanent.id);
    expect(updatedPermanent?.tributePaid).toBe(false);
    expect(updatedPermanent?.card?.tributePaid).toBe(false);

    const tributeTrigger = ((game.state as any).stack || []).find(
      (entry: any) =>
        entry?.type === 'triggered_ability' &&
        String(entry?.source || '') === String(permanent?.id || '') &&
        /tribute wasn't paid/i.test(String(entry?.description || entry?.effect || ''))
    );
    expect(tributeTrigger).toBeDefined();
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('suppresses tribute-dependent self ETB triggers when tribute is paid', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).stack.push({
      id: 'tribute_spell_paid',
      controller: playerId,
      owner: playerId,
      card: {
        id: 'tribute_card_paid',
        name: 'Tribute Test Creature',
        type_line: 'Creature — Beast',
        oracle_text: "Tribute 3 (As this creature enters the battlefield, an opponent of your choice may place three +1/+1 counters on it.) When Tribute Test Creature enters the battlefield, if tribute wasn't paid, draw a card.",
        power: '2',
        toughness: '2',
      },
    });

    resolveTopOfStack(game as any);

    const permanent = ((game.state as any).battlefield || [])[0];
    const tributeStep = ResolutionQueueManager.getStepsForPlayer(gameId, opponentId).find(
      (entry: any) => entry?.type === ResolutionStepType.TRIBUTE_CHOICE
    ) as any;
    expect(tributeStep).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(opponentId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(tributeStep.id),
      selections: ['pay'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === permanent.id);
    expect(updatedPermanent?.tributePaid).toBe(true);
    expect(updatedPermanent?.card?.tributePaid).toBe(true);
    expect(updatedPermanent?.counters?.['+1/+1']).toBe(3);
    expect(
      ((game.state as any).stack || []).some(
        (entry: any) =>
          entry?.type === 'triggered_ability' &&
          String(entry?.source || '') === String(permanent?.id || '') &&
          /tribute wasn't paid/i.test(String(entry?.description || entry?.effect || ''))
      )
    ).toBe(false);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('defers tribute-dependent ETB triggers for library-search battlefield entry until the opponent responds', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).zones[playerId].libraryCount = 1;
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'tribute_library_card',
          name: 'Tribute Test Creature',
          type_line: 'Creature — Beast',
          oracle_text: "Tribute 3 (As this creature enters the battlefield, an opponent of your choice may place three +1/+1 counters on it.) When Tribute Test Creature enters the battlefield, if tribute wasn't paid, draw a card.",
          power: '2',
          toughness: '2',
        },
      ]],
    ]);

    const searchStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId,
      description: 'Search your library for a creature card and put it onto the battlefield.',
      searchCriteria: 'Search your library for a creature card and put it onto the battlefield.',
      mandatory: true,
      sourceName: 'Tribute Search Effect',
      sourceId: 'tribute_search_source',
      minSelections: 1,
      maxSelections: 1,
      destination: 'battlefield',
      shuffleAfter: false,
      filter: { types: ['creature'] },
      availableCards: [
        {
          id: 'tribute_library_card',
          name: 'Tribute Test Creature',
          type_line: 'Creature — Beast',
          oracle_text: "Tribute 3 (As this creature enters the battlefield, an opponent of your choice may place three +1/+1 counters on it.) When Tribute Test Creature enters the battlefield, if tribute wasn't paid, draw a card.",
          power: '2',
          toughness: '2',
        },
      ],
      nonSelectableCards: [],
    } as any) as any;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers: playerHandlers } = createMockSocket(playerId, emitted, gameId);
    const { socket: opponentSocket, handlers: opponentHandlers } = createMockSocket(opponentId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket, opponentSocket]);
    registerResolutionHandlers(io as any, playerSocket as any);
    registerResolutionHandlers(io as any, opponentSocket as any);

    await playerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(searchStep.id),
      selections: ['tribute_library_card'],
    });

    const permanent = ((game.state as any).battlefield || []).find(
      (entry: any) => String(entry?.card?.id || '') === 'tribute_library_card'
    );
    expect(permanent).toBeDefined();

    const tributeStep = ResolutionQueueManager.getStepsForPlayer(gameId, opponentId).find(
      (entry: any) => entry?.type === ResolutionStepType.TRIBUTE_CHOICE
    ) as any;
    expect(tributeStep).toBeDefined();
    expect(tributeStep.permanentId).toBe(String(permanent?.id || ''));
    expect(tributeStep.value).toBe(3);
    expect(
      ((game.state as any).stack || []).some(
        (entry: any) =>
          entry?.type === 'triggered_ability' &&
          String(entry?.source || '') === String(permanent?.id || '') &&
          /tribute wasn't paid/i.test(String(entry?.description || entry?.effect || ''))
      )
    ).toBe(false);

    await opponentHandlers.submitResolutionResponse({
      gameId,
      stepId: String(tributeStep.id),
      selections: ['decline'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === permanent.id);
    expect(updatedPermanent?.tributePaid).toBe(false);
    expect(updatedPermanent?.card?.tributePaid).toBe(false);

    const tributeTrigger = ((game.state as any).stack || []).find(
      (entry: any) =>
        entry?.type === 'triggered_ability' &&
        String(entry?.source || '') === String(permanent?.id || '') &&
        /tribute wasn't paid/i.test(String(entry?.description || entry?.effect || ''))
    );
    expect(tributeTrigger).toBeDefined();
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('suppresses tribute-dependent ETB triggers and adds counters when tribute is paid for library-search battlefield entry', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).zones[playerId].libraryCount = 1;
    (game as any).libraries = new Map([
      [playerId, [
        {
          id: 'tribute_library_card_paid',
          name: 'Tribute Test Creature',
          type_line: 'Creature — Beast',
          oracle_text: "Tribute 3 (As this creature enters the battlefield, an opponent of your choice may place three +1/+1 counters on it.) When Tribute Test Creature enters the battlefield, if tribute wasn't paid, draw a card.",
          power: '2',
          toughness: '2',
        },
      ]],
    ]);

    const searchStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId,
      description: 'Search your library for a creature card and put it onto the battlefield.',
      searchCriteria: 'Search your library for a creature card and put it onto the battlefield.',
      mandatory: true,
      sourceName: 'Tribute Search Effect',
      sourceId: 'tribute_search_source_paid',
      minSelections: 1,
      maxSelections: 1,
      destination: 'battlefield',
      shuffleAfter: false,
      filter: { types: ['creature'] },
      availableCards: [
        {
          id: 'tribute_library_card_paid',
          name: 'Tribute Test Creature',
          type_line: 'Creature — Beast',
          oracle_text: "Tribute 3 (As this creature enters the battlefield, an opponent of your choice may place three +1/+1 counters on it.) When Tribute Test Creature enters the battlefield, if tribute wasn't paid, draw a card.",
          power: '2',
          toughness: '2',
        },
      ],
      nonSelectableCards: [],
    } as any) as any;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: playerSocket, handlers: playerHandlers } = createMockSocket(playerId, emitted, gameId);
    const { socket: opponentSocket, handlers: opponentHandlers } = createMockSocket(opponentId, emitted, gameId);
    const io = createMockIo(emitted, [playerSocket, opponentSocket]);
    registerResolutionHandlers(io as any, playerSocket as any);
    registerResolutionHandlers(io as any, opponentSocket as any);

    await playerHandlers.submitResolutionResponse({
      gameId,
      stepId: String(searchStep.id),
      selections: ['tribute_library_card_paid'],
    });

    const permanent = ((game.state as any).battlefield || []).find(
      (entry: any) => String(entry?.card?.id || '') === 'tribute_library_card_paid'
    );
    expect(permanent).toBeDefined();

    const tributeStep = ResolutionQueueManager.getStepsForPlayer(gameId, opponentId).find(
      (entry: any) => entry?.type === ResolutionStepType.TRIBUTE_CHOICE
    ) as any;
    expect(tributeStep).toBeDefined();

    await opponentHandlers.submitResolutionResponse({
      gameId,
      stepId: String(tributeStep.id),
      selections: ['pay'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === permanent.id);
    expect(updatedPermanent?.tributePaid).toBe(true);
    expect(updatedPermanent?.card?.tributePaid).toBe(true);
    expect(updatedPermanent?.counters?.['+1/+1']).toBe(3);
    expect(
      ((game.state as any).stack || []).some(
        (entry: any) =>
          entry?.type === 'triggered_ability' &&
          String(entry?.source || '') === String(permanent?.id || '') &&
          /tribute wasn't paid/i.test(String(entry?.description || entry?.effect || ''))
      )
    ).toBe(false);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('applies riot counter selections through submitResolutionResponse', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).battlefield.push({
      id: 'riot_perm',
      controller: playerId,
      summoningSickness: true,
      counters: {},
      basePower: 2,
      baseToughness: 2,
      card: {
        name: 'Riot Test Creature',
        type_line: 'Creature — Beast',
        oracle_text: 'Riot (This creature enters the battlefield with your choice of a +1/+1 counter or haste.)',
        power: '2',
        toughness: '2',
      },
    });

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.RIOT_CHOICE,
      playerId,
      description: 'Riot Test Creature: choose +1/+1 counter or haste',
      mandatory: true,
      sourceId: 'riot_perm',
      sourceName: 'Riot Test Creature',
      permanentId: 'riot_perm',
      options: [
        { id: 'counter', label: '+1/+1 counter' },
        { id: 'haste', label: 'Haste' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0] as any;
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['counter'] });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'riot_perm');
    expect(permanent?.counters?.['+1/+1']).toBe(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry.id) === String(step.id))).toBe(false);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('applies unleash selections through submitResolutionResponse', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).battlefield.push({
      id: 'unleash_perm',
      controller: playerId,
      summoningSickness: true,
      counters: {},
      basePower: 2,
      baseToughness: 2,
      card: {
        name: 'Unleash Test Creature',
        type_line: 'Creature — Zombie',
        oracle_text: 'Unleash (You may have this creature enter the battlefield with a +1/+1 counter on it. It can\'t block as long as it has a +1/+1 counter on it.)',
        power: '2',
        toughness: '2',
      },
    });

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.UNLEASH_CHOICE,
      playerId,
      description: 'Unleash Test Creature: choose whether to unleash',
      mandatory: true,
      sourceId: 'unleash_perm',
      sourceName: 'Unleash Test Creature',
      permanentId: 'unleash_perm',
      options: [
        { id: 'counter', label: 'Put a +1/+1 counter on it' },
        { id: 'none', label: 'Do not unleash it' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0] as any;
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['counter'] });

    const permanent = (game.state as any).battlefield.find((entry: any) => entry.id === 'unleash_perm');
    expect(permanent?.counters?.['+1/+1']).toBe(1);
    expect(permanent?.unleashed).toBe(true);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('creates Servo tokens when fabricate chooses tokens', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    (game.state as any).battlefield.push({
      id: 'fabricate_perm',
      controller: playerId,
      summoningSickness: true,
      counters: {},
      basePower: 1,
      baseToughness: 1,
      card: {
        name: 'Fabricate Test Creature',
        type_line: 'Artifact Creature — Vedalken',
        oracle_text: 'Fabricate 2 (When this creature enters the battlefield, put two +1/+1 counters on it or create two 1/1 colorless Servo artifact creature tokens.)',
        power: '1',
        toughness: '1',
      },
    });

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.FABRICATE_CHOICE,
      playerId,
      description: 'Fabricate Test Creature: choose counters or tokens',
      mandatory: true,
      sourceId: 'fabricate_perm',
      sourceName: 'Fabricate Test Creature',
      permanentId: 'fabricate_perm',
      options: [
        { id: 'counters', label: '2 +1/+1 counters' },
        { id: 'tokens', label: '2 Servo tokens' },
      ],
      minSelections: 1,
      maxSelections: 1,
      value: 2,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0] as any;
    await handlers.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['tokens'] });

    const servos = ((game.state as any).battlefield || []).filter(
      (entry: any) => entry?.controller === playerId && String(entry?.card?.name || '') === 'Servo'
    );
    expect(servos).toHaveLength(2);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});