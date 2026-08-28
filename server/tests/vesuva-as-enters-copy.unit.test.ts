import { describe, expect, it } from 'vitest';
import { checkAsEntersCopyChoiceForNewPermanents } from '../src/state/modules/asEntersCopyChoice.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const VESUVA_ORACLE = 'You may have this land enter tapped as a copy of any land on the battlefield.';

describe('Vesuva as-enters copy choice', () => {
  it('queues an optional land copy target selection when another land is on the battlefield', () => {
    const gameId = 'vesuva_copy_choice';
    ResolutionQueueManager.clearAllSteps(gameId);
    const game = {
      state: {
        battlefield: [
          {
            id: 'vesuva_1',
            controller: 'p1',
            card: {
              id: 'vesuva_card',
              name: 'Vesuva',
              type_line: 'Land',
              oracle_text: VESUVA_ORACLE,
            },
          },
          {
            id: 'forest_1',
            controller: 'p2',
            card: {
              id: 'forest_card',
              name: 'Forest',
              type_line: 'Basic Land — Forest',
            },
          },
        ],
      },
    };

    checkAsEntersCopyChoiceForNewPermanents(game, gameId);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry.asEntersCopyChoice === true,
    ) as any;

    expect(step).toBeTruthy();
    expect(step.mandatory).toBe(false);
    expect(step.minTargets).toBe(0);
    expect(step.enterTappedIfCopied).toBe(true);
    expect(step.targetTypes).toEqual(['land']);
    expect((step.validTargets || []).map((target: any) => target.id)).toEqual(['forest_1']);
  });
});
