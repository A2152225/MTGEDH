/**
 * Origin parent: server/src/state/modules/triggers/turn-phases.ts
 * Cluster: delayed NEXT_END_STEP / YOUR_NEXT_END_STEP watchers on
 *   state.delayedTriggerRegistry (Swooping Pteranodon-style land damage,
 *   Headstone delayed draws, etc.).
 * Public: collectDelayedEndStepRegistryTriggers
 * These live on state.delayedTriggerRegistry, not battlefield oracle.
 */

import type { GameContext } from '../../context.js';
import {
  DelayedTriggerTiming,
  checkDelayedTriggers,
  createDelayedTriggerRegistry,
} from '../../../../../rules-engine/src/delayedTriggeredAbilities.js';
import { inferTriggeredAbilityTargetMetadata } from '../inferTriggeredAbilityTargetMetadata.js';
import { delayedCleanupStackFieldsFromRegistry } from './delayed-registry-watcher-metadata.js';
import { detectRequiresChoice } from './turn-phases-handlers/turnPhaseEffectChoiceHelpers.js';
import type { EndStepTrigger } from './turn-phases-handlers/turnPhaseTriggerTypes.js';

export function collectDelayedEndStepRegistryTriggers(
  ctx: GameContext,
  activePlayerId: string,
): EndStepTrigger[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  if (!state) return [];

  const registry = (state.delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<
    typeof createDelayedTriggerRegistry
  >;
  const pending = (registry.triggers || []).filter(
    (trigger) =>
      trigger.timing === DelayedTriggerTiming.NEXT_END_STEP
      || trigger.timing === DelayedTriggerTiming.YOUR_NEXT_END_STEP
      || trigger.timing === DelayedTriggerTiming.EACH_END_STEP,
  );
  if (pending.length === 0) return [];

  const delayedCheck = checkDelayedTriggers(registry, {
    type: 'end_step',
    activePlayerId,
    currentTurn: Number(state.turnNumber ?? state.turn ?? 0) || 0,
  });
  if (delayedCheck.triggersToFire.length === 0) return [];

  state.delayedTriggerRegistry = {
    ...registry,
    triggers: delayedCheck.remainingTriggers,
    firedTriggerIds: [
      ...registry.firedTriggerIds,
      ...delayedCheck.triggersToFire.map((trigger) => trigger.id),
    ],
  };

  return delayedCheck.triggersToFire.map((delayed) => {
    const effect = String(delayed.effect || '').trim();
    const targetMetadata = inferTriggeredAbilityTargetMetadata(effect);
    const cleanupFields = delayedCleanupStackFieldsFromRegistry(delayed);
    return {
      permanentId: String(delayed.sourceId || ''),
      cardName: String(delayed.sourceName || 'Delayed trigger'),
      controllerId: String(delayed.controllerId || ''),
      triggerType: 'end_step_effect',
      description: effect,
      effect,
      mandatory: !effect.toLowerCase().includes('you may'),
      requiresChoice: detectRequiresChoice(effect) || targetMetadata.requiresTarget === true,
      stackItem: {
        ...targetMetadata,
        ...cleanupFields,
        effectData: {
          ...(delayed.effectData && typeof delayed.effectData === 'object' ? delayed.effectData : {}),
          ...(cleanupFields.lastAntecedentBattlefieldPermanentIds.length > 0
            ? { lastAntecedentBattlefieldPermanentIds: cleanupFields.lastAntecedentBattlefieldPermanentIds }
            : {}),
        },
      },
    };
  }).filter((trigger) => Boolean(trigger.effect));
}
