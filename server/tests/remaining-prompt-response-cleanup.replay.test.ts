import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('remaining prompt response replay cleanup', () => {
  it('replays exploreResolve by applying explore and clearing the restored prompt', () => {
    const gameId = 'test_explore_resolve_replay_cleanup';
    const p1 = 'p1' as PlayerID;
    const game = createInitialGameState(gameId);

    ResolutionQueueManager.removeQueue(gameId);
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [{
      id: 'explorer_1',
      controller: p1,
      owner: p1,
      counters: {},
      card: { id: 'explorer_card', name: 'Explorer', type_line: 'Creature - Merfolk Scout' },
    }];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, libraryCount: 1, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game as any).libraries.set(p1, [
      { id: 'revealed_nonland', name: 'Wild Growth', type_line: 'Enchantment', zone: 'library' },
    ]);

    ResolutionQueueManager.addStep(gameId, {
      id: 'explore_step_1',
      type: ResolutionStepType.EXPLORE_DECISION,
      playerId: p1,
      description: 'Explorer explores',
      mandatory: true,
      permanentId: 'explorer_1',
      sourceId: 'explorer_1',
    } as any);

    game.applyEvent({
      type: 'exploreResolve',
      playerId: p1,
      resolvedStepId: 'explore_step_1',
      resolvedStepType: ResolutionStepType.EXPLORE_DECISION,
      permanentId: 'explorer_1',
      revealedCardId: 'revealed_nonland',
      isLand: false,
      toGraveyard: true,
    } as any);

    const permanent = ((game.state as any).battlefield || [])[0] as any;
    expect(permanent.counters?.['+1/+1']).toBe(1);
    expect((game.state as any).zones[p1].graveyard.map((card: any) => card.id)).toEqual(['revealed_nonland']);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((entry: any) => String(entry?.id || '') === 'explore_step_1')).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays rulesChoiceResolved by clearing restored grouped choice prompts before effect execution', () => {
    const gameId = 'test_rules_choice_resolved_replay_cleanup';
    const game = createInitialGameState(gameId);

    ResolutionQueueManager.removeQueue(gameId);
    ResolutionQueueManager.addStep(gameId, {
      id: 'rules_choice_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: 'p1' as PlayerID,
      description: 'Choose a rules option',
      mandatory: true,
      rulesChoiceGroupId: 'rules_group_1',
    } as any);
    ResolutionQueueManager.addStep(gameId, {
      id: 'rules_choice_step_2',
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: 'p1' as PlayerID,
      description: 'Choose a rules target',
      mandatory: true,
      rulesChoiceGroupId: 'rules_group_1',
    } as any);

    game.applyEvent({
      type: 'rulesChoiceResolved',
      rulesChoiceGroupId: 'rules_group_1',
      resolvedStepIds: ['rules_choice_step_1', 'rules_choice_step_2'],
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((entry: any) => String((entry as any).rulesChoiceGroupId || '') === 'rules_group_1')).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });
});