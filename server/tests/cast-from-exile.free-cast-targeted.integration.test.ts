import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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

describe('generic cast-from-exile targeted free casts (integration)', () => {
  const gameId = 'test_cast_from_exile_targeted_free_cast';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('routes accepted free casts from exile through target selection and completes them without mana payment', async () => {
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
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).priority = opponentId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        exile: [
          {
            id: 'bolt_1',
            name: 'Lightning Bolt',
            mana_cost: '{R}',
            manaCost: '{R}',
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
            image_uris: { small: 'https://example.com/bolt.jpg' },
            zone: 'exile',
          },
        ],
        exileCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        exile: [],
        exileCount: 0,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      description: 'You may cast Lightning Bolt from exile without paying its mana cost.',
      mandatory: false,
      sourceName: 'Generic Free Cast',
      options: [
        { id: 'cast', label: 'Cast Lightning Bolt' },
        { id: 'decline', label: "Don't cast" },
      ],
      minSelections: 1,
      maxSelections: 1,
      castFromExileCardId: 'bolt_1',
      castFromExileCard: {
        id: 'bolt_1',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        image_uris: { small: 'https://example.com/bolt.jpg' },
        zone: 'exile',
      },
      castFromExileDeclineDestination: 'exile',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: 'cast',
      cancelled: false,
    });

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();
    expect((targetStep?.validTargets || []).some((target: any) => String(target.id) === opponentId)).toBe(true);
    expect((((game.state as any).zones?.[playerId]?.exile) || []).map((card: any) => card.id)).toContain('bolt_1');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: [opponentId],
      cancelled: false,
    });

    const paymentStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((entry: any) => entry.type === 'mana_payment_choice' && (entry as any).spellPaymentRequired === true) as any;
    expect(paymentStep).toBeDefined();
    expect(String(paymentStep.manaCost || '{0}')).toContain('0');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    const continueEvent = emitted.find((event) => event.event === 'castSpellFromHandContinue');
    expect(continueEvent?.payload?.effectId).toBeDefined();
    expect(continueEvent?.payload?.alternateCostId).toBe('free');

    emitted.length = 0;
    await handlers['completeCastSpell'](continueEvent?.payload);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const noPermissionError = emitted.find((event) => event.event === 'error' && event.payload?.code === 'NO_PERMISSION');
    expect(noPermissionError).toBeUndefined();

    const noManaError = emitted.find((event) => event.event === 'error' && event.payload?.code === 'INSUFFICIENT_MANA');
    expect(noManaError).toBeUndefined();

    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);
    expect(exileIds).not.toContain('bolt_1');

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => entry.card?.id === 'bolt_1');
    expect(stackItem).toBeDefined();
    expect(stackItem?.castFromExile).toBe(true);
    expect(stackItem?.castWithoutPayingManaCost).toBe(true);
    const normalizedTargets = (Array.isArray(stackItem?.targets) ? stackItem.targets : [])
      .map((target: any) => (typeof target === 'string' ? target : target?.id));
    expect(normalizedTargets).toContain(opponentId);
  });
});