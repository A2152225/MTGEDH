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

function seedHand(gameId: string, playerId: string, deck: any[]) {
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).active = true;
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40 };

  let seq = 0;
  const seedEvents = [
    { type: 'deckImportResolved', payload: { playerId, cards: deck } },
    { type: 'drawCards', payload: { playerId, count: 1 } },
  ];

  for (const event of seedEvents) {
    appendEvent(gameId, seq++, event.type, event.payload);
    game.applyEvent({ type: event.type, ...event.payload } as any);
  }

  return game;
}

function queueDiscardStep(gameId: string, playerId: string, hand: any[]) {
  return ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.DISCARD_SELECTION,
    playerId: playerId as any,
    description: 'Discard a card.',
    sourceName: 'Madness Probe',
    sourceId: 'madness_probe_source',
    mandatory: true,
    discardCount: 1,
    hand: hand.map((card: any) => ({ ...card })),
    destination: 'graveyard',
  } as any);
}

describe('madness discard replay (integration)', () => {
  const baseGameId = 'test_madness_discard_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(`${baseGameId}_prompt`);
    await resetGame(`${baseGameId}_cast`);
    await resetGame(`${baseGameId}_decline`);
  });

  afterEach(async () => {
    await resetGame(`${baseGameId}_prompt`);
    await resetGame(`${baseGameId}_cast`);
    await resetGame(`${baseGameId}_decline`);
  });

  it('queues and replays a madness cast prompt after discarding', async () => {
    const gameId = `${baseGameId}_prompt`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const madnessCard = {
      id: 'madness_card_1',
      name: 'Basking Rootwalla',
      type_line: 'Creature - Lizard',
      mana_cost: '{G}',
      oracle_text: 'Madness {0}',
      zone: 'library',
    };
    const game = seedHand(gameId, playerId, [madnessCard]);
    const hand = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => ({ ...card }));
    queueDiscardStep(gameId, playerId, hand);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['madness_card_1'],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).toContain('madness_card_1');
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).not.toContain('madness_card_1');

    const queue = ResolutionQueueManager.getQueue(gameId);
    const madnessPrompt = (queue.steps || []).find((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_1') as any;
    expect(madnessPrompt).toBeDefined();
    expect(madnessPrompt.castFromExileForcedAlternateCostId).toBe('madness');
    expect(madnessPrompt.castFromExileDeclineDestination).toBe('graveyard');

    const persistedEvents = getEvents(gameId);
    const discardEffectEvent = [...persistedEvents].reverse().find((event: any) => event.type === 'discardEffect' && String((event as any)?.payload?.destination || '') === 'exile') as any;
    const promptEvent = [...persistedEvents].reverse().find((event: any) => event.type === 'resolveTopOfStackPrompt' && Array.isArray((event as any)?.payload?.queuedResolutionSteps)) as any;

    expect(discardEffectEvent?.payload).toEqual({
      playerId,
      cardIds: ['madness_card_1'],
      destination: 'exile',
    });
    expect((promptEvent?.payload?.queuedResolutionSteps || []).some((step: any) => String(step?.castFromExileCardId || '') === 'madness_card_1')).toBe(true);

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayedZones = (game.state as any).zones?.[playerId];
    expect((replayedZones?.exile || []).map((card: any) => card.id)).toContain('madness_card_1');
    const replayQueue = ResolutionQueueManager.getQueue(gameId);
    expect((replayQueue.steps || []).some((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_1')).toBe(true);
  });

  it('casts a discarded madness card from exile and replays the cast state', async () => {
    const gameId = `${baseGameId}_cast`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const madnessCard = {
      id: 'madness_card_2',
      name: 'Zero-Madness Drake',
      type_line: 'Creature - Drake',
      mana_cost: '{3}{U}',
      oracle_text: 'Flying\nMadness {0}',
      zone: 'library',
    };
    const game = seedHand(gameId, playerId, [madnessCard]);
    const hand = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => ({ ...card }));
    queueDiscardStep(gameId, playerId, hand);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['madness_card_2'],
    });

    let queue = ResolutionQueueManager.getQueue(gameId);
    const madnessPrompt = (queue.steps || []).find((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_2') as any;
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
      cardId: 'madness_card_2',
      effectId,
      payment: [],
    });

    expect(emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code)).toEqual([]);

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).not.toContain('madness_card_2');
    const liveStack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(liveStack.some((item: any) => String(item?.card?.id || '') === 'madness_card_2' && item?.madnessCostWasPaid === true)).toBe(true);

    const persistedEvents = getEvents(gameId);
    const resolveEvent = [...persistedEvents].reverse().find((event: any) => event.type === 'castFromExilePromptResolve') as any;
    expect(resolveEvent?.payload?.choice).toBe('cast');

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    queue = ResolutionQueueManager.getQueue(gameId);
    expect((queue.steps || []).some((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_2')).toBe(false);
    const replayedStack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    expect(replayedStack.some((item: any) => String(item?.card?.id || '') === 'madness_card_2' && item?.madnessCostWasPaid === true)).toBe(true);
  });

  it('declines a discarded madness prompt and replays the graveyard result', async () => {
    const gameId = `${baseGameId}_decline`;
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const madnessCard = {
      id: 'madness_card_3',
      name: 'Temperamental Shade',
      type_line: 'Creature - Shade',
      mana_cost: '{2}{B}',
      oracle_text: 'Madness {1}{B}',
      zone: 'library',
    };
    const game = seedHand(gameId, playerId, [madnessCard]);
    const hand = ((game.state as any).zones?.[playerId]?.hand || []).map((card: any) => ({ ...card }));
    queueDiscardStep(gameId, playerId, hand);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((step: any) => step.type === ResolutionStepType.DISCARD_SELECTION) as any;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['madness_card_3'],
    });

    const madnessPrompt = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_3') as any;
    expect(madnessPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(madnessPrompt.id),
      selections: 'decline',
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.exile || []).map((card: any) => card.id)).not.toContain('madness_card_3');
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).toContain('madness_card_3');

    const resolveEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'castFromExilePromptResolve') as any;
    expect(resolveEvent?.payload).toMatchObject({
      playerId,
      cardId: 'madness_card_3',
      choice: 'decline',
      declineDestination: 'graveyard',
    });

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayedZones = (game.state as any).zones?.[playerId];
    expect((replayedZones?.exile || []).map((card: any) => card.id)).not.toContain('madness_card_3');
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).toContain('madness_card_3');
    expect((ResolutionQueueManager.getQueue(gameId).steps || []).some((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_3')).toBe(false);
  });

});