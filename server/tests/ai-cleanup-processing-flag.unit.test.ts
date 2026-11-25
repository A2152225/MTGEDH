import { describe, expect, it, vi } from 'vitest';
import { tryHandleAiCleanupStep } from '../src/socket/ai-handlers/aiCleanupStepHandlers.js';

describe('tryHandleAiCleanupStep processing flag', () => {
  it('clears _aiProcessingCleanup after Rule 514.3 pass', async () => {
    const game: any = {
      state: {
        step: 'CLEANUP',
        turnPlayer: 'ai_1',
        priority: null,
        stack: [{ id: 's1' }],
        _aiProcessingCleanup: {},
      },
    };

    const executePassPriority = vi.fn(async () => undefined);
    await tryHandleAiCleanupStep({} as any, game, 'g1', 'ai_1' as any, {
      isAITurn: true,
      hasPriority: false,
      handleAIResolutionStep: vi.fn(async () => undefined),
      executePassPriority,
    });

    expect(executePassPriority).toHaveBeenCalled();
    expect(game.state._aiProcessingCleanup.ai_1).toBeUndefined();
  });

  it('clears _aiProcessingCleanup even when pass throws', async () => {
    const game: any = {
      state: {
        step: 'CLEANUP',
        turnPlayer: 'ai_1',
        priority: null,
        stack: [{ id: 's1' }],
        _aiProcessingCleanup: {},
      },
    };

    await expect(
      tryHandleAiCleanupStep({} as any, game, 'g1', 'ai_1' as any, {
        isAITurn: true,
        hasPriority: false,
        handleAIResolutionStep: vi.fn(async () => undefined),
        executePassPriority: vi.fn(async () => {
          throw new Error('pass failed');
        }),
      }),
    ).rejects.toThrow('pass failed');

    expect(game.state._aiProcessingCleanup.ai_1).toBeUndefined();
  });
});
