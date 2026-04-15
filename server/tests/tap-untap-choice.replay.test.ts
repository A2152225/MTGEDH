import { beforeEach, describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe('tap/untap follow-up replay semantics', () => {
  beforeEach(() => {
    resetGame('t_target_selection_tap_untap_prompt_replay');
  });

  it('replays targetSelectionTapUntapPrompt by restoring the queued decision step', () => {
    const gameId = 't_target_selection_tap_untap_prompt_replay';

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'targetSelectionTapUntapPrompt',
      playerId: p1,
      sourceId: 'trigger_merrow_1',
      queuedResolutionStep: {
        id: 'queued_tap_untap_choice_1',
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: p1,
        sourceId: 'trigger_merrow_1',
        sourceName: 'Merrow Reejerey',
        description: 'Merrow Reejerey: Tap or untap Test Relic',
        mandatory: true,
        options: [
          { id: 'tap', label: 'Tap it' },
          { id: 'untap', label: 'Untap it' },
        ],
        minSelections: 1,
        maxSelections: 1,
        action: 'tap_or_untap_decision',
        targetId: 'target_perm_1',
      },
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(String((queue.steps[0] as any)?.id || '')).toBe('queued_tap_untap_choice_1');
    expect((queue.steps[0] as any)?.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect((queue.steps[0] as any)?.action).toBe('tap_or_untap_decision');
    expect((queue.steps[0] as any)?.targetId).toBe('target_perm_1');
  });
});