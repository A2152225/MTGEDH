import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { processPendingDanceWithCalamity, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

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

describe('Dance with Calamity ordered free-cast flow (integration)', () => {
  const gameId = 'test_dance_with_calamity_live_cast_sequence';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('casts the chosen spells in order and resolves cleanly after the last prompt is declined', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);

    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const lightningBolt = {
      id: 'bolt_1',
      name: 'Lightning Bolt',
      mana_cost: '{R}',
      manaCost: '{R}',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      image_uris: { small: 'https://example.com/bolt.jpg' },
      cmc: 1,
      zone: 'exile',
    };
    const opt = {
      id: 'opt_1',
      name: 'Opt',
      mana_cost: '{U}',
      manaCost: '{U}',
      type_line: 'Instant',
      oracle_text: 'Scry 1. Draw a card.',
      image_uris: { small: 'https://example.com/opt.jpg' },
      cmc: 1,
      zone: 'exile',
    };

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).priority = opponentId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [{ ...lightningBolt }, { ...opt }],
        exileCount: 2,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries = new Map();
    (game as any).libraries.set(playerId, []);
    (game as any).libraries.set(opponentId, []);
    (game.state as any).pendingDanceWithCalamity = {
      [playerId]: {
        effectId: 'dance_live_1',
        sourceName: 'Dance with Calamity',
        sourceImage: 'https://example.com/dance.jpg',
        exiledCards: [{ ...lightningBolt }, { ...opt }],
        totalManaValue: 2,
        stage: 'select_casts',
        spellCardIds: ['bolt_1', 'opt_1'],
        queued: false,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    processPendingDanceWithCalamity(io as any, game, gameId);

    let queue = ResolutionQueueManager.getQueue(gameId);
    let castSelectionStep = queue.steps.find((step: any) => step.type === ResolutionStepType.DANCE_WITH_CALAMITY_CAST) as any;
    expect(castSelectionStep).toBeDefined();
    expect((castSelectionStep?.spellCards || []).map((card: any) => card.id)).toEqual(['bolt_1', 'opt_1']);

    const eventStart = getEvents(gameId).length;

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(castSelectionStep.id),
      selections: { orderedSpellIds: ['bolt_1', 'opt_1'] },
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    let castPrompt = queue.steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE && step.castFromExileCardId === 'bolt_1') as any;
    expect(castPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(castPrompt.id),
      selections: 'cast',
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((step: any) => step.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();
    expect((targetStep?.validTargets || []).some((target: any) => String(target.id) === opponentId)).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: [opponentId],
      cancelled: false,
    });

    queue = ResolutionQueueManager.getQueue(gameId);
    const paymentStep = queue.steps.find((step: any) => step.type === 'mana_payment_choice' && step.spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(String(paymentStep?.manaCost || '{0}')).toContain('0');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.alternateCostId).toBe('free');

    emitted.length = 0;
    await handlers['completeCastSpell'](continueEvent?.payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => entry.card?.id === 'bolt_1');
    expect(stackItem).toBeDefined();
    expect(stackItem?.castFromExile).toBe(true);
    expect(stackItem?.castWithoutPayingManaCost).toBe(true);
    expect((((game.state as any).zones?.[playerId]?.exile) || []).map((card: any) => card.id)).toEqual(['opt_1']);

    queue = ResolutionQueueManager.getQueue(gameId);
    castPrompt = queue.steps.find((step: any) => step.type === ResolutionStepType.OPTION_CHOICE && step.castFromExileCardId === 'opt_1') as any;
    expect(castPrompt).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(castPrompt.id),
      selections: 'decline',
      cancelled: false,
    });

    expect((game.state as any).pendingDanceWithCalamity).toBeUndefined();
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toHaveLength(0);
    expect((((game.state as any).zones?.[playerId]?.exile) || []).map((card: any) => card.id)).toEqual(['opt_1']);

    const newEvents = getEvents(gameId).slice(eventStart).map((event) => event.type);
    expect(newEvents).toContain('danceWithCalamitySetCastOrder');
    expect(newEvents).toContain('danceWithCalamityAdvanceCast');
    expect(newEvents).toContain('danceWithCalamityResolve');
  });
});