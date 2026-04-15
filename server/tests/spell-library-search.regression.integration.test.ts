import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
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
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('spell library search regressions', () => {
  const gameId = 'test_spell_library_search_regressions';
  const playerId = 'p1';

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

  it('filters Skyshroud Claim to Forests and puts both selected lands onto the battlefield', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 4,
      },
    };
    (game.state as any).battlefield = [];
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'forest_dual', name: 'Highland Forest', type_line: 'Snow Land — Forest Mountain', oracle_text: '', image_uris: { normal: 'forest_dual.png' } },
        { id: 'plains_only', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        { id: 'forest_basic', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'spell_c', name: 'Cultivate', type_line: 'Sorcery', oracle_text: '', image_uris: { normal: 'cultivate.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'skyshroud_claim_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'skyshroud_claim_1',
          name: 'Skyshroud Claim',
          type_line: 'Sorcery',
          oracle_text: 'Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.',
          mana_cost: '{3}{G}',
        },
        targets: [],
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as PlayerID).find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(step).toBeDefined();
    expect(step.filter).toEqual({ subtypes: ['forest'] });
    expect((step.availableCards || []).map((card: any) => card.id)).toEqual(['forest_dual', 'forest_basic']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['forest_dual', 'forest_basic'],
    });

    expect(emitted.filter((entry) => entry.event === 'error')).toEqual([]);
    const resolvedEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent?.payload?.selectedCardIds).toEqual(['forest_dual', 'forest_basic']);
    expect(resolvedEvent?.payload?.destination).toBe('battlefield');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.map((permanent: any) => permanent?.card?.id)).toEqual(['forest_dual', 'forest_basic']);
    expect(battlefield.every((permanent: any) => permanent?.tapped === false)).toBe(true);
    expect((((game as any).libraries.get(playerId) || []).map((card: any) => card.id)).sort()).toEqual(['plains_only', 'spell_c']);
  });

  it('resolves Abundant Harvest land choice by revealing to the first matching land and putting it into hand', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 3,
      },
    };
    (game.state as any).battlefield = [];
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'spell_top', name: 'Cultivate', type_line: 'Sorcery', oracle_text: '', image_uris: { normal: 'spell_top.png' } },
        { id: 'forest_hit', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest_hit.png' } },
        { id: 'spell_bottom', name: 'Harmonize', type_line: 'Sorcery', oracle_text: '', image_uris: { normal: 'spell_bottom.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'abundant_harvest_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'abundant_harvest_1',
          name: 'Abundant Harvest',
          type_line: 'Sorcery',
          oracle_text: 'Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and the rest on the bottom of your library in a random order.',
          mana_cost: '{G}',
          abundantChoice: 'land',
        },
        targets: { abundantChoice: 'land' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    resolveTopOfStack(game as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as PlayerID).find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(step).toBeDefined();
    expect((step.availableCards || []).map((card: any) => card.id)).toEqual(['forest_hit']);
    expect((step.nonSelectableCards || []).map((card: any) => card.id)).toEqual(['spell_top']);
    expect((step.revealedCards || []).map((card: any) => card.id)).toEqual(['spell_top', 'forest_hit']);
    expect(step.destination).toBe('hand');
    expect(step.remainderDestination).toBe('bottom');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['forest_hit'],
    });

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand.map((card: any) => card.id)).toEqual(['forest_hit']);
    expect(((game as any).libraries.get(playerId) || []).map((card: any) => card.id)).toEqual(['spell_bottom', 'spell_top']);

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent?.payload?.selectedCardIds).toEqual(['forest_hit']);
  });

  it('does not treat landcycling reminder text on a resolved spell as a tutor effect', () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 2,
      },
    };
    (game.state as any).battlefield = [];
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'basic_forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'spell_bottom', name: 'Harmonize', type_line: 'Sorcery', oracle_text: '', image_uris: { normal: 'harmonize.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'sylvan_reclamation_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'sylvan_reclamation_1',
          name: 'Sylvan Reclamation',
          type_line: 'Instant',
          oracle_text: 'Exile up to two target artifacts and/or enchantments.\nBasic landcycling {2} ({2}, Discard this card: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.)',
          mana_cost: '{3}{G}{W}',
        },
        targets: [],
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);

    resolveTopOfStack(game as any, io as any, gameId);

    const searchSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as PlayerID)
      .filter((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH);

    expect(searchSteps).toEqual([]);
    expect(((game as any).libraries.get(playerId) || []).map((card: any) => card.id)).toEqual(['basic_forest', 'spell_bottom']);
  });

  it('queues follow-up bottom-order prompts directly after library search resolution without pending staging', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 4,
      },
    };
    (game.state as any).battlefield = [];
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'chosen_card', name: 'Chosen Card', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'chosen.png' } },
        { id: 'rest_1', name: 'Rest 1', type_line: 'Instant', oracle_text: '', image_uris: { normal: 'rest1.png' } },
        { id: 'rest_2', name: 'Rest 2', type_line: 'Sorcery', oracle_text: '', image_uris: { normal: 'rest2.png' } },
        { id: 'base_1', name: 'Base 1', type_line: 'Land', oracle_text: '', image_uris: { normal: 'base1.png' } },
      ]],
    ]);

    const queuedSearch = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId,
      description: 'Impulse Variant: Choose a card to put into your hand',
      mandatory: false,
      sourceId: 'impulse_like_source',
      sourceName: 'Impulse Variant',
      availableCards: [
        { id: 'chosen_card', name: 'Chosen Card', type_line: 'Instant', image_uris: { normal: 'chosen.png' } },
      ],
      nonSelectableCards: [
        { id: 'rest_1', name: 'Rest 1', type_line: 'Instant', image_uris: { normal: 'rest1.png' } },
        { id: 'rest_2', name: 'Rest 2', type_line: 'Sorcery', image_uris: { normal: 'rest2.png' } },
      ],
      destination: 'hand',
      shuffleAfter: false,
      remainderDestination: 'bottom',
      remainderRandomOrder: false,
      remainderPlayerChoosesOrder: true,
      persistLibrarySearchResolve: true,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(queuedSearch.id),
      selections: ['chosen_card'],
    });

    const queuedSteps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as PlayerID);
    expect(queuedSteps).toHaveLength(1);
    expect((queuedSteps[0] as any)?.type).toBe(ResolutionStepType.BOTTOM_ORDER);
    expect((queuedSteps[0] as any)?.effectId).toBe('impulse_like_source:rest_1:rest_2');
    expect(((queuedSteps[0] as any)?.cards || []).map((card: any) => card.id)).toEqual(['rest_1', 'rest_2']);
    expect((game.state as any).pendingBottomOrder).toBeUndefined();

    const hand = (game.state as any).zones?.[playerId]?.hand || [];
    expect(hand.map((card: any) => card.id)).toEqual(['chosen_card']);
    expect(((game as any).libraries.get(playerId) || []).map((card: any) => card.id)).toEqual(['base_1']);

    const resolvedEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'librarySearchResolve') as any;
    expect(resolvedEvent).toBeDefined();
    expect(resolvedEvent.payload?.selectedCardIds).toEqual(['chosen_card']);
    expect(resolvedEvent.payload?.pendingBottomOrder).toBeUndefined();

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload).toMatchObject({
      playerId,
      sourceId: 'impulse_like_source',
      queuedResolutionStep: {
        type: ResolutionStepType.BOTTOM_ORDER,
        playerId,
        effectId: 'impulse_like_source:rest_1:rest_2',
      },
    });
  });
});