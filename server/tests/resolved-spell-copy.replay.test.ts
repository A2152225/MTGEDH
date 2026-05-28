import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('resolved spell copy replay semantics', () => {
  it('replays copy-choice responses by clearing restored prompts', () => {
    const gameId = 't_resolved_spell_copy_choice_replay_cleanup';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;

    ResolutionQueueManager.removeQueue(gameId);
    addPlayer(game, playerId, 'P1');
    ResolutionQueueManager.addStep(gameId, {
      id: 'resolved_spell_copy_choice_step_1',
      type: ResolutionStepType.OPTION_CHOICE,
      playerId,
      sourceId: 'spell_copy_source_1',
      description: 'Copy the resolved spell?',
      mandatory: false,
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
      resolvedSpellCopyChoice: true,
    } as any);

    game.applyEvent({
      type: 'resolvedSpellCopyChoiceResolve',
      playerId,
      sourceId: 'spell_copy_source_1',
      resolvedStepId: 'resolved_spell_copy_choice_step_1',
      choiceId: 'no',
    } as any);

    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('replays copied resolved spells idempotently from the persisted snapshot', () => {
    const gameId = 't_resolved_spell_copy_replay_idempotent';
    const game = createInitialGameState(gameId);
    const playerId = 'p1' as PlayerID;

    addPlayer(game, playerId, 'P1');
    const event = {
      type: 'resolvedSpellCopyResolve',
      playerId,
      sourceId: 'spell_copy_source_1',
      sourceName: 'Echoing Arcanist',
      copiedSpell: {
        id: 'copied_spell_1',
        type: 'spell',
        controller: playerId,
        sourceName: 'Lightning Bolt',
        card: {
          id: 'lightning_bolt_card_1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
        },
        targets: ['opponent_1'],
        targetRequirements: { minTargets: 1, maxTargets: 1 },
      },
    } as any;

    game.applyEvent(event);
    game.applyEvent(event);

    const copiedSpells = ((game.state as any).stack || []).filter((item: any) => String(item?.id || '') === 'copied_spell_1');
    expect(copiedSpells).toHaveLength(1);
    expect(copiedSpells[0]?.targets).toEqual(['opponent_1']);
    expect(copiedSpells[0]?.card).toEqual({
      id: 'lightning_bolt_card_1',
      name: 'Lightning Bolt',
      type_line: 'Instant',
    });
  });
});