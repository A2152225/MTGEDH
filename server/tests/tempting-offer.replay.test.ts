import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
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

function seedTemptingOfferSpell(game: any, gameId: string, cardName: string) {
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
    { id: 'p3', name: 'P3', spectator: false, life: 40 },
  ];
  (game.state as any).turnOrder = ['p1', 'p2', 'p3'];
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).turnDirection = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).zones = {
    p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    p3: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };
  (game.state as any).battlefield = [];
  (game.state as any).stack = [
    {
      id: `${gameId}_spell_1`,
      type: 'spell',
      controller: 'p1',
      card: {
        id: `${gameId}_card_1`,
        name: cardName,
        type_line: 'Sorcery',
        oracle_text: cardName === 'Tempt with Discovery'
          ? 'Tempting offer — Each opponent may search their library for a land card. For each opponent who searches a library this way, search your library for a land card and put it onto the battlefield. Then each player who searched a library this way shuffles.'
          : 'Tempting offer — Each opponent may accept the offer.',
        zone: 'stack',
      },
      targets: [],
    },
  ];
}

describe('Tempting Offer replay persistence', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    for (const id of [
      'test_tempting_offer_partial_live',
      'test_tempting_offer_partial_replay',
      'test_tempting_offer_complete_replay',
    ]) {
      games.delete(id as any);
      ResolutionQueueManager.removeQueue(id);
    }
  });

  it('replays a persisted Tempting Offer response into pending state', async () => {
    const gameId = 'test_tempting_offer_partial_live';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedTemptingOfferSpell(game, gameId, 'Tempt with Discovery');
    game.resolveTopOfStack();

    const initiated = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'temptingOfferInitiated') as any;
    expect(initiated).toBeDefined();
    expect(Array.isArray(initiated.payload?.steps)).toBe(true);
    expect(initiated.payload.steps).toHaveLength(2);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p2', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const liveQueue = ResolutionQueueManager.getQueue(gameId);
    const p2Step = liveQueue.steps.find((step: any) => step.type === ResolutionStepType.TEMPTING_OFFER && step.playerId === 'p2');
    expect(p2Step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((p2Step as any).id), selections: true });

    const responseEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'temptingOfferResponse') as any;
    expect(responseEvent).toBeDefined();
    expect(responseEvent.payload?.accepted).toBe(true);
    expect(responseEvent.payload?.playerId).toBe('p2');

    const replayGame = createInitialGameState('test_tempting_offer_partial_replay');
    (replayGame.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
    ];
    replayGame.applyEvent({ type: 'temptingOfferInitiated', ...(initiated.payload || {}) } as any);
    replayGame.applyEvent({ type: 'temptingOfferResponse', ...(responseEvent.payload || {}) } as any);

    const replayQueue = ResolutionQueueManager.getQueue('test_tempting_offer_partial_replay');
    expect(replayQueue.steps.filter((step: any) => step.type === ResolutionStepType.TEMPTING_OFFER)).toHaveLength(1);
    expect(replayQueue.steps[0]?.playerId).toBe('p3');
    expect((replayGame.state as any).temptingOfferResponses?.['Tempt with Discovery']?.acceptedBy).toEqual(['p2']);
  });

  it('replays Tempt with Discovery completion by recreating library-search steps', () => {
    const game = createInitialGameState('test_tempting_offer_complete_replay');
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
    ];
    game.importDeckResolved('p1' as any, [{ id: 'p1_land', name: 'Temple Garden', type_line: 'Land — Forest Plains', oracle_text: '' }] as any);
    game.importDeckResolved('p2' as any, [{ id: 'p2_land', name: 'Breeding Pool', type_line: 'Land — Forest Island', oracle_text: '' }] as any);
    game.importDeckResolved('p3' as any, [{ id: 'p3_land', name: 'Stomping Ground', type_line: 'Land — Mountain Forest', oracle_text: '' }] as any);

    game.applyEvent({
      type: 'temptingOfferInitiated',
      cardName: 'Tempt with Discovery',
      initiator: 'p1',
      steps: [
        { id: 'tempt_p2', type: ResolutionStepType.TEMPTING_OFFER, playerId: 'p2', description: 'Tempt with Discovery: Do you accept the tempting offer?', mandatory: false, sourceId: 'spell_1', sourceName: 'Tempt with Discovery', cardName: 'Tempt with Discovery', initiator: 'p1', isOpponent: true },
        { id: 'tempt_p3', type: ResolutionStepType.TEMPTING_OFFER, playerId: 'p3', description: 'Tempt with Discovery: Do you accept the tempting offer?', mandatory: false, sourceId: 'spell_1', sourceName: 'Tempt with Discovery', cardName: 'Tempt with Discovery', initiator: 'p1', isOpponent: true },
      ],
    } as any);
    game.applyEvent({
      type: 'temptingOfferComplete',
      cardName: 'Tempt with Discovery',
      initiator: 'p1',
      acceptedBy: ['p2'],
      initiatorBonusCount: 2,
    } as any);

    const queue = ResolutionQueueManager.getQueue('test_tempting_offer_complete_replay');
    const searches = queue.steps.filter((step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searches).toHaveLength(2);
    expect(searches.every((step: any) => step.sourceName === 'Tempt with Discovery')).toBe(true);
    const p1Search = searches.find((step: any) => step.playerId === 'p1');
    const p2Search = searches.find((step: any) => step.playerId === 'p2');
    expect(p1Search?.maxSelections).toBe(2);
    expect(p2Search?.maxSelections).toBe(1);
    expect(queue.steps.filter((step: any) => step.type === ResolutionStepType.TEMPTING_OFFER)).toHaveLength(0);
  });

  it('replays Tempt with Bunnies completion using persisted token ids', () => {
    const game = createInitialGameState('test_tempting_offer_complete_replay');
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [];

    game.applyEvent({
      type: 'temptingOfferComplete',
      cardName: 'Tempt with Bunnies',
      initiator: 'p1',
      acceptedBy: ['p2'],
      initiatorBonusCount: 2,
      createdPermanentIdsByPlayer: {
        p1: ['bunny_a', 'bunny_b'],
        p2: ['bunny_c'],
      },
    } as any);

    const tokenIds = ((game.state as any).battlefield || []).map((perm: any) => perm.id);
    expect(tokenIds).toEqual(['bunny_a', 'bunny_b', 'bunny_c']);
    expect(((game.state as any).battlefield || []).every((perm: any) => perm.card?.name === 'Rabbit')).toBe(true);
  });
});