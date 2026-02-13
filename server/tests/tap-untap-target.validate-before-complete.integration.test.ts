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

describe('TAP_UNTAP_TARGET validate-before-complete (integration)', () => {
  const gameId = 'test_tap_untap_target_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on invalid target count / target ids', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } };

    const sourceId = 'src_perm';
    const targetId = 'tgt_perm';

    (game.state as any).battlefield = [
      {
        id: sourceId,
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'c_src', name: 'Source', type_line: 'Artifact — Test' },
      },
      {
        id: targetId,
        controller: p1,
        owner: p1,
        tapped: false,
        card: { id: 'c_tgt', name: 'Target', type_line: 'Creature — Test', power: '1', toughness: '1' },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      playerId: p1 as any,
      description: 'Tap a creature you control',
      mandatory: true,
      sourceId,
      action: 'tap',
      targetCount: 1,
      targetFilter: { controller: 'you', types: ['creature'], excludeSource: true, tapStatus: 'untapped' },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'tap_untap_target');
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    // Invalid: wrong target count
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { targetIds: [] } });
    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_TARGET_COUNT');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    // Valid: correct target id
    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { targetIds: [targetId] } });
    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    const battlefield = (game.state as any).battlefield as any[];
    const perm = battlefield.find(p => p.id === targetId);
    expect(Boolean(perm?.tapped)).toBe(true);
  });
});
