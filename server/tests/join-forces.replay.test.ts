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
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: {
      sockets: new Map(),
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

function seedJoinForcesSpell(game: any, gameId: string, cardName: string) {
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).turnOrder = ['p1', 'p2'];
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).turnDirection = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).zones = {
    p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
  };
  (game.state as any).battlefield = [
    { id: 'plains_1', controller: 'p1', owner: 'p1', tapped: false, card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' } },
    { id: 'island_1', controller: 'p2', owner: 'p2', tapped: false, card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' } },
  ];
  (game.state as any).stack = [
    {
      id: `${gameId}_spell_1`,
      type: 'spell',
      controller: 'p1',
      card: {
        id: `${gameId}_card_1`,
        name: cardName,
        type_line: 'Sorcery',
        oracle_text: `Join forces — Starting with you, each player may pay any amount of mana. ${cardName === 'Collective Voyage' ? 'Each player may search their library for up to X basic land cards, put them onto the battlefield tapped, then shuffle.' : 'Each player draws X cards.'}`,
        zone: 'stack',
      },
      targets: [],
    },
  ];
}

describe('Join Forces replay persistence', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    for (const id of [
      'test_join_forces_partial_live',
      'test_join_forces_complete_live',
      'test_join_forces_partial_replay',
      'test_join_forces_collective_replay',
    ]) {
      games.delete(id as any);
      ResolutionQueueManager.removeQueue(id);
    }
  });

  it('replays a persisted Join Forces contribution into pending state', async () => {
    const gameId = 'test_join_forces_partial_live';
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedJoinForcesSpell(game, gameId, 'Minds Aglow');
    game.resolveTopOfStack();

    const initiated = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'joinForcesInitiated') as any;
    expect(initiated).toBeDefined();
    expect(Array.isArray(initiated.payload?.steps)).toBe(true);
    expect(initiated.payload.steps).toHaveLength(2);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const liveQueue = ResolutionQueueManager.getQueue(gameId);
    const p1Step = liveQueue.steps.find((step: any) => step.type === ResolutionStepType.JOIN_FORCES && step.playerId === 'p1');
    expect(p1Step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((p1Step as any).id), selections: 1 });

    const contribution = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'joinForcesContribution') as any;
    expect(contribution).toBeDefined();
    expect(contribution.payload?.contribution).toBe(1);
    expect(contribution.payload?.tappedPermanentIds).toEqual(['plains_1']);

    const replayGame = createInitialGameState('test_join_forces_partial_replay');
    (replayGame.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (replayGame.state as any).turnOrder = ['p1', 'p2'];
    (replayGame.state as any).turnPlayer = 'p1';
    (replayGame.state as any).battlefield = [
      { id: 'plains_1', controller: 'p1', owner: 'p1', tapped: false, card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' } },
      { id: 'island_1', controller: 'p2', owner: 'p2', tapped: false, card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' } },
    ];

    replayGame.applyEvent({ type: 'joinForcesInitiated', ...(initiated.payload || {}) } as any);
    replayGame.applyEvent({ type: 'joinForcesContribution', ...(contribution.payload || {}) } as any);

    const replayQueue = ResolutionQueueManager.getQueue('test_join_forces_partial_replay');
    expect(replayQueue.steps.filter((step: any) => step.type === ResolutionStepType.JOIN_FORCES)).toHaveLength(1);
    expect(replayQueue.steps[0]?.playerId).toBe('p2');
    expect((replayGame.state as any).battlefield.find((perm: any) => perm.id === 'plains_1')?.tapped).toBe(true);
    expect((replayGame.state as any).joinForcesContributions?.['Minds Aglow']?.total).toBe(1);
    expect((replayGame.state as any).joinForcesContributions?.['Minds Aglow']?.byPlayer?.p1).toBe(1);
  });

  it('replays Join Forces completion for Minds Aglow card draw', () => {
    const replayGame = createInitialGameState('test_join_forces_collective_replay');
    (replayGame.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (replayGame.state as any).turnOrder = ['p1', 'p2'];
    (replayGame.state as any).turnPlayer = 'p1';
    (replayGame.state as any).zones = {
      p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (replayGame.state as any).battlefield = [
      { id: 'plains_1', controller: 'p1', owner: 'p1', tapped: false, card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' } },
      { id: 'island_1', controller: 'p2', owner: 'p2', tapped: false, card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' } },
    ];
    replayGame.importDeckResolved('p1' as any, [
      { id: 'p1_draw_1', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
      { id: 'p1_draw_2', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    ] as any);
    replayGame.importDeckResolved('p2' as any, [
      { id: 'p2_draw_1', name: 'Swamp', type_line: 'Basic Land — Swamp', oracle_text: '' },
      { id: 'p2_draw_2', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '' },
    ] as any);

    replayGame.applyEvent({
      type: 'joinForcesInitiated',
      cardName: 'Minds Aglow',
      initiator: 'p1',
      steps: [
        {
          id: 'jf_step_p1',
          type: ResolutionStepType.JOIN_FORCES,
          playerId: 'p1',
          description: 'Minds Aglow: You may pay any amount of mana to contribute to this effect',
          mandatory: false,
          sourceId: 'spell_1',
          sourceName: 'Minds Aglow',
          cardName: 'Minds Aglow',
          effectDescription: 'Each player draws X cards.',
          initiator: 'p1',
          availableMana: 1,
          isInitiator: true,
        },
        {
          id: 'jf_step_p2',
          type: ResolutionStepType.JOIN_FORCES,
          playerId: 'p2',
          description: 'Minds Aglow: You may pay any amount of mana to contribute to this effect',
          mandatory: false,
          sourceId: 'spell_1',
          sourceName: 'Minds Aglow',
          cardName: 'Minds Aglow',
          effectDescription: 'Each player draws X cards.',
          initiator: 'p1',
          availableMana: 1,
          isInitiator: false,
        },
      ],
    } as any);
    replayGame.applyEvent({
      type: 'joinForcesComplete',
      cardName: 'Minds Aglow',
      initiator: 'p1',
      totalContributions: 2,
      byPlayer: { p1: 1, p2: 1 },
    } as any);

    expect((replayGame.state as any).zones?.p1?.hand?.map((card: any) => card.id)).toEqual(['p1_draw_1', 'p1_draw_2']);
    expect((replayGame.state as any).zones?.p2?.hand?.map((card: any) => card.id)).toEqual(['p2_draw_1', 'p2_draw_2']);
    expect((replayGame.state as any).joinForcesContributions?.['Minds Aglow']).toBeUndefined();
    expect(ResolutionQueueManager.getQueue('test_join_forces_collective_replay').steps.filter((step: any) => step.type === ResolutionStepType.JOIN_FORCES)).toHaveLength(0);
  });

  it('replays Collective Voyage completion by recreating library-search steps', () => {
    const game = createInitialGameState('test_join_forces_collective_replay');
    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    game.importDeckResolved('p1' as any, [
      { id: 'p1_land', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
    ] as any);
    game.importDeckResolved('p2' as any, [
      { id: 'p2_land', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' },
    ] as any);

    game.applyEvent({
      type: 'joinForcesComplete',
      cardName: 'Collective Voyage',
      initiator: 'p1',
      totalContributions: 2,
      byPlayer: { p1: 1, p2: 1 },
    } as any);

    const queue = ResolutionQueueManager.getQueue('test_join_forces_collective_replay');
    const searches = queue.steps.filter((step: any) => step.type === ResolutionStepType.LIBRARY_SEARCH);
    expect(searches).toHaveLength(2);
    expect(searches.every((step: any) => step.sourceName === 'Collective Voyage')).toBe(true);
    expect(searches.every((step: any) => step.maxSelections === 2)).toBe(true);
    expect(searches.every((step: any) => step.entersTapped === true)).toBe(true);
  });
});