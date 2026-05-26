import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addAskPrompt(gameId: string, playerId: PlayerID) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId,
    description: 'Source Walker: You may sacrifice another permanent. If you do, you gain 3 life and draw a card.',
    mandatory: true,
    sourceId: 'source_perm',
    sourceName: 'Source Walker',
    options: [
      { id: 'sac', label: 'Sacrifice a permanent' },
      { id: 'dont', label: "Don't sacrifice" },
    ],
    minSelections: 1,
    maxSelections: 1,
    sacrificeAnotherPermanentForBenefitChoice: true,
    sacrificeAnotherPermanentForBenefitStage: 'ask',
    sacrificeAnotherPermanentForBenefitController: playerId,
    sacrificeAnotherPermanentForBenefitSourceName: 'Source Walker',
    sacrificeAnotherPermanentForBenefitSourcePermanentId: 'source_perm',
    sacrificeAnotherPermanentForBenefitLifeGain: 3,
    sacrificeAnotherPermanentForBenefitDrawCount: 1,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

function addSelectPrompt(gameId: string, playerId: PlayerID) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId,
    description: 'Choose a permanent to sacrifice',
    mandatory: true,
    sourceId: 'source_perm',
    sourceName: 'Source Walker',
    validTargets: [{ id: 'other_perm', label: 'Treasure Token', description: 'Artifact' }],
    targetTypes: ['sacrifice_target'],
    minTargets: 1,
    maxTargets: 1,
    targetDescription: 'a permanent you control',
    sacrificeAnotherPermanentForBenefitChoice: true,
    sacrificeAnotherPermanentForBenefitStage: 'select_sacrifice',
    sacrificeAnotherPermanentForBenefitController: playerId,
    sacrificeAnotherPermanentForBenefitSourceName: 'Source Walker',
    sacrificeAnotherPermanentForBenefitSourcePermanentId: 'source_perm',
    sacrificeAnotherPermanentForBenefitLifeGain: 3,
    sacrificeAnotherPermanentForBenefitDrawCount: 1,
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('sacrifice another permanent for benefit replay semantics', () => {
  it('replays accepting the ask prompt by clearing it and restoring the target-selection prompt', () => {
    const gameId = 't_sacrifice_another_permanent_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    const step = addAskPrompt(gameId, p1);

    game.applyEvent({
      type: 'sacrificeAnotherPermanentForBenefitChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm',
      sourceName: 'Source Walker',
      resolvedStepId: step.id,
      choice: 'sacrifice',
      sourcePermanentId: 'source_perm',
      lifeGain: 3,
      drawCount: 1,
      validTargetIds: ['other_perm'],
      queuedResolutionStep: {
        id: 'sacrifice_followup_1',
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: p1,
        description: 'Choose a permanent to sacrifice',
        mandatory: true,
        sourceId: 'source_perm',
        sourceName: 'Source Walker',
        validTargets: [{ id: 'other_perm', label: 'Treasure Token', description: 'Artifact' }],
        targetTypes: ['sacrifice_target'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'a permanent you control',
        sacrificeAnotherPermanentForBenefitChoice: true,
        sacrificeAnotherPermanentForBenefitStage: 'select_sacrifice',
        sacrificeAnotherPermanentForBenefitController: p1,
        sacrificeAnotherPermanentForBenefitSourceName: 'Source Walker',
        sacrificeAnotherPermanentForBenefitSourcePermanentId: 'source_perm',
        sacrificeAnotherPermanentForBenefitLifeGain: 3,
        sacrificeAnotherPermanentForBenefitDrawCount: 1,
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.sacrificeAnotherPermanentForBenefitStage).not.toBe('ask');
    expect((queue.steps || []).some((entry: any) => entry?.sacrificeAnotherPermanentForBenefitStage === 'ask')).toBe(false);
    const followup = (queue.steps || []).find((entry: any) => entry?.sacrificeAnotherPermanentForBenefitStage === 'select_sacrifice');
    expect(followup).toMatchObject({
      id: 'sacrifice_followup_1',
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: p1,
      sourceId: 'source_perm',
    });

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays the selected sacrifice, life gain, draw, and prompt cleanup', () => {
    const gameId = 't_sacrifice_another_permanent_resolve_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      { id: 'source_perm', controller: p1, owner: p1, card: { name: 'Source Walker', type_line: 'Legendary Planeswalker' } },
      { id: 'other_perm', controller: p1, owner: p1, card: { name: 'Treasure Token', type_line: 'Artifact' } },
    ];
    (game.state as any).zones = {
      [p1]: {
        library: [{ id: 'draw_1', name: 'Drawn Card', type_line: 'Instant', zone: 'library' }],
        libraryCount: 1,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([[p1, [{ id: 'draw_1', name: 'Drawn Card', type_line: 'Instant', zone: 'library' }]]]);
    const step = addSelectPrompt(gameId, p1);

    game.applyEvent({
      type: 'sacrificeAnotherPermanentForBenefitResolve',
      playerId: p1,
      controllerId: p1,
      sourceId: 'source_perm',
      sourceName: 'Source Walker',
      resolvedStepId: step.id,
      sacrificedPermanentId: 'other_perm',
      sacrificedName: 'Treasure Token',
      lifeGain: 3,
      drawCount: 1,
      lifeBefore: 40,
      lifeAfter: 43,
      drawnCards: [{ id: 'draw_1', name: 'Drawn Card', type_line: 'Instant', zone: 'hand' }],
    } as any);

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm']);
    expect(((game.state as any).zones[p1].graveyard || []).map((card: any) => card.name)).toEqual(['Treasure Token']);
    expect((game.state as any).life[p1]).toBe(43);
    expect(((game.state as any).players[0] as any).life).toBe(43);
    expect(((game.state as any).zones[p1].hand || []).map((card: any) => card.id)).toEqual(['draw_1']);
    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.sacrificeAnotherPermanentForBenefitStage).not.toBe('select_sacrifice');
    expect((queue.steps || []).some((entry: any) => entry?.sacrificeAnotherPermanentForBenefitStage === 'select_sacrifice')).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});