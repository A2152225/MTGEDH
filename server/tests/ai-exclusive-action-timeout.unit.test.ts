import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';

const executePassPriority = vi.fn(async () => {});

vi.mock('../src/socket/ai-handlers/aiPriorityPassCombatExecutors.js', () => ({
  executePassPriority: (...args: any[]) => executePassPriority(...args),
}));

vi.mock('../src/state/modules/gameStall/gameStallDetector.js', () => ({
  noteGameStallAiFailure: vi.fn(),
  observeGameStallAiActionById: vi.fn(),
}));

vi.mock('../src/gameRestoreState.js', () => ({
  isGameRestoring: () => false,
}));

vi.mock('../src/socket/aiHandlerDeps.js', () => ({
  getAIHandlerDeps: () => ({
    handleAIGameFlow: async () => {},
    handleAIPriority: async () => {},
  }),
}));

import {
  aiActionsInProgress,
  getAIActionGenerationForTests,
  getAIActionKey,
  resetAIActionLocksForTests,
  runExclusiveAIAction,
} from '../src/socket/ai-handlers/aiScheduler.js';
import { noteGameStallAiFailure, observeGameStallAiActionById } from '../src/state/modules/gameStall/gameStallDetector.js';

describe('runExclusiveAIAction hang safety', () => {
  const io = {} as Server;
  const gameId = 'ai_timeout_game';
  const playerId = 'ai_1' as any;

  beforeEach(() => {
    resetAIActionLocksForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetAIActionLocksForTests();
  });

  it('releases the in-progress lock and force-passes when an action never settles', async () => {
    let releaseHang: (() => void) | undefined;
    const hang = new Promise<void>((resolve) => {
      releaseHang = resolve;
    });

    const genBefore = getAIActionGenerationForTests(gameId, playerId);
    await expect(
      runExclusiveAIAction(io, gameId, playerId, 'priority', async () => hang, { timeoutMs: 50 }),
    ).resolves.toBeUndefined();

    const key = getAIActionKey(gameId, playerId);
    expect(aiActionsInProgress.has(key)).toBe(false);
    expect(getAIActionGenerationForTests(gameId, playerId)).toBeGreaterThan(genBefore);
    expect(noteGameStallAiFailure).toHaveBeenCalled();
    expect(executePassPriority).toHaveBeenCalledWith(
      io,
      gameId,
      playerId,
      expect.objectContaining({ allowActiveMainPhaseAutoAdvance: true }),
    );
    expect(observeGameStallAiActionById).toHaveBeenCalled();

    // Late completion of the hung action must not clear a newer lock.
    aiActionsInProgress.add(key);
    const genDuring = getAIActionGenerationForTests(gameId, playerId);
    releaseHang?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(aiActionsInProgress.has(key)).toBe(true);
    expect(getAIActionGenerationForTests(gameId, playerId)).toBe(genDuring);
    aiActionsInProgress.delete(key);
  });

  it('still clears the lock normally when the action finishes quickly', async () => {
    await runExclusiveAIAction(io, gameId, playerId, 'priority', async () => {}, { timeoutMs: 500 });
    expect(aiActionsInProgress.has(getAIActionKey(gameId, playerId))).toBe(false);
    expect(executePassPriority).not.toHaveBeenCalled();
  });
});
