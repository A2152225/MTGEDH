/**
 * Extracted from triggerEtbEntryEffects.ts: persistTriggeredAbilityPush.
 * Cluster moved: persistTriggeredAbilityPush.
 * Public: persistTriggeredAbilityPush
 *
 * Different function from socket/combat-handlers/combatDeclareBlockersRequest.ts
 * persistTriggeredAbilityPush (gameId, game, payload) — do not merge.
 *
 * Leaf must not import triggerEtbEntryEffects.ts or triggerEtbEntryEffects-handlers/index.ts.
 */

import type { GameContext } from '../../context.js';
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';

export function persistTriggeredAbilityPush(ctx: GameContext, stackItem: any): void {
  if ((ctx as any).isReplaying) {
    return;
  }
  const state = (ctx as any).state;
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || !stackItem?.id) {
    return;
  }

  try {
    appendEvent(gameId, (state as any).seq ?? 0, 'pushTriggeredAbility', {
      triggerId: stackItem.id,
      sourceId: stackItem.source,
      permanentId: stackItem.permanentId || stackItem.source,
      sourceName: stackItem.sourceName,
      controllerId: stackItem.controller,
      description: stackItem.description,
      triggerType: stackItem.triggerType,
      ...(stackItem.effect ? { effect: stackItem.effect } : null),
      mandatory: typeof stackItem.mandatory === 'boolean' ? stackItem.mandatory : true,
      ...(typeof stackItem.requiresChoice === 'boolean' ? { requiresChoice: stackItem.requiresChoice } : null),
      ...(typeof stackItem.requiresTarget === 'boolean' ? { requiresTarget: stackItem.requiresTarget } : null),
      ...(typeof stackItem.needsTargetSelection === 'boolean' ? { needsTargetSelection: stackItem.needsTargetSelection } : null),
      ...(stackItem.targetType ? { targetType: stackItem.targetType } : null),
      ...(stackItem.targetConstraint ? { targetConstraint: stackItem.targetConstraint } : null),
      ...(typeof stackItem.isModal === 'boolean' ? { isModal: stackItem.isModal } : null),
      ...(Array.isArray(stackItem.modalOptions) ? { modalOptions: stackItem.modalOptions } : null),
      ...(stackItem.targetPlayer ? { targetPlayer: stackItem.targetPlayer } : null),
      ...(stackItem.defendingPlayer ? { defendingPlayer: stackItem.defendingPlayer } : null),
      ...(stackItem.triggeringPlayer != null ? { triggeringPlayer: stackItem.triggeringPlayer } : null),
      ...(stackItem.targetZone ? { targetZone: stackItem.targetZone } : null),
      ...(stackItem.targetDestination ? { targetDestination: stackItem.targetDestination } : null),
      ...(stackItem.targetGraveyardScope ? { targetGraveyardScope: stackItem.targetGraveyardScope } : null),
      ...(stackItem.destinationUsesSelectedCardOwner === true ? { destinationUsesSelectedCardOwner: true } : null),
      ...(stackItem.battlefieldControllerMode ? { battlefieldControllerMode: stackItem.battlefieldControllerMode } : null),
      ...(stackItem.battlefieldCounters && typeof stackItem.battlefieldCounters === 'object' ? { battlefieldCounters: stackItem.battlefieldCounters } : null),
      ...(stackItem.targetAction ? { targetAction: stackItem.targetAction } : null),
      ...(Array.isArray(stackItem.targetFilterTypes) ? { targetFilterTypes: stackItem.targetFilterTypes } : null),
      ...(Array.isArray(stackItem.targetFilterRequiredTypeWords) ? { targetFilterRequiredTypeWords: stackItem.targetFilterRequiredTypeWords } : null),
      ...(Array.isArray(stackItem.targetFilterExcludeTypes) ? { targetFilterExcludeTypes: stackItem.targetFilterExcludeTypes } : null),
      ...(stackItem.targetFilterPermanentOnly === true ? { targetFilterPermanentOnly: true } : null),
      ...(typeof stackItem.targetFilterExactManaValue === 'number' ? { targetFilterExactManaValue: stackItem.targetFilterExactManaValue } : null),
      ...(typeof stackItem.targetFilterMinManaValue === 'number' ? { targetFilterMinManaValue: stackItem.targetFilterMinManaValue } : null),
      ...(typeof stackItem.targetFilterMaxManaValue === 'number' ? { targetFilterMaxManaValue: stackItem.targetFilterMaxManaValue } : null),
      ...(typeof stackItem.targetTotalPowerLimit === 'number' ? { targetTotalPowerLimit: stackItem.targetTotalPowerLimit } : null),
      ...(stackItem.targetCastWithoutPayingManaCost === true ? { targetCastWithoutPayingManaCost: true } : null),
      ...(stackItem.targetCastIsOptional === true ? { targetCastIsOptional: true } : null),
      ...(typeof stackItem.minTargets === 'number' ? { minTargets: stackItem.minTargets } : null),
      ...(typeof stackItem.maxTargets === 'number' ? { maxTargets: stackItem.maxTargets } : null),
      ...(stackItem.delayedReturnAt ? { delayedReturnAt: stackItem.delayedReturnAt } : null),
      ...(stackItem.battlefieldTapped === true ? { battlefieldTapped: true } : null),
      ...(stackItem.boundGraveyardCardId ? { boundGraveyardCardId: stackItem.boundGraveyardCardId } : null),
      ...(stackItem.boundGraveyardOwnerId ? { boundGraveyardOwnerId: stackItem.boundGraveyardOwnerId } : null),
      ...(stackItem.interveningIfSubjectPermanentId ? { interveningIfSubjectPermanentId: stackItem.interveningIfSubjectPermanentId } : null),
      ...(stackItem.interveningIfSubjectSnapshot && typeof stackItem.interveningIfSubjectSnapshot === 'object'
        ? { interveningIfSubjectSnapshot: stackItem.interveningIfSubjectSnapshot }
        : null),
      ...(typeof stackItem.value !== 'undefined' ? { value: stackItem.value } : null),
      ...(stackItem.effectData && typeof stackItem.effectData === 'object' ? { effectData: stackItem.effectData } : null),
      ...(stackItem.card && typeof stackItem.card === 'object' ? { card: stackItem.card } : null),
      ...(stackItem.sourcePermanentSnapshot && typeof stackItem.sourcePermanentSnapshot === 'object'
        ? { sourcePermanentSnapshot: stackItem.sourcePermanentSnapshot }
        : null),
    });
  } catch (err) {
    debugWarn(1, '[persistTriggeredAbilityPush] appendEvent(pushTriggeredAbility) failed:', err);
  }
}

