import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('spell-cast reveal/cast queue flow (integration)', () => {
  const gameId = 'test_spell_cast_reveal_cast_resolution';
  const playerId = 'p1';
  const opponentId = 'p2';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('bottoms the spell, stages the revealed nonland in exile, and free-casts via cast-from-exile', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 3;
    (game as any).libraries = new Map();
    (game as any).libraries.set(playerId, [
      { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
      {
        id: 'hit_1',
        name: 'Lightning Bolt',
        mana_cost: '{R}',
        manaCost: '{R}',
        type_line: 'Instant',
        oracle_text: 'Lightning Bolt deals 3 damage to any target.',
        zone: 'library',
      },
    ]);
    (game.state as any).zones = {
      [playerId]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: 2,
      },
      [opponentId]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        hand: [],
        handCount: 0,
        libraryCount: 0,
      },
    };
    (game.state as any).stack = [
      {
        id: 'spell_1',
        type: 'spell',
        controller: playerId,
        card: { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', owner: playerId, zone: 'stack' },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      description: 'Neera, Wild Mage: Put Opt on the bottom and reveal until a nonland?',
      mandatory: false,
      sourceName: 'Neera, Wild Mage',
      options: [
        { id: 'yes', label: 'Use ability' },
        { id: 'no', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      spellBottomRevealUntilNonlandChoice: true,
      triggeringStackItemId: 'spell_1',
      triggeringSpellCard: { id: 'cast_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.', owner: playerId },
      revealFromLibraryPlayerId: playerId,
      revealSourcePermanentId: 'neera_perm',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const firstStep = queue.steps.find((s: any) => s.type === 'option_choice');
    expect(firstStep).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((firstStep as any).id), selections: 'yes' });

    expect(((game.state as any).stack || []).some((item: any) => item.id === 'spell_1')).toBe(false);
    expect(((game as any).libraries.get(playerId) || []).some((card: any) => card.id === 'cast_1')).toBe(true);
    expect(((game as any).libraries.get(playerId) || []).some((card: any) => card.id === 'land_1')).toBe(true);
    expect(((game as any).libraries.get(playerId) || []).some((card: any) => card.id === 'hit_1')).toBe(false);
    expect((((game.state as any).zones?.[playerId]?.exile) || []).map((card: any) => card.id)).toContain('hit_1');

    const queueAfterFirst = ResolutionQueueManager.getQueue(gameId);
    const secondStep = queueAfterFirst.steps.find((s: any) => String((s as any).castFromExileCardId || '') === 'hit_1');
    expect(secondStep).toBeDefined();
    expect((secondStep as any).castFromExileCastWithoutPayingManaCost).toBe(true);
    expect((secondStep as any).castFromExileDeclineDestination).toBe('library_bottom_random');

    const revealResolveEvent = [...getEvents(gameId)].reverse().find(
      (event: any) => event.type === 'spellBottomRevealUntilNonlandResolve'
    ) as any;
    expect(revealResolveEvent?.payload?.choice).toBe('yes');
    expect(revealResolveEvent?.payload?.queuedResolutionStep?.castFromExileCardId).toBe('hit_1');
    expect(String(revealResolveEvent?.payload?.queuedResolutionStep?.id || '')).toBe(String((secondStep as any)?.id || ''));
    expect((revealResolveEvent?.payload?.revealExileAfter || []).some((card: any) => card.id === 'hit_1')).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((secondStep as any).id), selections: 'cast' });

    const targetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();
    expect((targetStep?.validTargets || []).some((target: any) => String(target.id) === opponentId)).toBe(true);

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
    expect(String(paymentStep.forcedAlternateCostId || '')).toBe('free');
    expect(
      (Array.isArray(paymentStep.extraAlternateCosts) ? paymentStep.extraAlternateCosts : [])
        .some((cost: any) => String(cost?.id || '') === 'free' && String(cost?.manaCost || '') === '{0}'),
    ).toBe(true);

    const pendingCasts = Object.values((game.state as any).pendingSpellCasts || {}) as any[];
    const pendingCast = pendingCasts.find((entry: any) => String(entry?.cardId || '') === 'hit_1') || pendingCasts[0];
    expect(pendingCast?.castWithoutPayingManaCost).toBe(true);
    expect(String(pendingCast?.costMetadata?.paymentModel?.effectiveManaCost || '')).toBe('{0}');
    expect(pendingCast?.costMetadata?.paymentModel?.castWithoutPayingManaCost).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);
    expect(exileIds).not.toContain('hit_1');

    const stackItem = (((game.state as any).stack || []) as any[]).find((entry: any) => entry.card?.id === 'hit_1');
    expect(stackItem).toBeDefined();
    expect(stackItem?.castFromExile).toBe(true);
    expect(stackItem?.castWithoutPayingManaCost).toBe(true);
    const normalizedTargets = (Array.isArray(stackItem?.targets) ? stackItem.targets : [])
      .map((target: any) => (typeof target === 'string' ? target : target?.id));
    expect(normalizedTargets).toContain(opponentId);

    const libraryIds = new Set(((game as any).libraries.get(playerId) || []).map((card: any) => card.id));
    expect(libraryIds.has('land_1')).toBe(true);
    expect(libraryIds.has('cast_1')).toBe(true);
    expect(libraryIds.has('hit_1')).toBe(false);
  });

  it('puts the revealed nonland on the library bottom when the free cast is declined', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game as any).libraries = new Map();
    (game as any).libraries.set(playerId, [
      { id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
    ]);
    (game.state as any).zones = {
      [playerId]: {
        graveyard: [],
        graveyardCount: 0,
        exile: [
          {
            id: 'hit_1',
            name: 'Shock',
            type_line: 'Instant',
            oracle_text: 'Shock deals 2 damage to any target.',
            zone: 'exile',
          },
        ],
        exileCount: 1,
        hand: [],
        handCount: 0,
        library: [{ id: 'land_1', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' }],
        libraryCount: 1,
      },
    };
    (game.state as any).stack = [];

    const castStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      description: 'Neera, Wild Mage: Cast Shock without paying its mana cost?',
      mandatory: false,
      sourceName: 'Neera, Wild Mage',
      sourceId: 'neera_perm',
      options: [
        { id: 'cast', label: 'Cast Shock' },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      castFromExileCardId: 'hit_1',
      castFromExileCard: {
        id: 'hit_1',
        name: 'Shock',
        type_line: 'Instant',
        oracle_text: 'Shock deals 2 damage to any target.',
        zone: 'exile',
      },
      castFromExileCastWithoutPayingManaCost: true,
      castFromExileForcedAlternateCostId: 'free',
      castFromExileBypassExilePermissionCheck: true,
      castFromExileIgnoreTimingRestrictions: true,
      castFromExileDeclineDestination: 'library_bottom_random',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: String(castStep.id), selections: 'decline' });

    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);
    expect(exileIds).not.toContain('hit_1');
    expect((((game as any).libraries.get(playerId) || []) as any[]).map((card: any) => card.id)).toContain('hit_1');
    expect((((game.state as any).zones?.[playerId]?.library) || []).map((card: any) => card.id)).toContain('hit_1');
  });
});
