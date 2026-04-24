import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import '../src/state/modules/priority.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('cleanup discard replay (integration)', () => {
  const baseGameId = 'test_cleanup_discard_replay';
  const gameIds = [
    `${baseGameId}_basic`,
    `${baseGameId}_prompt`,
    `${baseGameId}_decline`,
    `${baseGameId}_cast`,
    `${baseGameId}_multi_prompt`,
  ];

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    for (const gameId of gameIds) {
      await resetGame(gameId);
    }
  });

  afterEach(async () => {
    for (const gameId of gameIds) {
      await resetGame(gameId);
    }
  });

  it('persists cleanup discards so reset and replay reconstruct the discarded card', async () => {
    const gameId = `${baseGameId}_basic`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };

    const deck = [
      { id: 'cleanup_card_1', name: 'Cleanup One', type_line: 'Instant', oracle_text: '' },
      { id: 'cleanup_card_2', name: 'Cleanup Two', type_line: 'Sorcery', oracle_text: '' },
      { id: 'cleanup_card_3', name: 'Cleanup Three', type_line: 'Creature - Human', oracle_text: '' },
    ];
    const seedEvents = [
      { type: 'deckImportResolved', payload: { playerId, cards: deck } },
      { type: 'drawCards', payload: { playerId, count: 2 } },
      { type: 'skipToPhase', payload: { targetPhase: 'ending', targetStep: 'CLEANUP' } },
    ];

    let seq = 0;
    for (const event of seedEvents) {
      appendEvent(gameId, seq++, event.type, event.payload);
      game.applyEvent({ type: event.type, ...event.payload } as any);
    }

    const zonesBeforeDiscard = (game.state as any).zones?.[playerId];
    const handBeforeDiscard = Array.isArray(zonesBeforeDiscard?.hand) ? zonesBeforeDiscard.hand : [];
    expect(handBeforeDiscard).toHaveLength(2);
    const discardedCardId = String(handBeforeDiscard[0]?.id || '');
    expect(discardedCardId).not.toBe('');

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      description: 'Discard down to maximum hand size',
      sourceName: 'Cleanup',
      mandatory: true,
      discardCount: 1,
      hand: handBeforeDiscard.map((card: any) => ({ ...card })),
      reason: 'cleanup',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: [discardedCardId],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.hand || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).toContain(discardedCardId);

    const cleanupDiscardEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'cleanupDiscard') as any;
    expect(cleanupDiscardEvent?.payload).toEqual({
      playerId,
      cardIds: [discardedCardId],
    });

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayedZones = (game.state as any).zones?.[playerId];
    expect((replayedZones?.hand || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).toContain(discardedCardId);
  });

  it('queues and replays a madness cast prompt after a cleanup discard', async () => {
    const gameId = `${baseGameId}_prompt`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };

    const deck = [
      {
        id: 'cleanup_madness_card_1',
        name: 'Cleanup Madness',
        type_line: 'Creature - Human',
        oracle_text: 'Madness {R}',
      },
      { id: 'cleanup_support_card_1', name: 'Cleanup Support', type_line: 'Instant', oracle_text: '' },
      { id: 'cleanup_support_card_2', name: 'Cleanup Support Two', type_line: 'Sorcery', oracle_text: '' },
    ];
    const seedEvents = [
      { type: 'deckImportResolved', payload: { playerId, cards: deck } },
      { type: 'drawCards', payload: { playerId, count: 2 } },
      { type: 'skipToPhase', payload: { targetPhase: 'ending', targetStep: 'CLEANUP' } },
    ];

    let seq = 0;
    for (const event of seedEvents) {
      appendEvent(gameId, seq++, event.type, event.payload);
      game.applyEvent({ type: event.type, ...event.payload } as any);
    }

    const zonesBeforeDiscard = (game.state as any).zones?.[playerId];
    const handBeforeDiscard = Array.isArray(zonesBeforeDiscard?.hand) ? zonesBeforeDiscard.hand : [];
    expect(handBeforeDiscard).toHaveLength(2);
    const madnessCard = handBeforeDiscard.find((card: any) => String(card?.oracle_text || '').includes('Madness'));
    const discardedCardId = String(madnessCard?.id || '');
    expect(discardedCardId).toBe('cleanup_madness_card_1');

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      description: 'Discard down to maximum hand size',
      sourceName: 'Cleanup',
      mandatory: true,
      discardCount: 1,
      hand: handBeforeDiscard.map((card: any) => ({ ...card })),
      reason: 'cleanup',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: [discardedCardId],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.hand || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    expect((liveZones?.exile || []).map((card: any) => card.id)).toContain(discardedCardId);
    const queuedPrompt = ResolutionQueueManager.getQueue(gameId);
    expect((queuedPrompt.steps || []).some((candidate: any) => String(candidate?.castFromExileCardId || '') === discardedCardId)).toBe(true);

    const cleanupDiscardEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'cleanupDiscard') as any;
    expect(cleanupDiscardEvent?.payload).toEqual({
      playerId,
      cardIds: [],
      exiledCardIds: [discardedCardId],
    });

    const nextStepEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'nextStep') as any;
    expect(nextStepEvent?.payload?.reason).not.toBe('cleanupDiscardResolved');

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayedZones = (game.state as any).zones?.[playerId];
    expect((replayedZones?.hand || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    expect((replayedZones?.exile || []).map((card: any) => card.id)).toContain(discardedCardId);

    const replayQueue = ResolutionQueueManager.getQueue(gameId);
    expect((replayQueue.steps || []).some((candidate: any) => String(candidate?.castFromExileCardId || '') === discardedCardId)).toBe(true);
  });

  it('resumes cleanup after declining a cleanup-step madness prompt', async () => {
    const gameId = `${baseGameId}_decline`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };

    const deck = [
      {
        id: 'cleanup_decline_madness_card_1',
        name: 'Cleanup Decline Madness',
        type_line: 'Creature - Human',
        oracle_text: 'Madness {R}',
      },
      { id: 'cleanup_decline_support_card_1', name: 'Cleanup Decline Support', type_line: 'Instant', oracle_text: '' },
      { id: 'cleanup_decline_support_card_2', name: 'Cleanup Decline Support Two', type_line: 'Sorcery', oracle_text: '' },
    ];
    const seedEvents = [
      { type: 'deckImportResolved', payload: { playerId, cards: deck } },
      { type: 'drawCards', payload: { playerId, count: 2 } },
      { type: 'skipToPhase', payload: { targetPhase: 'ending', targetStep: 'CLEANUP' } },
    ];

    let seq = 0;
    for (const event of seedEvents) {
      appendEvent(gameId, seq++, event.type, event.payload);
      game.applyEvent({ type: event.type, ...event.payload } as any);
    }

    const zonesBeforeDiscard = (game.state as any).zones?.[playerId];
    const handBeforeDiscard = Array.isArray(zonesBeforeDiscard?.hand) ? zonesBeforeDiscard.hand : [];
    const madnessCard = handBeforeDiscard.find((card: any) => String(card?.oracle_text || '').includes('Madness'));
    const discardedCardId = String(madnessCard?.id || '');
    expect(discardedCardId).toBe('cleanup_decline_madness_card_1');

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      description: 'Discard down to maximum hand size',
      sourceName: 'Cleanup',
      mandatory: true,
      discardCount: 1,
      hand: handBeforeDiscard.map((card: any) => ({ ...card })),
      reason: 'cleanup',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: [discardedCardId],
    });

    const madnessPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => String(candidate?.castFromExileCardId || '') === discardedCardId) as any;
    expect(madnessPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(madnessPrompt.id),
      choiceId: 'decline',
      selections: ['decline'],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).toContain(discardedCardId);

    const liveQueue = ResolutionQueueManager.getQueue(gameId);
    expect((liveQueue?.steps || []).some((candidate: any) => String(candidate?.castFromExileCardId || '') === discardedCardId)).toBe(false);

    const nextStepEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'nextStep') as any;
    expect(nextStepEvent?.payload?.reason).toBe('cleanupMadnessPromptResolved');

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayedZones = (game.state as any).zones?.[playerId];
    expect((replayedZones?.exile || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).toContain(discardedCardId);

    const replayQueue = ResolutionQueueManager.getQueue(gameId);
    expect((replayQueue?.steps || []).some((candidate: any) => String(candidate?.castFromExileCardId || '') === discardedCardId)).toBe(false);
  });

  it('casts a cleanup-step madness card without prematurely resuming cleanup', async () => {
    const gameId = `${baseGameId}_cast`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };

    const deck = [
      {
        id: 'cleanup_cast_madness_card_1',
        name: 'Cleanup Cast Drake',
        type_line: 'Creature - Drake',
        mana_cost: '{3}{U}',
        oracle_text: 'Flying\nMadness {0}',
      },
      { id: 'cleanup_cast_support_card_1', name: 'Cleanup Cast Support', type_line: 'Instant', oracle_text: '' },
      { id: 'cleanup_cast_support_card_2', name: 'Cleanup Cast Support Two', type_line: 'Sorcery', oracle_text: '' },
    ];
    const seedEvents = [
      { type: 'deckImportResolved', payload: { playerId, cards: deck } },
      { type: 'drawCards', payload: { playerId, count: 2 } },
      { type: 'skipToPhase', payload: { targetPhase: 'ending', targetStep: 'CLEANUP' } },
    ];

    let seq = 0;
    for (const event of seedEvents) {
      appendEvent(gameId, seq++, event.type, event.payload);
      game.applyEvent({ type: event.type, ...event.payload } as any);
    }

    const zonesBeforeDiscard = (game.state as any).zones?.[playerId];
    const handBeforeDiscard = Array.isArray(zonesBeforeDiscard?.hand) ? zonesBeforeDiscard.hand : [];
    const madnessCard = handBeforeDiscard.find((card: any) => String(card?.oracle_text || '').includes('Madness'));
    const discardedCardId = String(madnessCard?.id || '');
    expect(discardedCardId).toBe('cleanup_cast_madness_card_1');

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      description: 'Discard down to maximum hand size',
      sourceName: 'Cleanup',
      mandatory: true,
      discardCount: 1,
      hand: handBeforeDiscard.map((card: any) => ({ ...card })),
      reason: 'cleanup',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: [discardedCardId],
    });

    const madnessPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => String(candidate?.castFromExileCardId || '') === discardedCardId) as any;
    expect(madnessPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(madnessPrompt.id),
      selections: 'cast',
    });

    const pendingCasts = Object.entries((game.state as any).pendingSpellCasts || {});
    expect(pendingCasts).toHaveLength(1);

    const [effectId] = pendingCasts[0] as [string, any];
    await handlers['completeCastSpell']({
      gameId,
      cardId: discardedCardId,
      effectId,
      payment: [],
    });

    expect(emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code)).toEqual([]);

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).not.toContain(discardedCardId);
    const liveStack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(liveStack.some((item: any) => String(item?.card?.id || '') === discardedCardId && item?.madnessCostWasPaid === true)).toBe(true);

    const nextStepEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'nextStep') as any;
    expect(nextStepEvent?.payload?.reason).not.toBe('cleanupMadnessPromptResolved');

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayQueue = ResolutionQueueManager.getQueue(gameId);
    expect((replayQueue?.steps || []).some((candidate: any) => String(candidate?.castFromExileCardId || '') === discardedCardId)).toBe(false);
    const replayedStack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(replayedStack.some((item: any) => String(item?.card?.id || '') === discardedCardId && item?.madnessCostWasPaid === true)).toBe(true);
  });

  it('waits for the last cleanup-step madness prompt before resuming cleanup', async () => {
    const gameId = `${baseGameId}_multi_prompt`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };

    const deck = [
      {
        id: 'cleanup_multi_madness_card_1',
        name: 'Cleanup Multi Madness One',
        type_line: 'Creature - Human',
        oracle_text: 'Madness {R}',
      },
      {
        id: 'cleanup_multi_madness_card_2',
        name: 'Cleanup Multi Madness Two',
        type_line: 'Creature - Shade',
        oracle_text: 'Madness {1}{B}',
      },
      { id: 'cleanup_multi_support_card_1', name: 'Cleanup Multi Support', type_line: 'Instant', oracle_text: '' },
    ];
    const seedEvents = [
      { type: 'deckImportResolved', payload: { playerId, cards: deck } },
      { type: 'drawCards', payload: { playerId, count: 3 } },
      { type: 'skipToPhase', payload: { targetPhase: 'ending', targetStep: 'CLEANUP' } },
    ];

    let seq = 0;
    for (const event of seedEvents) {
      appendEvent(gameId, seq++, event.type, event.payload);
      game.applyEvent({ type: event.type, ...event.payload } as any);
    }

    const zonesBeforeDiscard = (game.state as any).zones?.[playerId];
    const handBeforeDiscard = Array.isArray(zonesBeforeDiscard?.hand) ? zonesBeforeDiscard.hand : [];
    expect(handBeforeDiscard).toHaveLength(3);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      description: 'Discard down to maximum hand size',
      sourceName: 'Cleanup',
      mandatory: true,
      discardCount: 2,
      hand: handBeforeDiscard.map((card: any) => ({ ...card })),
      reason: 'cleanup',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => candidate.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['cleanup_multi_madness_card_1', 'cleanup_multi_madness_card_2'],
    });

    let liveQueue = ResolutionQueueManager.getQueue(gameId);
    expect((liveQueue?.steps || []).filter((candidate: any) => candidate?.resumeCleanupAfterPrompt === true)).toHaveLength(2);
    expect([...getEvents(gameId)].reverse().find((event) => event.type === 'nextStep')?.payload?.reason).not.toBe('cleanupMadnessPromptResolved');

    const firstPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => String(candidate?.castFromExileCardId || '') === 'cleanup_multi_madness_card_1') as any;
    expect(firstPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(firstPrompt.id),
      selections: 'decline',
    });

    liveQueue = ResolutionQueueManager.getQueue(gameId);
    expect((liveQueue?.steps || []).filter((candidate: any) => candidate?.resumeCleanupAfterPrompt === true)).toHaveLength(1);
    expect([...getEvents(gameId)].reverse().find((event) => event.type === 'nextStep')?.payload?.reason).not.toBe('cleanupMadnessPromptResolved');

    const secondPrompt = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((candidate: any) => String(candidate?.castFromExileCardId || '') === 'cleanup_multi_madness_card_2') as any;
    expect(secondPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(secondPrompt.id),
      selections: 'decline',
    });

    liveQueue = ResolutionQueueManager.getQueue(gameId);
    expect((liveQueue?.steps || []).filter((candidate: any) => candidate?.resumeCleanupAfterPrompt === true)).toHaveLength(0);
    expect(Object.keys((game.state as any).pendingSpellCasts || {})).toHaveLength(0);
    expect(Array.isArray((game.state as any).stack) ? (game.state as any).stack.length : 0).toBe(0);

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).not.toContain('cleanup_multi_madness_card_1');
    expect((liveZones?.exile || []).map((card: any) => card.id)).not.toContain('cleanup_multi_madness_card_2');
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).toContain('cleanup_multi_madness_card_1');
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).toContain('cleanup_multi_madness_card_2');

    const nextStepEvent = [...getEvents(gameId)].reverse().find((event) => event.type === 'nextStep') as any;
    expect(nextStepEvent?.payload?.reason).toBe('cleanupMadnessPromptResolved');

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayedZones = (game.state as any).zones?.[playerId];
    expect((replayedZones?.exile || []).map((card: any) => card.id)).not.toContain('cleanup_multi_madness_card_1');
    expect((replayedZones?.exile || []).map((card: any) => card.id)).not.toContain('cleanup_multi_madness_card_2');
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).toContain('cleanup_multi_madness_card_1');
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).toContain('cleanup_multi_madness_card_2');
    expect((ResolutionQueueManager.getQueue(gameId)?.steps || []).filter((candidate: any) => candidate?.resumeCleanupAfterPrompt === true)).toHaveLength(0);
  });
});
