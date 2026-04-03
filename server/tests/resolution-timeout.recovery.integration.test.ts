import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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
    sockets: {
      sockets: new Map(),
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

describe('resolution timeout recovery', () => {
  const liveGameId = 'test_resolution_timeout_recovery_live';
  const replayGameId = 'test_resolution_timeout_recovery_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    vi.useFakeTimers();
    ResolutionQueueManager.removeQueue(liveGameId);
    ResolutionQueueManager.removeQueue(replayGameId);
    games.delete(liveGameId as any);
    games.delete(replayGameId as any);
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    ResolutionQueueManager.removeQueue(liveGameId);
    ResolutionQueueManager.removeQueue(replayGameId);
    games.delete(liveGameId as any);
    games.delete(replayGameId as any);
  });

  it('times out a stuck resolution step, logs it as broken, and restores priority', async () => {
    createGameIfNotExists(liveGameId, 'commander', 40);
    const game = ensureGame(liveGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: 'p1',
      players: [
        { id: 'p1', name: 'P1', spectator: false, life: 40 },
        { id: 'p2', name: 'P2', spectator: false, life: 40 },
      ],
      zones: {
        p1: { hand: [], library: [], graveyard: [], exile: [] },
        p2: { hand: [], library: [], graveyard: [], exile: [] },
      },
      battlefield: [],
      stack: [],
      pendingSpellCasts: {
        cast_1: {
          cardId: 'spell_1',
          playerId: 'p1',
        },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const playerSocket = {
      data: { playerId: 'p1', spectator: false },
      emit: (event: string, payload: any) => emitted.push({ event, payload }),
      rooms: new Set([liveGameId]),
    } as any;
    const io = createMockIo(emitted, [playerSocket]);
    initializePriorityResolutionHandler(io as any);

    ResolutionQueueManager.addStep(liveGameId, {
      id: 'step_timeout_live',
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as any,
      description: 'Choose a target for Broken Spell',
      mandatory: true,
      sourceId: 'effect_1',
      sourceName: 'Broken Spell',
      timeoutMs: 1000,
      validTargets: [{ id: 'p2', label: 'P2', description: 'player' }],
      targetTypes: ['player'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'player',
      spellCastContext: {
        effectId: 'cast_1',
        cardId: 'spell_1',
        cardName: 'Broken Spell',
        manaCost: '{1}{R}',
        playerId: 'p1',
      },
    } as any);

    expect((game.state as any).priority).toBeNull();

    await vi.advanceTimersByTimeAsync(1000);

    expect(ResolutionQueueManager.getQueue(liveGameId).steps).toHaveLength(0);
    expect((game.state as any).pendingSpellCasts.cast_1).toBeUndefined();
    expect((game.state as any).priority).toBe('p1');

    expect(emitted.some(entry =>
      entry.event === 'resolutionStepCancelled' && entry.payload?.reason === 'timeout' && entry.payload?.stepId === 'step_timeout_live'
    )).toBe(true);

    const chatEntry = emitted.find(entry => entry.event === 'chat' && typeof entry.payload?.message === 'string');
    expect(chatEntry?.payload?.message).toContain('Broken Spell');
    expect(chatEntry?.payload?.message).toContain('marked as broken');
  });

  it('replays timeout recovery by cancelling the recorded step and restoring priority', () => {
    createGameIfNotExists(replayGameId, 'commander', 40);
    const game = ensureGame(replayGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: 'p1',
      priority: null,
      players: [
        { id: 'p1', name: 'P1', spectator: false, life: 40 },
      ],
      zones: {
        p1: { hand: [], library: [], graveyard: [], exile: [] },
      },
      battlefield: [],
      stack: [],
    });

    ResolutionQueueManager.addStep(replayGameId, {
      id: 'step_timeout_replay',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1' as any,
      description: 'Choose an option',
      mandatory: false,
      options: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    } as any);

    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toHaveLength(1);

    game.applyEvent({
      type: 'resolutionStepTimeoutRecovery',
      stepId: 'step_timeout_replay',
      cancelledStepIds: ['step_timeout_replay'],
    });

    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toHaveLength(0);
    expect((game.state as any).priority).toBe('p1');
  });
});
