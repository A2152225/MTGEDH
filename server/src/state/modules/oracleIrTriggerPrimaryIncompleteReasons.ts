/**
 * Origin parent: oracleIrTriggerExecution.ts.
 * Cluster: helpers that describe why a trigger the Oracle IR primary path ran is not fully handled
 * (pending optional/continuation steps without a queue bridge, copy-permanent target queue, ...) and
 * the triggering spell mana value read used by "mana value of that spell" triggers.
 * Public: readTriggeringSpellManaValue, triggerCopyStepsNeedServerTargetQueue,
 *   describeOracleIrTriggerPrimaryIncomplete
 */
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { getCardManaValue } from '../../../../rules-engine/src/oracleIRExecutorPlayerExileUntilAmount.js';
import { describeOracleIrExecutionHandledIncomplete } from './oracleIrStepWiring.js';
import { isOracleIrContinuationBridged } from './oracleIrContinuationBridge.js';
import { copyPermanentTriggerStepNeedsTargetSelectionQueue } from './trigger-copy-permanent.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import { findTriggeringSpellOnStack, stackObjectIdsMatch } from './triggerCastSpellStackBinding.js';

export function readTriggeringSpellManaValue(
  state: any,
  triggerItem: any,
  targetSpellId?: string,
): number | undefined {
  const preferredId = String(targetSpellId || '').trim();
  const stackSpell = findTriggeringSpellOnStack(state, triggerItem)
    || (preferredId
      ? (Array.isArray(state?.stack) ? state.stack : []).find((entry: any) => (
        stackObjectIdsMatch(String(entry?.id || ''), preferredId)
        || stackObjectIdsMatch(String(entry?.card?.id || ''), preferredId)
      ))
      : null);
  const card = stackSpell?.card
    || stackSpell
    || triggerItem?.effectData?.triggeringSpell
    || triggerItem?.triggeringSpell;
  const manaValue = getCardManaValue(card);
  if (manaValue == null || !Number.isFinite(manaValue)) return undefined;
  return Math.max(0, Math.floor(manaValue));
}

export function triggerCopyStepsNeedServerTargetQueue(steps: readonly OracleEffectStep[]): boolean {
  return steps.some(
    (step) => step.kind === 'copy_permanent'
      && copyPermanentTriggerStepNeedsTargetSelectionQueue(
        step as Extract<OracleEffectStep, { kind: 'copy_permanent' }>,
      ),
  );
}

export function describeOracleIrTriggerPrimaryIncomplete(
  effectText: string,
  sourceName: string,
  steps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  queueBefore: number,
  queueAfter: number,
  options: {
    triggerType?: string;
    canApplyPreselectedChooseMode: boolean;
    state?: any;
    gameId?: string;
  },
): readonly string[] {
  const reasons = [
    ...describeOracleIrExecutionHandledIncomplete(
      result,
      queueBefore,
      queueAfter,
      steps,
      options.state,
      options.gameId,
    ),
  ];
  const applied = result.appliedSteps.length;
  const pendingOptional = (result.pendingOptionalSteps || []).length;
  const pendingContinuation = (result.pendingContinuationSteps || []).length;
  const queueGrew = queueAfter > queueBefore;
  const continuationBridged = isOracleIrContinuationBridged({
    state: options.state,
    gameId: options.gameId,
    resolutionQueueStepsBefore: queueBefore,
    resolutionQueueStepsAfter: queueAfter,
  });

  if (
    !queueGrew
    && applied === 0
    && triggerCopyStepsNeedServerTargetQueue(steps)
  ) {
    reasons.push('copy_permanent_needs_server_target_queue');
  }

  if (
    !queueGrew
    && applied > 0
    && String(options.triggerType || '').toLowerCase() === 'annihilator'
    && steps.some((step) => step.kind === 'sacrifice')
  ) {
    reasons.push('annihilator_sacrifice_requires_resolution_queue_bridge');
  }

  if (
    !continuationBridged
    && pendingOptional > 0
    && applied > 0
  ) {
    reasons.push(
      `pending_optional_without_queue_bridge: ${pendingOptional} optional step(s) remain`,
    );
  }

  if (
    !continuationBridged
    && pendingContinuation > 0
    && !reasons.some((reason) => reason.startsWith('pending_continuation_without_queue_bridge'))
  ) {
    const kinds = (result.pendingContinuationSteps || [])
      .map((step) => String(step.kind || 'unknown'))
      .join(', ');
    reasons.push(
      `pending_continuation_without_queue_bridge: ${pendingContinuation} step(s) [${kinds}]`,
    );
  }

  if (
    !isTriggerEffectOwnedByOracleIrPrimary(effectText, sourceName)
    && !options.canApplyPreselectedChooseMode
  ) {
    reasons.push('effect_not_primary_owned_by_oracle_ir');
  }

  return reasons;
}
