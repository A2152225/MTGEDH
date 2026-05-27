import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const KEYWORD_PROMPT_STEP_TYPES = [
  ResolutionStepType.RIOT_CHOICE,
  ResolutionStepType.UNLEASH_CHOICE,
  ResolutionStepType.FABRICATE_CHOICE,
  ResolutionStepType.TRIBUTE_CHOICE,
  ResolutionStepType.MENTOR_TARGET,
  ResolutionStepType.EXPLOIT_CHOICE,
  ResolutionStepType.EXTORT_PAYMENT,
  ResolutionStepType.MODULAR_CHOICE,
  ResolutionStepType.SOULSHIFT_TARGET,
  ResolutionStepType.DEVOUR_SELECTION,
];

function addActiveStep(gameId: string, type: ResolutionStepType, extra: Record<string, any> = {}) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type,
    playerId: 'p1' as any,
    description: 'Resolve keyword prompt.',
    mandatory: true,
    sourceId: 'perm_source',
    permanentId: 'perm_source',
    ...extra,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

function expectStepCleared(gameId: string, type: ResolutionStepType) {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  expect(queue.activeStep?.type).not.toBe(type);
  expect((queue.steps || []).some((entry: any) => entry?.type === type)).toBe(false);
}

describe('keywordPromptResolve replay semantics', () => {
  it.each(KEYWORD_PROMPT_STEP_TYPES)('clears a replay-restored %s step by resolved step id', (stepType) => {
    const gameId = `t_keyword_prompt_resolve_${String(stepType)}`;
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const step = addActiveStep(gameId, stepType, stepType === ResolutionStepType.DEVOUR_SELECTION ? { creatureId: 'perm_source' } : {});

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      resolvedStepId: step.id,
      stepType,
      sourceId: 'perm_source',
      permanentId: 'perm_source',
    } as any);

    expectStepCleared(gameId, stepType);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('clears a replay-restored keyword step by semantic fallback when resolvedStepId is absent', () => {
    const gameId = 't_keyword_prompt_resolve_fallback';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    addActiveStep(gameId, ResolutionStepType.RIOT_CHOICE);

    game.applyEvent({
      type: 'keywordPromptResolve',
      playerId: 'p1',
      stepType: ResolutionStepType.RIOT_CHOICE,
      sourceId: 'perm_source',
      permanentId: 'perm_source',
    } as any);

    expectStepCleared(gameId, ResolutionStepType.RIOT_CHOICE);
    ResolutionQueueManager.removeQueue(gameId);
  });
});