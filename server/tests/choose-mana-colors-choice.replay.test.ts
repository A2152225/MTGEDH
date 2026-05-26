import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addChooseManaColorsStep(gameId: string, playerId: PlayerID, overrides: Record<string, any> = {}) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    description: 'Source: Choose a color',
    mandatory: true,
    sourceName: 'Source',
    options: [
      { id: 'white', label: 'White' },
      { id: 'blue', label: 'Blue' },
      { id: 'black', label: 'Black' },
      { id: 'red', label: 'Red' },
      { id: 'green', label: 'Green' },
    ],
    minSelections: 1,
    maxSelections: 1,
    chooseManaColorsChoice: true,
    chooseManaColorsController: playerId,
    chooseManaColorsSourceName: 'Source',
    chooseManaColorsSourceId: 'source_perm',
    chooseManaColorsRestriction: 'unrestricted',
    chooseManaColorsSelectionsTotal: 1,
    chooseManaColorsAmountPerSelection: 1,
    ...overrides,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('choose mana colors replay semantics', () => {
  it('replays an intermediate color choice by clearing the current prompt and queuing the next one', () => {
    const gameId = 't_choose_mana_colors_intermediate_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const firstStep = addChooseManaColorsStep(gameId, p1, {
      description: 'Source: Choose a color for the first mana',
      chooseManaColorsSelectionsTotal: 2,
    });
    const queuedResolutionStep = {
      id: 'choose_mana_color_second_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a color for the next mana',
      mandatory: true,
      sourceName: 'Source',
      options: firstStep.options,
      minSelections: 1,
      maxSelections: 1,
      chooseManaColorsChoice: true,
      chooseManaColorsController: p1,
      chooseManaColorsSourceName: 'Source',
      chooseManaColorsSourceId: 'source_perm',
      chooseManaColorsRestriction: 'unrestricted',
      chooseManaColorsSelectionsTotal: 2,
      chooseManaColorsAmountPerSelection: 1,
      chooseManaColorsChosen: ['green'],
    };

    game.applyEvent({
      type: 'chooseManaColorsChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm',
      sourceName: 'Source',
      resolvedStepId: firstStep.id,
      chosenColor: 'green',
      chosenColors: ['green'],
      restriction: 'unrestricted',
      selectionsTotal: 2,
      amountPerSelection: 1,
      queuedResolutionStep,
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.chooseManaColorsChoice).not.toBe(true);
    expect((queue.steps || []).some((step: any) => String(step.id) === String(firstStep.id))).toBe(false);
    const nextStep = (queue.steps || []).find((step: any) => step?.chooseManaColorsChoice === true);
    expect(nextStep).toBeDefined();
    expect(nextStep.id).toBe('choose_mana_color_second_1');
    expect(nextStep.chooseManaColorsChosen).toEqual(['green']);
    expect((game.state as any).manaPool?.[p1]?.green || 0).toBe(0);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays a final unrestricted color choice by adding the recorded mana', () => {
    const gameId = 't_choose_mana_colors_unrestricted_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = addChooseManaColorsStep(gameId, p1, {
      description: 'Source: Choose a color to add ten mana',
      chooseManaColorsSelectionsTotal: 1,
      chooseManaColorsAmountPerSelection: 10,
    });

    game.applyEvent({
      type: 'chooseManaColorsChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm',
      sourceName: 'Source',
      resolvedStepId: step.id,
      chosenColor: 'red',
      chosenColors: ['red'],
      restriction: 'unrestricted',
      selectionsTotal: 1,
      amountPerSelection: 10,
      manaAdded: { red: 10 },
    } as any);

    expect(Number((game.state as any).manaPool?.[p1]?.red || 0)).toBe(10);
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.chooseManaColorsChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.chooseManaColorsChoice === true)).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays a final restricted color choice by restoring restricted mana entries', () => {
    const gameId = 't_choose_mana_colors_restricted_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = addChooseManaColorsStep(gameId, p1, {
      description: 'Source: Choose a color for Dragon mana',
      chooseManaColorsRestriction: 'dragon_spells',
      chooseManaColorsSelectionsTotal: 2,
      chooseManaColorsAmountPerSelection: 1,
      chooseManaColorsChosen: ['blue'],
    });

    game.applyEvent({
      type: 'chooseManaColorsChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm',
      sourceName: 'Source',
      resolvedStepId: step.id,
      chosenColor: 'red',
      chosenColors: ['blue', 'red'],
      restriction: 'dragon_spells',
      selectionsTotal: 2,
      amountPerSelection: 1,
      manaAdded: { blue: 1, red: 1 },
    } as any);

    const restricted = ((game.state as any).manaPool?.[p1]?.restricted || []) as any[];
    expect(restricted).toHaveLength(2);
    expect(restricted.map((entry) => entry.type)).toEqual(['blue', 'red']);
    expect(restricted.every((entry) => entry.restriction === 'dragon_spells')).toBe(true);
    expect(restricted.every((entry) => entry.sourceId === 'source_perm')).toBe(true);

    ResolutionQueueManager.removeQueue(gameId);
  });
});