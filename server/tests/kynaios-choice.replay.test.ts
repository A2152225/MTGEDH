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

function seedKynaiosQueue(game: any, gameId: string) {
  const batchId = 'kynaios_batch_1';
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
    { id: 'p3', name: 'P3', spectator: false, life: 40 },
  ];
  (game.state as any).turnOrder = ['p1', 'p2', 'p3'];
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).activePlayer = 'p1';
  (game.state as any).pendingDraws = { p1: 1 };
  (game.state as any).zones = {
    p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    p2: { hand: [{ id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains', zone: 'hand' }], handCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    p3: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
  };
  (game.state as any).battlefield = [];

  ResolutionQueueManager.addStepsWithAPNAP(gameId, [
    {
      type: ResolutionStepType.KYNAIOS_CHOICE,
      playerId: 'p1',
      description: 'Kynaios choice P1',
      mandatory: false,
      sourceName: 'Kynaios and Tiro of Meletis',
      kynaiosBatchId: batchId,
      isController: true,
      sourceController: 'p1',
      canPlayLand: false,
      landsInHand: [],
      options: ['play_land', 'decline'],
      landPlayOrFallbackIsController: true,
      landPlayOrFallbackSourceController: 'p1',
      landPlayOrFallbackCanPlayLand: false,
      landPlayOrFallbackLandsInHand: [],
      landPlayOrFallbackOptions: ['play_land', 'decline'],
    },
    {
      type: ResolutionStepType.KYNAIOS_CHOICE,
      playerId: 'p2',
      description: 'Kynaios choice P2',
      mandatory: false,
      sourceName: 'Kynaios and Tiro of Meletis',
      kynaiosBatchId: batchId,
      isController: false,
      sourceController: 'p1',
      canPlayLand: true,
      landsInHand: [{ id: 'plains_1', name: 'Plains' }],
      options: ['play_land', 'draw_card'],
      landPlayOrFallbackIsController: false,
      landPlayOrFallbackSourceController: 'p1',
      landPlayOrFallbackCanPlayLand: true,
      landPlayOrFallbackLandsInHand: [{ id: 'plains_1', name: 'Plains' }],
      landPlayOrFallbackOptions: ['play_land', 'draw_card'],
    },
    {
      type: ResolutionStepType.KYNAIOS_CHOICE,
      playerId: 'p3',
      description: 'Kynaios choice P3',
      mandatory: false,
      sourceName: 'Kynaios and Tiro of Meletis',
      kynaiosBatchId: batchId,
      isController: false,
      sourceController: 'p1',
      canPlayLand: false,
      landsInHand: [],
      options: ['play_land', 'draw_card'],
      landPlayOrFallbackIsController: false,
      landPlayOrFallbackSourceController: 'p1',
      landPlayOrFallbackCanPlayLand: false,
      landPlayOrFallbackLandsInHand: [],
      landPlayOrFallbackOptions: ['play_land', 'draw_card'],
    },
  ], ['p1', 'p2', 'p3'], 'p1');

  return batchId;
}

describe('Kynaios choice replay persistence', () => {
  const gameId = 'test_kynaios_choice_replay_live';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.removeQueue('test_kynaios_choice_replay_partial');
    ResolutionQueueManager.removeQueue('test_kynaios_choice_replay_complete');
    games.delete(gameId as any);
  });

  it('replays a persisted Kynaios land-play response into the pending queue state', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedKynaiosQueue(game, gameId);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const steps = queue.steps.filter((step: any) => step.type === ResolutionStepType.KYNAIOS_CHOICE);
    const initiatedPayload = {
      batchId: 'kynaios_batch_1',
      sourceName: 'Kynaios and Tiro of Meletis',
      sourceController: 'p1',
      steps: steps.map((step: any) => ({
        id: String(step.id),
        type: String(step.type),
        playerId: String(step.playerId),
        description: String(step.description || ''),
        mandatory: step.mandatory !== false,
        sourceId: step.sourceId ? String(step.sourceId) : undefined,
        sourceName: step.sourceName ? String(step.sourceName) : undefined,
        sourceImage: step.sourceImage,
        kynaiosBatchId: String(step.kynaiosBatchId || ''),
        isController: step.isController === true,
        sourceController: step.sourceController ? String(step.sourceController) : undefined,
        canPlayLand: step.canPlayLand !== false,
        landsInHand: Array.isArray(step.landsInHand) ? step.landsInHand.map((card: any) => ({ id: String(card.id), name: String(card.name), imageUrl: card.imageUrl })) : [],
        options: Array.isArray(step.options) ? step.options.map((option: any) => String(option)) : [],
        landPlayOrFallbackIsController: step.landPlayOrFallbackIsController === true,
        landPlayOrFallbackSourceController: step.landPlayOrFallbackSourceController ? String(step.landPlayOrFallbackSourceController) : undefined,
        landPlayOrFallbackCanPlayLand: step.landPlayOrFallbackCanPlayLand !== false,
        landPlayOrFallbackLandsInHand: Array.isArray(step.landPlayOrFallbackLandsInHand) ? step.landPlayOrFallbackLandsInHand.map((card: any) => ({ id: String(card.id), name: String(card.name), imageUrl: card.imageUrl })) : [],
        landPlayOrFallbackOptions: Array.isArray(step.landPlayOrFallbackOptions) ? step.landPlayOrFallbackOptions.map((option: any) => String(option)) : [],
      })),
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p2', emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const p2Step = steps.find((step: any) => step.playerId === 'p2');
    expect(p2Step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((p2Step as any).id),
      selections: { choice: 'play_land', landCardId: 'plains_1' },
    });

    const responseEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'kynaiosChoiceResponse') as any;
    expect(responseEvent).toBeDefined();
    expect(responseEvent.payload?.choice).toBe('play_land');
    expect(responseEvent.payload?.createdPermanentId).toBeDefined();

    const replayGame = createInitialGameState('test_kynaios_choice_replay_partial');
    (replayGame.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
    ];
    (replayGame.state as any).pendingDraws = { p1: 1 };
    (replayGame.state as any).zones = {
      p1: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      p2: { hand: [{ id: 'plains_1', name: 'Plains', type_line: 'Basic Land — Plains', zone: 'hand' }], handCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      p3: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (replayGame.state as any).battlefield = [];

    replayGame.applyEvent({ type: 'kynaiosChoiceInitiated', ...initiatedPayload } as any);
    replayGame.applyEvent({ type: 'kynaiosChoiceResponse', ...(responseEvent.payload || {}) } as any);

    const replayQueue = ResolutionQueueManager.getQueue('test_kynaios_choice_replay_partial');
    const pendingSteps = replayQueue.steps.filter((step: any) => step.type === ResolutionStepType.KYNAIOS_CHOICE);
    expect(pendingSteps).toHaveLength(2);
    expect(((replayGame.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual([responseEvent.payload.createdPermanentId]);
    expect((replayGame.state as any).battlefield[0]?.card?.name).toBe('Plains');
    expect((replayGame.state as any).zones.p2.handCount).toBe(0);
    expect((replayGame.state as any).pendingDraws?.p2 || 0).toBe(0);
  });

  it('replays Kynaios batch completion by restoring the delayed opponent draws', () => {
    const replayGame = createInitialGameState('test_kynaios_choice_replay_complete');
    (replayGame.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
      { id: 'p3', name: 'P3', spectator: false, life: 40 },
    ];
    (replayGame.state as any).pendingDraws = { p1: 1 };

    replayGame.applyEvent({
      type: 'kynaiosChoiceComplete',
      batchId: 'kynaios_batch_1',
      sourceController: 'p1',
      sourceName: 'Kynaios and Tiro of Meletis',
      drawnPlayerIds: ['p3'],
    } as any);

    expect((replayGame.state as any).pendingDraws?.p1).toBe(1);
    expect((replayGame.state as any).pendingDraws?.p3).toBe(1);
    expect((replayGame.state as any).pendingDraws?.p2 || 0).toBe(0);
    expect((replayGame.state as any).kynaiosFinalizedBatches?.['kynaios_batch_1']).toBe(true);
  });
});