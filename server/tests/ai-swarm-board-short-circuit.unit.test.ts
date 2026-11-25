import { describe, expect, it, vi } from 'vitest';
import {
  isSwarmBattlefield,
  SWARM_BATTLEFIELD_BF,
  tryAISwarmBoardShortCircuit,
} from '../src/socket/ai-handlers/aiSwarmBoardShortCircuit.js';

describe('aiSwarmBoardShortCircuit', () => {
  it('detects swarm boards at the threshold', () => {
    expect(isSwarmBattlefield({ state: { battlefield: new Array(SWARM_BATTLEFIELD_BF - 1).fill({}) } })).toBe(false);
    expect(isSwarmBattlefield({ state: { battlefield: new Array(SWARM_BATTLEFIELD_BF).fill({}) } })).toBe(true);
  });

  it('passes with a non-empty stack on swarm boards', async () => {
    const executePassPriority = vi.fn(async () => {});
    const handled = await tryAISwarmBoardShortCircuit(
      {} as any,
      {
        state: {
          battlefield: new Array(SWARM_BATTLEFIELD_BF).fill({}),
          stack: [{ id: 's1' }],
          priority: 'p1',
          turnPlayer: 'p1',
          phase: 'beginning',
          step: 'UPKEEP',
          players: [{ id: 'p1', isAI: true }],
        },
      },
      'g1',
      'p1',
      {
        executePassPriority,
        executeDeclareAttackers: vi.fn(async () => {}),
        executeDeclareBlockers: vi.fn(async () => {}),
        executeAdvanceStep: vi.fn(async () => {}),
        handleAIResolutionStep: vi.fn(async () => {}),
      },
    );
    expect(handled).toBe(true);
    expect(executePassPriority).toHaveBeenCalledOnce();
  });

  it('empty-declares attackers on swarm boards', async () => {
    const executeDeclareAttackers = vi.fn(async () => {});
    const handled = await tryAISwarmBoardShortCircuit(
      {} as any,
      {
        state: {
          battlefield: new Array(SWARM_BATTLEFIELD_BF).fill({}),
          stack: [],
          priority: 'p1',
          turnPlayer: 'p1',
          phase: 'combat',
          step: 'DECLARE_ATTACKERS',
          players: [{ id: 'p1', isAI: true }],
        },
      },
      'g1',
      'p1',
      {
        executePassPriority: vi.fn(async () => {}),
        executeDeclareAttackers,
        executeDeclareBlockers: vi.fn(async () => {}),
        executeAdvanceStep: vi.fn(async () => {}),
        handleAIResolutionStep: vi.fn(async () => {}),
      },
    );
    expect(handled).toBe(true);
    expect(executeDeclareAttackers).toHaveBeenCalledWith(expect.anything(), 'g1', 'p1', []);
  });

  it('advances CLEANUP for the AI turn player even when priority is null', async () => {
    const executeAdvanceStep = vi.fn(async () => {});
    const handled = await tryAISwarmBoardShortCircuit(
      {} as any,
      {
        state: {
          battlefield: new Array(SWARM_BATTLEFIELD_BF).fill({}),
          stack: [],
          priority: null,
          turnPlayer: 'p1',
          phase: 'ending',
          step: 'CLEANUP',
          players: [{ id: 'p1', isAI: true }],
        },
      },
      'g1',
      'p1',
      {
        executePassPriority: vi.fn(async () => {}),
        executeDeclareAttackers: vi.fn(async () => {}),
        executeDeclareBlockers: vi.fn(async () => {}),
        executeAdvanceStep,
        handleAIResolutionStep: vi.fn(async () => {}),
      },
    );
    expect(handled).toBe(true);
    expect(executeAdvanceStep).toHaveBeenCalledWith(expect.anything(), 'g1', 'p1');
  });

  it('passes CLEANUP with a non-empty stack instead of advancing (Rule 514.3)', async () => {
    const executePassPriority = vi.fn(async () => {});
    const executeAdvanceStep = vi.fn(async () => {});
    const state: any = {
      battlefield: new Array(SWARM_BATTLEFIELD_BF).fill({}),
      stack: [{ id: 'undead_alchemist' }],
      priority: null,
      turnPlayer: 'p1',
      phase: 'ending',
      step: 'CLEANUP',
      players: [{ id: 'p1', isAI: true }],
    };
    const handled = await tryAISwarmBoardShortCircuit(
      {} as any,
      { state },
      'g1',
      'p1',
      {
        executePassPriority,
        executeDeclareAttackers: vi.fn(async () => {}),
        executeDeclareBlockers: vi.fn(async () => {}),
        executeAdvanceStep,
        handleAIResolutionStep: vi.fn(async () => {}),
      },
    );
    expect(handled).toBe(true);
    expect(state.priority).toBe('p1');
    expect(executePassPriority).toHaveBeenCalledOnce();
    expect(executeAdvanceStep).not.toHaveBeenCalled();
  });
});
