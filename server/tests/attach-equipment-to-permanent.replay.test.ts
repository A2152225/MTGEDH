import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('attach equipment to permanent choice replay semantics', () => {
  it('replays the initial attach choice by clearing the resolved option prompt', () => {
    const gameId = 't_attach_equipment_choice_replay';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: You may attach an Equipment you control to the created Kor Soldier token.',
      mandatory: false,
      sourceName: 'Source',
      options: [
        { id: 'attach', label: 'Attach an Equipment' },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      attachEquipmentToPermanentChoice: true,
      attachEquipmentToPermanentTargetPermanentId: 'new_target',
      attachEquipmentToPermanentController: p1,
      attachEquipmentToPermanentSourceName: 'Source',
      attachEquipmentToPermanentTargetName: 'Kor Soldier token',
    } as any);
    ResolutionQueueManager.activateStep(gameId, step.id);

    game.applyEvent({
      type: 'attachEquipmentToPermanentChoiceResolve',
      playerId: p1,
      controllerId: p1,
      sourceId: 'new_target',
      sourceName: 'Source',
      resolvedStepId: step.id,
      choice: 'attach',
      targetPermanentId: 'new_target',
      targetName: 'Kor Soldier token',
      queuedResolutionStepId: 'attach_equipment_select_1',
    } as any);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.attachEquipmentToPermanentChoice).not.toBe(true);
    expect((queue.steps || []).some((entry: any) => entry?.attachEquipmentToPermanentChoice === true)).toBe(false);
    expect((queue.steps || []).some((entry: any) => entry?.attachEquipmentToPermanentSelectEquipment === true)).toBe(false);

    ResolutionQueueManager.removeQueue(gameId);
  });
});