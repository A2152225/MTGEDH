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
    rooms: { has: (_room: string) => true, add: (_room: string) => {}, delete: (_room: string) => {} } as any,
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('MUTATE_TARGET_SELECTION validate-before-complete (integration)', () => {
  const gameId = 'test_mutate_target_selection_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('does not consume the step on invalid mutate target selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = { [p1]: { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } };

    const effectId = 'eff_mutate_1';
    (game.state as any).pendingSpellCasts = {
      [effectId]: {
        cardId: 'card_mutate',
        cardName: 'Mutate Spell',
        manaCost: '{2}{G}',
        targets: [],
      },
    };

    const validTargetId = 'perm_1';
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MUTATE_TARGET_SELECTION,
      playerId: p1 as any,
      description: 'Choose a mutate target',
      mandatory: true,
      effectId,
      cardId: 'card_mutate',
      cardName: 'Mutate Spell',
      mutateCost: '{2}{G}',
      validTargets: [{ id: validTargetId, name: 'Target' }],
      sourceName: 'Mutate Spell',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((s: any) => s.type === 'mutate_target_selection');
    expect(step).toBeDefined();
    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { targetPermanentId: 'nope', onTop: true } });
    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_TARGET');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((s: any) => String(s.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({ gameId, stepId, selections: { targetPermanentId: validTargetId, onTop: true } });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((s: any) => String(s.id) === stepId)).toBe(false);

    const pending = (game.state as any).pendingSpellCasts?.[effectId];
    expect(pending?.mutateTarget).toBe(validTargetId);

    const followup = queueAfterOk.steps.find((s: any) => s.type === 'mana_payment_choice');
    expect(followup).toBeDefined();
  });
});
