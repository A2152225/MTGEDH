import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
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

async function setupBaseGame(gameId: string, playerId = 'p1', opponentId = 'p2') {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40 },
    { id: opponentId, name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'precombatMain';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };

  return game;
}

function seedAdditionalCostMadnessState(game: any, playerId: string) {
  (game.state as any).zones = {
    [playerId]: {
      hand: [
        {
          id: 'discard_spell_1',
          name: 'Hazardous Research',
          mana_cost: '{0}',
          type_line: 'Sorcery',
          oracle_text: 'As an additional cost to cast this spell, discard a card. Draw two cards.',
          image_uris: { small: 'https://example.com/discard-spell.jpg' },
          zone: 'hand',
        },
        {
          id: 'madness_card_1',
          name: 'Fiery Temper',
          mana_cost: '{1}{R}{R}',
          type_line: 'Instant',
          oracle_text: 'Madness {R}',
          image_uris: { small: 'https://example.com/fiery-temper.jpg' },
          zone: 'hand',
        },
      ],
      handCount: 2,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
  };
}

describe('castSpellFromHand discard additional cost with madness (integration)', () => {
  const gameId = 'test_cast_spell_from_hand_additional_cost_madness';
  const replayGameIds = [`${gameId}_replay_live`, `${gameId}_replay_copy`];

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    for (const replayGameId of replayGameIds) {
      await resetGame(replayGameId);
    }
  });

  afterEach(async () => {
    await resetGame(gameId);
    for (const replayGameId of replayGameIds) {
      await resetGame(replayGameId);
    }
  });

  it('exiles a madness discard and queues the madness cast prompt after paying the spell additional cost', async () => {
    const playerId = 'p1';
    const game = await setupBaseGame(gameId, playerId, 'p2');
    seedAdditionalCostMadnessState(game, playerId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.castSpellFromHand({ gameId, cardId: 'discard_spell_1' });

    const discardStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step.type === 'additional_cost_payment') as any;
    expect(discardStep).toBeDefined();
    expect(discardStep.costType).toBe('discard');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(discardStep.id),
      selections: ['madness_card_1'],
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && (step as any)?.spellPaymentRequired === true) as any;
    if (paymentStep) {
      await handlers.submitResolutionResponse({
        gameId,
        stepId: String(paymentStep.id),
        selections: { payment: [] },
      });
    }

    const zones = (game.state as any).zones?.[playerId];
    expect((zones?.exile || []).map((card: any) => card.id)).toContain('madness_card_1');
    expect((zones?.graveyard || []).map((card: any) => card.id)).not.toContain('madness_card_1');

    const errorEvents = emitted.filter((event) => event.event === 'error');
    expect(errorEvents).toEqual([]);

    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) => String(item?.card?.id || '') === 'discard_spell_1')).toBe(true);

    const madnessPrompt = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_1') as any;
    expect(madnessPrompt).toBeDefined();
    expect(madnessPrompt?.madnessPrompt).toBe(true);
  });

  it('replays the additional-cost madness discard into exile and restores the queued madness prompt after the spell is cast', async () => {
    const liveGameId = `${gameId}_replay_live`;
    const replayGameId = `${gameId}_replay_copy`;
    const playerId = 'p1';

    const liveGame = await setupBaseGame(liveGameId, playerId, 'p2');
    seedAdditionalCostMadnessState(liveGame, playerId);

    const liveEmitted: Array<{ room?: string; event: string; payload: any }> = [];
    const liveIo = createMockIo(liveEmitted);
    const { socket: liveSocket, handlers: liveHandlers } = createMockSocket(playerId, liveGameId, liveEmitted);

    registerGameActions(liveIo as any, liveSocket as any);
    registerResolutionHandlers(liveIo as any, liveSocket as any);

    await liveHandlers.castSpellFromHand({ gameId: liveGameId, cardId: 'discard_spell_1' });

    const discardStep = ResolutionQueueManager.getQueue(liveGameId).steps.find((step: any) => step.type === 'additional_cost_payment') as any;
    expect(discardStep).toBeDefined();

    await liveHandlers.submitResolutionResponse({
      gameId: liveGameId,
      stepId: String(discardStep.id),
      selections: ['madness_card_1'],
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(liveGameId)
      .steps
      .find((step: any) => step.type === 'mana_payment_choice' && (step as any)?.spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();

    await liveHandlers.submitResolutionResponse({
      gameId: liveGameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
    });

    const discardEffectEvent = [...getEvents(liveGameId)].reverse().find((event: any) =>
      event.type === 'discardEffect' &&
      String((event as any)?.payload?.destination || '') === 'exile' &&
      ((event as any)?.payload?.cardIds || []).includes('madness_card_1')
    ) as any;
    expect(discardEffectEvent).toBeDefined();

    const deferredPromptEvent = [...getEvents(liveGameId)].reverse().find((event: any) =>
      event.type === 'castSpellContinuation' &&
      Array.isArray((event as any)?.payload?.pendingSpellCast?.queuedMadnessStepsAfterCast)
    ) as any;
    expect(deferredPromptEvent?.payload?.pendingSpellCast?.queuedMadnessStepsAfterCast || []).toHaveLength(1);

    const promptEvent = [...getEvents(liveGameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt' &&
      Array.isArray((event as any)?.payload?.queuedResolutionSteps) &&
      (event as any).payload.queuedResolutionSteps.some((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_1')
    ) as any;
    expect(promptEvent).toBeDefined();

    const replayGame = await setupBaseGame(replayGameId, playerId, 'p2');
    seedAdditionalCostMadnessState(replayGame, playerId);

    for (const replayEvent of transformDbEventsForReplay(getEvents(liveGameId) as any)) {
      replayGame.applyEvent(replayEvent as any);
    }

    const replayZones = (replayGame.state as any).zones?.[playerId];
    expect((replayZones?.exile || []).map((card: any) => card.id)).toContain('madness_card_1');
    expect((replayZones?.graveyard || []).map((card: any) => card.id)).not.toContain('madness_card_1');

    const replayStack = (replayGame.state as any).stack || [];
    expect(replayStack.some((item: any) => String(item?.card?.id || '') === 'discard_spell_1')).toBe(true);

    const replayPrompt = ResolutionQueueManager
      .getQueue(replayGameId)
      .steps
      .find((step: any) => String((step as any)?.castFromExileCardId || '') === 'madness_card_1') as any;
    expect(replayPrompt).toBeDefined();
    expect(replayPrompt?.madnessPrompt).toBe(true);
  });
});