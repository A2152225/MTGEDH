import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, getEvents } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
  sockets: any[] = []
) {
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

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
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

describe('optional discard then draw choice (integration)', () => {
  const gameId = 'test_optional_discard_then_draw_choice';
  const replayGameId = `${gameId}_replay`;

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('does nothing when the player declines to discard', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: 'card_1', name: 'Card One', type_line: 'Instant' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: You may discard a card. If you do, draw a card.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'discard', label: 'Discard a card' },
        { id: 'dont', label: "Don't discard" },
      ],
      minSelections: 1,
      maxSelections: 1,
      optionalDiscardThenDrawChoice: true,
      optionalDiscardThenDrawPlayerId: p1,
      optionalDiscardThenDrawSourceName: 'Source',
      optionalDiscardThenDrawCount: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'dont' });

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['card_1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });

  it('queues a discard selection with afterDiscardDrawCount when the player chooses to discard', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'card_1', name: 'Card One', type_line: 'Instant' },
          { id: 'card_2', name: 'Card Two', type_line: 'Sorcery' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: You may discard a card. If you do, draw a card.',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'discard', label: 'Discard a card' },
        { id: 'dont', label: "Don't discard" },
      ],
      minSelections: 1,
      maxSelections: 1,
      optionalDiscardThenDrawChoice: true,
      optionalDiscardThenDrawPlayerId: p1,
      optionalDiscardThenDrawSourceName: 'Source',
      optionalDiscardThenDrawCount: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'discard' });

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).type).toBe('discard_selection');
    expect((queue.steps[0] as any).afterDiscardDrawCount).toBe(1);
    expect(((queue.steps[0] as any).hand || []).map((c: any) => c.id)).toEqual(['card_1', 'card_2']);

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt' &&
      event.payload?.queuedResolutionStep?.type === ResolutionStepType.DISCARD_SELECTION
    ) as any;
    expect(promptEvent).toBeDefined();
    expect(promptEvent.payload?.queuedResolutionStep).toMatchObject({
      type: ResolutionStepType.DISCARD_SELECTION,
      sourceName: 'Source',
      afterDiscardDrawCount: 1,
    });

    createGameIfNotExists(replayGameId, 'commander', 40);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');

    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'card_1', name: 'Card One', type_line: 'Instant' },
          { id: 'card_2', name: 'Card Two', type_line: 'Sorcery' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 0,
      },
    };

    ResolutionQueueManager.removeQueue(replayGameId);
    replayGame.applyEvent({
      type: 'resolveTopOfStackPrompt',
      ...(promptEvent.payload || {}),
    } as any);

    const replayQueue = ResolutionQueueManager.getQueue(replayGameId);
    expect(replayQueue.steps).toHaveLength(1);
    expect((replayQueue.steps[0] as any)).toMatchObject({
      type: ResolutionStepType.DISCARD_SELECTION,
      sourceName: 'Source',
      afterDiscardDrawCount: 1,
    });
    expect(((replayQueue.steps[0] as any).hand || []).map((c: any) => c.id)).toEqual(['card_1', 'card_2']);
  });

  it('carries the discarded-land rider from generic trigger text into the discard selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'land_1', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '{T}: Add {G}.' },
          { id: 'spell_1', name: 'Spell One', type_line: 'Instant', oracle_text: '' },
        ],
        handCount: 2,
        graveyard: [],
        graveyardCount: 0,
        library: [
          { id: 'draw_1', name: 'Draw One', type_line: 'Sorcery', oracle_text: '' },
          { id: 'draw_2', name: 'Draw Two', type_line: 'Creature - Human', oracle_text: '' },
        ],
        libraryCount: 2,
      },
    };
    (game as any).libraries.set(p1, [...(game.state as any).zones[p1].library]);
    (game.state as any).stack = [
      {
        id: 'trigger_optional_discard_land_rider',
        type: 'triggered_ability',
        controller: p1,
        source: 'source_perm',
        permanentId: 'source_perm',
        sourceName: 'Rummaging Source',
        description: 'You may discard a card. If you do, draw a card. If a land card was discarded this way, draw an additional card.',
        effect: 'You may discard a card. If you do, draw a card. If a land card was discarded this way, draw an additional card.',
        mandatory: true,
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    game.resolveTopOfStack();

    expect(((game.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual(['land_1', 'spell_1']);

    const askStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.optionalDiscardThenDrawChoice === true) as any;
    expect(askStep).toMatchObject({
      type: ResolutionStepType.OPTION_CHOICE,
      sourceId: 'source_perm',
      sourceName: 'Rummaging Source',
      optionalDiscardThenDrawCount: 1,
      optionalDiscardThenDrawCountIfDiscardedLand: 1,
    });

    await handlers['submitResolutionResponse']({ gameId, stepId: askStep.id, selections: 'discard' });

    const discardStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) => step?.type === ResolutionStepType.DISCARD_SELECTION) as any;
    expect(discardStep).toMatchObject({
      type: ResolutionStepType.DISCARD_SELECTION,
      sourceName: 'Rummaging Source',
      discardCount: 1,
      afterDiscardDrawCount: 1,
      afterDiscardDrawCountIfDiscardedLand: 1,
    });

    const promptEvent = [...getEvents(gameId)].reverse().find((event: any) =>
      event.type === 'resolveTopOfStackPrompt' &&
      event.payload?.queuedResolutionStep?.type === ResolutionStepType.DISCARD_SELECTION
    ) as any;
    expect(promptEvent?.payload?.queuedResolutionStep).toMatchObject({
      type: ResolutionStepType.DISCARD_SELECTION,
      sourceName: 'Rummaging Source',
      afterDiscardDrawCount: 1,
      afterDiscardDrawCountIfDiscardedLand: 1,
    });

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: discardStep.id,
      selections: ['land_1'],
    });

    const zones = (game.state as any).zones[p1];
    expect((zones.hand || []).map((card: any) => card.id)).toEqual(['spell_1', 'draw_1', 'draw_2']);
    expect((zones.graveyard || []).map((card: any) => card.id)).toEqual(['land_1']);

    const drawEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'drawCards') as any;
    expect(drawEvent?.payload).toEqual({ playerId: p1, count: 2 });
  });
});