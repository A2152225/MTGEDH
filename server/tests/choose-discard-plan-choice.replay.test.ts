import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addChooseDiscardPlanPrompt(gameId: string, playerId: PlayerID) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    description: 'Source: Choose discard option',
    mandatory: true,
    sourceName: 'Source',
    options: [
      { id: 'discard_artifact', label: 'Discard an artifact card' },
      { id: 'discard_two', label: 'Discard two cards' },
    ],
    minSelections: 1,
    maxSelections: 1,
    chooseDiscardPlanChoice: true,
    chooseDiscardPlanPlayerId: playerId,
    chooseDiscardPlanSourceName: 'Source',
    chooseDiscardPlanPreferredOptionId: 'discard_artifact',
    chooseDiscardPlanPreferredType: 'artifact',
    chooseDiscardPlanPreferredCount: 1,
    chooseDiscardPlanFallbackCount: 2,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('choose discard plan replay semantics', () => {
  it('replays a queued discard-selection prompt and clears the original choice prompt', () => {
    const gameId = 't_choose_discard_plan_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addChooseDiscardPlanPrompt(gameId, p1);

    game.applyEvent({
      type: 'chooseDiscardPlanChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceName: 'Source',
      resolvedStepId: step.id,
      choice: 'discard_artifact',
      branch: 'preferred',
      preferredOptionId: 'discard_artifact',
      preferredType: 'artifact',
      preferredCount: 1,
      fallbackCount: 2,
      queuedResolutionStep: {
        id: 'discard_selection_1',
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: p1,
        description: 'Source: Discard 1 artifact card',
        mandatory: true,
        sourceName: 'Source',
        discardCount: 1,
        hand: [{ id: 'artifact_1', name: 'Relic', type_line: 'Artifact' }],
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.chooseDiscardPlanChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.chooseDiscardPlanChoice === true)).toBe(false);
    const discardStep = (queue.steps || []).find((entry: any) => entry?.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardStep).toMatchObject({
      id: 'discard_selection_1',
      playerId: p1,
      discardCount: 1,
    });
    expect((discardStep.hand || []).map((card: any) => card.id)).toEqual(['artifact_1']);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays a no-cards outcome by only clearing the original choice prompt', () => {
    const gameId = 't_choose_discard_plan_no_cards_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addChooseDiscardPlanPrompt(gameId, p1);

    game.applyEvent({
      type: 'chooseDiscardPlanChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceName: 'Source',
      resolvedStepId: step.id,
      choice: 'discard_two',
      branch: 'no_cards',
      preferredOptionId: 'discard_artifact',
      preferredType: 'artifact',
      preferredCount: 1,
      fallbackCount: 2,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.chooseDiscardPlanChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.chooseDiscardPlanChoice === true)).toBe(false);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.DISCARD_SELECTION)).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});