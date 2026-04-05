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

describe('discard effect replay (integration)', () => {
  const gameId = 'test_discard_effect_replay';

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

  it('replays generic discard-selection results and follow-up draws', async () => {
    const playerId = 'p1';
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };

    const deck = [
      { id: 'discard_land_1', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '{T}: Add {G}.' },
      { id: 'discard_spell_1', name: 'Spell One', type_line: 'Sorcery', oracle_text: '' },
      { id: 'draw_1', name: 'Draw One', type_line: 'Instant', oracle_text: '' },
      { id: 'draw_2', name: 'Draw Two', type_line: 'Creature - Human', oracle_text: '' },
    ];

    const seedEvents = [
      { type: 'deckImportResolved', payload: { playerId, cards: deck } },
      { type: 'drawCards', payload: { playerId, count: 2 } },
    ];

    let seq = 0;
    for (const event of seedEvents) {
      appendEvent(gameId, seq++, event.type, event.payload);
      game.applyEvent({ type: event.type, ...event.payload } as any);
    }

    const zonesBeforeDiscard = (game.state as any).zones?.[playerId];
    expect((zonesBeforeDiscard?.hand || []).map((card: any) => card.id)).toEqual(['discard_land_1', 'discard_spell_1']);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: playerId as any,
      description: 'You may discard a card. If you do, draw a card. If a land card was discarded this way, draw an additional card.',
      sourceName: 'Replay Probe',
      mandatory: true,
      discardCount: 1,
      hand: (zonesBeforeDiscard?.hand || []).map((card: any) => ({ ...card })),
      destination: 'graveyard',
      afterDiscardDrawCount: 1,
      afterDiscardDrawCountIfDiscardedLand: 1,
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
      selections: ['discard_land_1'],
    });

    const liveZones = (game.state as any).zones?.[playerId];
    expect((liveZones?.hand || []).map((card: any) => card.id)).toEqual(['discard_spell_1', 'draw_1', 'draw_2']);
    expect((liveZones?.graveyard || []).map((card: any) => card.id)).toContain('discard_land_1');

    const persistedEvents = getEvents(gameId);
    const discardEffectEvent = [...persistedEvents].reverse().find((event) => event.type === 'discardEffect') as any;
    const drawCardsEvent = [...persistedEvents].reverse().find((event) => event.type === 'drawCards' && Number((event as any)?.payload?.count || 0) === 2) as any;

    expect(discardEffectEvent?.payload).toEqual({
      playerId,
      cardIds: ['discard_land_1'],
      destination: 'graveyard',
    });
    expect(drawCardsEvent?.payload).toEqual({ playerId, count: 2 });

    game.reset!(true);
    game.replay!(transformDbEventsForReplay(getEvents(gameId) as any));

    const replayedZones = (game.state as any).zones?.[playerId];
    expect((replayedZones?.hand || []).map((card: any) => card.id)).toEqual(['discard_spell_1', 'draw_1', 'draw_2']);
    expect((replayedZones?.graveyard || []).map((card: any) => card.id)).toContain('discard_land_1');
  });
});