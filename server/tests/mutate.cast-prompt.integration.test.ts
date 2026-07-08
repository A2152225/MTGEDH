import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions, requestCastSpellForSocket } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createCapturingIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
  sockets: any[],
) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => {
        emitted.push({ room, event, payload });
      },
    }),
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    sockets: { sockets: new Map(sockets.map((socket) => [String(socket.id || socket.data.playerId), socket])) },
  } as any;
}

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: `${playerId}_socket`,
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

describe('Mutate cast prompt persistence (integration)', () => {
  const gameId = 'test_mutate_cast_prompt_persistence';
  const p1 = 'p1';
  const trackedGameIds = new Set<string>();

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
    trackedGameIds.clear();
  });

  function seedMutateGame(testGameId: string) {
    trackedGameIds.add(testGameId);
    createGameIfNotExists(testGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(testGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).battlefield = [
      {
        id: 'host_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'host_card_1',
          name: 'Mutation Host',
          type_line: 'Creature - Beast',
          oracle_text: 'Vigilance',
          power: '2',
          toughness: '2',
          image_uris: { small: 'https://example.com/host.jpg' },
        },
      },
      ...['forest_1', 'forest_2', 'forest_3'].map((forestId) => ({
        id: forestId,
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      })),
    ];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'mutate_1',
            name: 'Gemrazer',
            mana_cost: '{3}{G}',
            type_line: 'Creature - Beast',
            oracle_text: 'Mutate {1}{G}{G}\nReach, trample\nWhenever this creature mutates, destroy target artifact or enchantment an opponent controls.',
            image_uris: { small: 'https://example.com/gemrazer.jpg' },
            zone: 'hand',
            power: '4',
            toughness: '4',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    return game;
  }

  it('queues unified mana payment with mutate alternate cost before mode is chosen', async () => {
    const testGameId = `${gameId}_mode_${Math.random().toString(36).slice(2, 10)}`;
    seedMutateGame(testGameId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, testGameId, emitted);
    const io = createNoopIo();

    registerGameActions(io as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'mutate_1' });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const modeStep = queue.steps.find((step: any) => step?.mutateCastModeChoice === true) as any;
    expect(modeStep).toBeUndefined();

    const paymentStep = queue.steps.find(
      (step: any) => step?.type === 'mana_payment_choice' && step?.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();
    expect(paymentStep.extraAlternateCosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mutate' }),
    ]));

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('mutate_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast).toBeTruthy();
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mana_payment_choice');
  });

  it('persists the forced mutate target prompt with pending cast state', async () => {
    const testGameId = `${gameId}_target_${Math.random().toString(36).slice(2, 10)}`;
    seedMutateGame(testGameId);
    const game = ensureGame(testGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket } = createMockSocket(p1, testGameId, emitted);

    await requestCastSpellForSocket(createNoopIo() as any, socket as any, {
      gameId: testGameId,
      cardId: 'mutate_1',
    }, {
      forcedAlternateCostId: 'mutate',
      skipMutateModePrompt: true,
    });

    const queue = ResolutionQueueManager.getQueue(testGameId);
    const mutateStep = queue.steps.find((step: any) => step?.type === 'mutate_target_selection') as any;
    expect(mutateStep).toBeDefined();
    expect(mutateStep?.effectId).toBeTruthy();
    expect(mutateStep?.validTargets?.[0]?.id).toBe('host_1');

    const queuedCastEvent = [...getEvents(testGameId)].reverse().find((event: any) => event.type === 'castSpellContinuation') as any;
    expect(queuedCastEvent?.payload?.cardId).toBe('mutate_1');
    expect(queuedCastEvent?.payload?.effectId).toBe(String(mutateStep?.effectId || ''));
    expect(queuedCastEvent?.payload?.pendingSpellCast?.cardId).toBe('mutate_1');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.forcedAlternateCostId).toBe('mutate');
    expect(queuedCastEvent?.payload?.pendingSpellCast?.validTargetIds).toEqual(['host_1']);
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.type).toBe('mutate_target_selection');
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.effectId).toBe(String(mutateStep?.effectId || ''));
    expect(queuedCastEvent?.payload?.queuedResolutionStep?.validTargets?.[0]?.id).toBe('host_1');
  });

  it('defers mutate target selection when mutate is chosen in the unified payment step', async () => {
    const testGameId = `${gameId}_unified_${Math.random().toString(36).slice(2, 10)}`;
    seedMutateGame(testGameId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, testGameId, emitted);
    const io = createNoopIo();

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'mutate_1' });

    const paymentStep = ResolutionQueueManager.getQueue(testGameId).steps.find(
      (step: any) => step?.type === 'mana_payment_choice' && step?.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        alternateCostId: 'mutate',
        payment: [{ permanentId: 'host_1', mana: 'G', count: 1 }],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mutateStep = ResolutionQueueManager.getQueue(testGameId).steps.find(
      (step: any) => step?.type === 'mutate_target_selection',
    ) as any;
    expect(mutateStep).toBeDefined();
    expect(mutateStep?.validTargets?.[0]?.id).toBe('host_1');

    const pendingCast = Object.values((ensureGame(testGameId)?.state as any)?.pendingSpellCasts || {})[0] as any;
    expect(pendingCast?.deferredSpellPaymentCompletion?.payment?.length).toBeGreaterThan(0);
    expect(pendingCast?.forcedAlternateCostId).toBe('mutate');
  });

  it('completes a mutate cast from unified payment through target selection', async () => {
    const testGameId = `${gameId}_complete_${Math.random().toString(36).slice(2, 10)}`;
    seedMutateGame(testGameId);
    const game = ensureGame(testGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, testGameId, emitted);
    const io = createCapturingIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers.requestCastSpell({ gameId: testGameId, cardId: 'mutate_1' });

    const paymentStep = ResolutionQueueManager.getQueue(testGameId).steps.find(
      (step: any) => step?.type === 'mana_payment_choice' && step?.spellPaymentRequired === true,
    ) as any;
    expect(paymentStep).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(paymentStep.id),
      selections: {
        alternateCostId: 'mutate',
        payment: [
          { permanentId: 'forest_1', mana: 'G', count: 1 },
          { permanentId: 'forest_2', mana: 'G', count: 1 },
          { permanentId: 'forest_3', mana: 'G', count: 1 },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mutateStep = ResolutionQueueManager.getQueue(testGameId).steps.find(
      (step: any) => step?.type === 'mutate_target_selection',
    ) as any;
    expect(mutateStep).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId: testGameId,
      stepId: String(mutateStep.id),
      selections: {
        targetPermanentId: 'host_1',
        onTop: true,
      },
    });

    await vi.waitFor(() => {
      const hand = ((game.state as any).zones?.[p1]?.hand || []) as any[];
      expect(hand.some((card) => String(card?.id || '') === 'mutate_1')).toBe(false);
    }, { timeout: 5000 });

    const errors = emitted.filter((entry) => entry.event === 'error');
    expect(errors).toEqual([]);

    const host = ((game.state as any).battlefield || []).find((perm: any) => String(perm?.id || '') === 'host_1');
    expect(host).toBeDefined();
    const mergedHost = ((game.state as any).battlefield || []).find((perm: any) =>
      String(perm?.id || '') === 'host_1'
      && Array.isArray((perm as any).mutatedStack)
      && (perm as any).mutatedStack.some((layer: any) => String(layer?.name || '') === 'Gemrazer'),
    );
    const gemrazerOnStack = ((game.state as any).stack || []).some(
      (entry: any) => String(entry?.card?.name || entry?.sourceName || '') === 'Gemrazer',
    );
    expect(mergedHost || gemrazerOnStack).toBe(true);
    expect(ResolutionQueueManager.getQueue(testGameId).steps.some(
      (step: any) => step?.type === 'mana_payment_choice' && step?.spellPaymentRequired === true,
    )).toBe(false);
  });
});