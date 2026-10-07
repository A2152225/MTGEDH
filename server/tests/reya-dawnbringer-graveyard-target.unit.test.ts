import { afterEach, describe, expect, it } from 'vitest';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { tryDeferTriggeredAbilityTargetSelection } from '../src/state/modules/stackResolveTriggeredAbilityTargetPromptUtils.js';
import { inferGenericTriggeredAbilityTargetMetadata } from '../src/state/modules/triggers/target-metadata.js';

const REYA_EFFECT = 'you may return target creature card from your graveyard to the battlefield.';
const gameId = 'reya_dawnbringer_gy_target';

afterEach(() => {
  ResolutionQueueManager.removeQueue(gameId);
});

describe('Reya Dawnbringer upkeep target', () => {
  it('still targets a battlefield creature when the text is not a graveyard card', () => {
    const metadata = inferGenericTriggeredAbilityTargetMetadata('target creature you control gets +1/+1 until end of turn.');
    expect(metadata.targetZone).toBeUndefined();
    expect(metadata.targetType).toBe('creature');
    expect(metadata.targetConstraint).toBe('you');
  });

  it('treats the graveyard creature card as the only target', () => {
    const metadata = inferGenericTriggeredAbilityTargetMetadata(REYA_EFFECT);
    expect(metadata.targetZone).toBe('graveyard');
    expect(metadata.targetDestination).toBe('battlefield');
    expect(metadata.targetGraveyardScope).toBe('your');
    expect(metadata.targetFilterTypes).toEqual(['creature']);
    expect(metadata.targetConstraint).toBeUndefined();
  });

  it('queues one graveyard selection and does not ask for a battlefield creature', () => {
    const metadata = inferGenericTriggeredAbilityTargetMetadata(REYA_EFFECT);
    const playerId = 'p1';
    const state = {
      players: [{ id: playerId, name: 'P1', life: 40 }],
      battlefield: [{
        id: 'angel_perm',
        controller: playerId,
        card: { id: 'angel_card', name: 'Angel', type_line: 'Creature — Angel' },
      }],
      zones: {
        [playerId]: {
          graveyard: [
            { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
            { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant' },
          ],
        },
      },
    };
    const deferred = tryDeferTriggeredAbilityTargetSelection(
      { gameId, state } as any,
      {
        id: 'reya_trigger',
        type: 'triggered_ability',
        effect: REYA_EFFECT,
        description: REYA_EFFECT,
        ...metadata,
      },
      state,
      {
        triggerController: playerId as any,
        sourceName: 'Reya Dawnbringer',
        sourceId: 'reya_perm',
        description: REYA_EFFECT,
        triggerType: 'upkeep',
      },
    );

    expect(deferred).toBe(true);
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any);
    expect(steps.map((step: any) => step.type)).toEqual([ResolutionStepType.GRAVEYARD_SELECTION]);
    const targetIds = (steps[0] as any).validTargets.map((target: any) => target.id);
    expect(targetIds).toEqual(['bear']);
    expect((steps[0] as any).destination).toBe('battlefield');
  });
});
