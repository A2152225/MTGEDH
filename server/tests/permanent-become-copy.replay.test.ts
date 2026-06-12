import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src';

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function addActiveCopyTargetStep(gameId: string, playerId: PlayerID, sourcePermanentId: string) {
  const step = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId,
    description: 'Cryptoplasm: You may choose another target creature to copy (cancel to skip)',
    mandatory: false,
    sourceId: sourcePermanentId,
    sourceName: 'Cryptoplasm',
    permanentId: sourcePermanentId,
    validTargets: [{ id: 'bear_1', label: 'Grizzly Bears' }],
    minTargets: 0,
    maxTargets: 1,
    action: 'self_become_copy_of_creature',
    selfBecomeCopySourcePermanentId: sourcePermanentId,
    retainedAbilityText: 'it has this ability',
  } as any);
  ResolutionQueueManager.activateStep(gameId, step.id);
  return step;
}

describe('permanentBecomeCopyResolve replay semantics', () => {
  const upkeepAbility =
    'At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability.';

  it('replays copy onto the source permanent and clears the target step', () => {
    const gameId = 't_permanent_become_copy_replay';
    ResolutionQueueManager.removeQueue(gameId);
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(game, p1, 'P1');
    addPlayer(game, p2, 'P2');
    const step = addActiveCopyTargetStep(gameId, p1, 'cryptoplasm_1');

    (game.state as any).battlefield = [
      {
        id: 'cryptoplasm_1',
        controller: p1,
        owner: p1,
        card: {
          id: 'cryptoplasm_card',
          name: 'Cryptoplasm',
          type_line: 'Creature — Shapeshifter',
          oracle_text: upkeepAbility,
          power: '3',
          toughness: '3',
        },
        power: 3,
        toughness: 3,
        basePower: 3,
        baseToughness: 3,
      },
      {
        id: 'bear_1',
        controller: p2,
        owner: p2,
        card: {
          id: 'bear_card',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
        power: 2,
        toughness: 2,
      },
    ];

    game.applyEvent({
      type: 'permanentBecomeCopyResolve',
      playerId: p1,
      resolvedStepId: step.id,
      copyOntoPermanentId: 'cryptoplasm_1',
      copyFromPermanentId: 'bear_1',
      sourceName: 'Cryptoplasm',
      retainedAbilityText: 'it has this ability',
      targetName: 'Grizzly Bears',
    } as any);

    const cryptoplasm = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'cryptoplasm_1');
    expect(cryptoplasm?.card?.name).toBe('Grizzly Bears');
    expect(cryptoplasm?.power).toBe(2);
    expect(String(cryptoplasm?.card?.oracle_text || '')).toContain(upkeepAbility);

    const queue = ResolutionQueueManager.getQueue(gameId) as any;
    expect(queue.activeStep?.type).not.toBe(ResolutionStepType.TARGET_SELECTION);
    expect((queue.steps || []).some((entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION)).toBe(false);
    ResolutionQueueManager.removeQueue(gameId);
  });
});
