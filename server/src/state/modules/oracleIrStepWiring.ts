import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { isSupportedCopyPermanentTriggerPattern } from './trigger-copy-permanent.js';
import {
  ORACLE_IR_FALLBACK_STEP_KINDS,
  TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
} from './trigger-runtime-wiring.js';

/**
 * Step kinds supported for activated abilities but not yet in the shared fallback set.
 * Kept explicit so new activated-only kinds are reviewed alongside ACTIVATED wiring.
 */
export const ORACLE_IR_ACTIVATED_ONLY_STEP_KINDS = new Set<string>([
  'roll_die',
  'die_roll_results',
  'copy_spell',
  'choose_mode',
  'player_choice',
  'fight',
  'open_attraction',
  'roll_visit_attractions',
]);

/** Union used by tryApplyOracleIRToActivatedAbility — must be fully wired before IR runs. */
export const ORACLE_IR_ACTIVATED_STEP_KINDS = new Set<string>([
  ...ORACLE_IR_FALLBACK_STEP_KINDS,
  ...TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
  ...ORACLE_IR_ACTIVATED_ONLY_STEP_KINDS,
]);

export function isOptionalOracleEffectStep(step: OracleEffectStep): boolean {
  if (Boolean((step as { optional?: boolean }).optional)) return true;
  return /^you may\b/i.test(String(step.raw || '').trim());
}

export function oracleEffectStepFingerprint(step: OracleEffectStep): string {
  return `${String(step.kind || '')}::${String(step.raw || '').trim().toLowerCase()}`;
}

export function isOracleEffectStepRuntimeWired(step: OracleEffectStep): boolean {
  if (!step || step.kind === 'unknown') return false;

  if (step.kind === 'copy_permanent') {
    return isSupportedCopyPermanentTriggerPattern(step);
  }

  if (isOptionalOracleEffectStep(step)) {
    return (
      TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.has(String(step.kind))
      || ORACLE_IR_FALLBACK_STEP_KINDS.has(String(step.kind))
      || ORACLE_IR_ACTIVATED_ONLY_STEP_KINDS.has(String(step.kind))
    );
  }

  return (
    ORACLE_IR_FALLBACK_STEP_KINDS.has(String(step.kind))
    || ORACLE_IR_ACTIVATED_ONLY_STEP_KINDS.has(String(step.kind))
  );
}

export function areAllOracleEffectStepsRuntimeWired(steps: readonly OracleEffectStep[]): boolean {
  if (steps.length === 0) return false;
  if (steps.some((step) => step.kind === 'unknown')) return false;
  return steps.every((step) => isOracleEffectStepRuntimeWired(step));
}

export function getUnwiredOracleEffectStepKinds(steps: readonly OracleEffectStep[]): string[] {
  const kinds: string[] = [];
  for (const step of steps) {
    if (step.kind === 'unknown') {
      kinds.push('unknown');
      continue;
    }
    if (ORACLE_IR_ACTIVATED_STEP_KINDS.has(String(step.kind))) continue;
    if (ORACLE_IR_FALLBACK_STEP_KINDS.has(String(step.kind))) continue;
    if (ORACLE_IR_ACTIVATED_ONLY_STEP_KINDS.has(String(step.kind))) continue;
    if (TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.has(String(step.kind)) && isOptionalOracleEffectStep(step)) continue;
    const optionalSuffix = isOptionalOracleEffectStep(step) ? ' (optional)' : '';
    kinds.push(`${String(step.kind || 'unknown')}${optionalSuffix}`);
  }
  return kinds;
}

export function isActivatedAbilityEffectFullyWired(steps: readonly OracleEffectStep[]): boolean {
  if (steps.length === 0) return false;
  return steps.every((step) => {
    if (step.kind === 'unknown') return false;
    return ORACLE_IR_ACTIVATED_STEP_KINDS.has(String(step.kind));
  });
}

export function hasUnqueuedPlayerChoiceGap(
  result: OracleIRExecutionResult,
  queueBridged: boolean,
): boolean {
  if (queueBridged) return false;
  return (result.automationGaps || []).some(
    (gap) => gap.reasonCode === 'player_choice_required',
  );
}

/**
 * Returns true when every mandatory parsed step was applied, queued for continuation,
 * or bridged to the resolution queue. Prevents silent partial multi-step effects.
 */
export function isOracleIrMandatoryExecutionComplete(
  parsedSteps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  options?: {
    resolutionQueueStepsBefore?: number;
    resolutionQueueStepsAfter?: number;
  },
): boolean {
  const queueBefore = Number(options?.resolutionQueueStepsBefore ?? 0);
  const queueAfter = Number(options?.resolutionQueueStepsAfter ?? 0);
  const queueBridged = queueAfter > queueBefore;

  const mandatoryParsed = parsedSteps.filter((step) => !isOptionalOracleEffectStep(step));
  if (mandatoryParsed.length === 0) {
    return (
      (result.appliedSteps || []).length > 0
      || (result.pendingOptionalSteps || []).length > 0
      || (result.pendingContinuationSteps || []).length > 0
      || queueBridged
    );
  }

  const skippedMandatory = (result.skippedSteps || []).filter(
    (step) => !isOptionalOracleEffectStep(step),
  );
  if (skippedMandatory.length > 0) {
    return false;
  }

  const appliedFingerprints = new Set(
    (result.appliedSteps || []).map((step) => oracleEffectStepFingerprint(step)),
  );
  const continuationFingerprints = new Set(
    (result.pendingContinuationSteps || []).map((step) => oracleEffectStepFingerprint(step)),
  );

  for (const step of mandatoryParsed) {
    const fingerprint = oracleEffectStepFingerprint(step);
    if (appliedFingerprints.has(fingerprint)) continue;
    if (continuationFingerprints.has(fingerprint)) continue;
    if (queueBridged) continue;
    return false;
  }

  return true;
}

export function isOracleIrActivatedAbilityHandled(
  parsedSteps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  options?: {
    resolutionQueueStepsBefore?: number;
    resolutionQueueStepsAfter?: number;
  },
): boolean {
  const queueBefore = Number(options?.resolutionQueueStepsBefore ?? 0);
  const queueAfter = Number(options?.resolutionQueueStepsAfter ?? 0);
  const queueBridged = queueAfter > queueBefore;

  if (hasUnqueuedPlayerChoiceGap(result, queueBridged)) {
    return false;
  }

  const applied = (result.appliedSteps || []).length;
  const pendingOptional = (result.pendingOptionalSteps || []).length;
  const pendingContinuation = (result.pendingContinuationSteps || []).length;

  if (
    applied === 0
    && pendingOptional === 0
    && pendingContinuation === 0
    && !queueBridged
  ) {
    return false;
  }

  return isOracleIrMandatoryExecutionComplete(parsedSteps, result, options);
}
