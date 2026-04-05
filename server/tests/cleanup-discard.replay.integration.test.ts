import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, createGameIfNotExists, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import '../src/state/modules/priority.js';
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

describe('cleanup discard replay (integration)', () => {
  const gameId = 'test_cleanup_discard_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    try {
      truncateEventsForUndo(gameId, 0);
    } catch {
      // ignore
    }
  });

  it('persists cleanup discards so reset and replay reconstruct the discarded card', async () => {
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
});