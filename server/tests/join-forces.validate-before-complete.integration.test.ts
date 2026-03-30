import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('JOIN_FORCES validate-before-complete (integration)', () => {
  const gameId = 'test_join_forces_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on an over-budget contribution', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } };

    // Provide some battlefield mana sources so the handler can tap if needed.
    (game.state as any).battlefield = [
      { id: 'land1', controller: p1, owner: p1, tapped: false, card: { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' } },
      { id: 'land2', controller: p1, owner: p1, tapped: false, card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' } },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.JOIN_FORCES,
      playerId: p1 as any,
      description: 'Join Forces: contribute mana',
      mandatory: true,
      cardName: 'Minds Aglow',
      initiator: p1,
      availableMana: 2,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'join_forces');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 3 });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INSUFFICIENT_MANA');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: 2 });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);
  });

  it('resolves Minds Aglow through game.drawCards when no libraries map is attached', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    (game.state as any).battlefield = [
      { id: 'land1', controller: p1, owner: p1, tapped: false, card: { name: 'Island', type_line: 'Basic Land — Island', oracle_text: '' } },
    ];

    const drawCalls: Array<{ playerId: string; count: number }> = [];
    (game as any).libraries = undefined;
    (game as any).drawCards = (playerId: string, count: number) => {
      drawCalls.push({ playerId, count });
      const zone = (game.state as any).zones[playerId];
      for (let index = 0; index < count; index += 1) {
        zone.hand.push({ id: `${playerId}_draw_${index}`, name: `Draw ${index}`, type_line: 'Test', oracle_text: '' });
      }
      zone.handCount = zone.hand.length;
      zone.libraryCount = Math.max(0, Number(zone.libraryCount || 0) - count);
      return zone.hand;
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.JOIN_FORCES,
      playerId: p1 as any,
      description: 'Minds Aglow: contribute mana',
      mandatory: false,
      cardName: 'Minds Aglow',
      sourceName: 'Minds Aglow',
      initiator: p1,
      availableMana: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'join_forces');
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: 1 });

    expect(drawCalls).toEqual([
      { playerId: p1, count: 1 },
      { playerId: p2, count: 1 },
    ]);
    expect((game.state as any).zones[p1].handCount).toBe(1);
    expect((game.state as any).zones[p2].handCount).toBe(1);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});
