import { describe, expect, it } from 'vitest';
import { collectPromptStepIdsCompletedBeforeReplayEnd } from '../src/state/resolution/replayCompletedPromptSteps.js';

function prompt(id: string, extra: Record<string, unknown> = {}) {
  return { type: 'resolveTopOfStackPrompt', playerId: 'p1', queuedResolutionStep: { id, type: 'target_selection', ...extra } };
}

describe('collectPromptStepIdsCompletedBeforeReplayEnd', () => {
  it('treats a prompt followed by a later player event as answered', () => {
    const completed = collectPromptStepIdsCompletedBeforeReplayEnd([
      prompt('s1'),
      { type: 'passPriority', by: 'p1' },
    ]);
    expect([...completed]).toEqual(['s1']);
  });

  it('keeps a prompt open when only life/counter mutations from the same resolution follow it', () => {
    const completed = collectPromptStepIdsCompletedBeforeReplayEnd([
      prompt('s1'),
      { type: 'adjustLife', playerId: 'p2', delta: -3, oracleIrReplayMutation: true },
      { type: 'updateCounters', permanentId: 'x', counters: { '+1/+1': 1 }, oracleIrReplayMutation: true },
    ]);
    expect(completed.size).toBe(0);
  });

  it('keeps every copy retarget prompt open until its own answer event', () => {
    const events = [
      { type: 'copyTriggeredAbilityResolve', copiedStackItemId: 'c1' },
      prompt('r1', { type: 'option_choice', retargetAbilityCopy: true }),
      { type: 'copyTriggeredAbilityResolve', copiedStackItemId: 'c2' },
      prompt('r2', { type: 'option_choice', retargetAbilityCopy: true }),
    ];
    expect(collectPromptStepIdsCompletedBeforeReplayEnd(events).size).toBe(0);

    const answered = collectPromptStepIdsCompletedBeforeReplayEnd([
      ...events,
      { type: 'copyRetargetChoiceResolve', resolvedStepId: 'r1', choiceId: 'keep' },
    ]);
    expect([...answered]).toEqual(['r1']);
  });
});
