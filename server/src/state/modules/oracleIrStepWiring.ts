import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { debugWarn } from '../../utils/debug.js';
import { recordOracleIrGapTelemetry } from './oracleIrGapTelemetry.js';
import { isSupportedCopyPermanentTriggerPattern } from './trigger-copy-permanent.js';
import {
  ORACLE_IR_FALLBACK_STEP_KINDS,
  TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
  isSupportedGainControlTriggerPattern,
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
  // Class enchantment level abilities: "{W}: Level 2" / "{3}{W}: Level 3"
  'gain_class_level',
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

  if (step.kind === 'gain_control') {
    return isSupportedGainControlTriggerPattern(step);
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
    if (isOracleEffectStepRuntimeWired(step)) continue;
    const optionalSuffix = isOptionalOracleEffectStep(step) ? ' (optional)' : '';
    kinds.push(`${String(step.kind || 'unknown')}${optionalSuffix}`);
  }
  return kinds;
}

export function isActivatedAbilityEffectFullyWired(steps: readonly OracleEffectStep[]): boolean {
  return areAllOracleEffectStepsRuntimeWired(steps);
}

export function hasUnqueuedPlayerChoiceGap(
  result: OracleIRExecutionResult,
  queueBridged: boolean,
  state?: any,
): boolean {
  if (queueBridged) return false;
  return (result.automationGaps || []).some((gap) => {
    if (gap.reasonCode !== 'player_choice_required') return false;
    if (String(gap.stepKind || '') === 'discard' && hasPendingDiscardBridge(state)) {
      return false;
    }
    return true;
  });
}

function hasPendingDiscardBridge(state: any): boolean {
  const pending = state?.pendingDiscard;
  if (!pending || typeof pending !== 'object') return false;
  return Object.values(pending).some((entry: any) => Number(entry?.count || 0) > 0);
}

export type OracleIrAllOrNothingScope = 'spell' | 'trigger' | 'activated' | 'fallback';

function summarizeOracleIrStep(step: OracleEffectStep): string {
  const kind = String(step.kind || 'unknown');
  const raw = String(step.raw || '').trim();
  if (!raw) return kind;
  const snippet = raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
  return `${kind} — "${snippet}"`;
}

function appendUnqueuedPlayerChoiceReasons(
  reasons: string[],
  result: OracleIRExecutionResult,
  queueBridged: boolean,
  state?: any,
): void {
  if (!hasUnqueuedPlayerChoiceGap(result, queueBridged, state)) return;
  for (const gap of result.automationGaps || []) {
    if (gap.reasonCode !== 'player_choice_required') continue;
    const stepHint = gap.stepKind
      ? `${gap.stepKind}${gap.raw ? ` — "${String(gap.raw).slice(0, 80)}"` : ''}`
      : 'unknown step';
    reasons.push(
      `unqueued_player_choice: ${gap.message || gap.reasonCode} (${stepHint})`,
    );
  }
}

/**
 * Human-readable reasons when mandatory step coverage is incomplete.
 * Used for all-or-nothing logging and gap triage.
 */
export function describeOracleIrMandatoryExecutionIncomplete(
  parsedSteps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  options?: {
    resolutionQueueStepsBefore?: number;
    resolutionQueueStepsAfter?: number;
    state?: any;
  },
): readonly string[] {
  const reasons: string[] = [];
  const queueBefore = Number(options?.resolutionQueueStepsBefore ?? 0);
  const queueAfter = Number(options?.resolutionQueueStepsAfter ?? 0);
  const queueBridged = queueAfter > queueBefore;
  const discardBridged = hasPendingDiscardBridge(options?.state);

  const mandatoryParsed = parsedSteps.filter((step) => !isOptionalOracleEffectStep(step));
  if (mandatoryParsed.length === 0) {
    const hasEffect =
      (result.appliedSteps || []).length > 0
      || (result.pendingOptionalSteps || []).length > 0
      || (result.pendingContinuationSteps || []).length > 0
      || queueBridged;
    if (!hasEffect) {
      reasons.push('no_mandatory_steps_and_no_effect_applied_or_queued');
    }
    return reasons;
  }

  const skippedMandatory = (result.skippedSteps || []).filter(
    (step) => !isOptionalOracleEffectStep(step),
  );
  for (const step of skippedMandatory) {
    if (queueBridged) continue;
    if (discardBridged && step.kind === 'discard') continue;
    reasons.push(`skipped_mandatory_step: ${summarizeOracleIrStep(step)}`);
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
    if (discardBridged && step.kind === 'discard') continue;
    reasons.push(`unapplied_mandatory_step: ${summarizeOracleIrStep(step)}`);
  }

  return reasons;
}

/** Mandatory steps present in `allSteps` but absent from `includedSteps` (e.g. fallback wiring). */
export function describeMissingMandatoryOracleIrSteps(
  allSteps: readonly OracleEffectStep[],
  includedSteps: readonly OracleEffectStep[],
): readonly string[] {
  const mandatoryAll = allSteps.filter((step) => !isOptionalOracleEffectStep(step));
  const mandatoryIncluded = includedSteps.filter((step) => !isOptionalOracleEffectStep(step));
  const includedFingerprints = new Set(
    mandatoryIncluded.map((step) => oracleEffectStepFingerprint(step)),
  );
  return mandatoryAll
    .filter((step) => !includedFingerprints.has(oracleEffectStepFingerprint(step)))
    .map((step) => `unwired_mandatory_step: ${summarizeOracleIrStep(step)}`);
}

export function describeOracleIrExecutionHandledIncomplete(
  result: OracleIRExecutionResult,
  resolutionQueueStepsBefore: number,
  resolutionQueueStepsAfter: number,
  parsedSteps?: readonly OracleEffectStep[],
  state?: any,
): readonly string[] {
  const reasons: string[] = [];
  const queueBridged = resolutionQueueStepsAfter > resolutionQueueStepsBefore;
  const pendingContinuation = (result.pendingContinuationSteps || []).length;

  if (pendingContinuation > 0 && !queueBridged) {
    const kinds = (result.pendingContinuationSteps || [])
      .map((step) => String(step.kind || 'unknown'))
      .join(', ');
    reasons.push(
      `pending_continuation_without_queue_bridge: ${pendingContinuation} step(s) [${kinds}]`,
    );
  }

  appendUnqueuedPlayerChoiceReasons(reasons, result, queueBridged, state);

  const applied = result.appliedSteps.length;
  const pendingOptional = (result.pendingOptionalSteps || []).length;
  const hasEffect =
    applied > 0
    || pendingOptional > 0
    || pendingContinuation > 0
    || queueBridged
    || (result.automationGaps || []).some((gap) => gap.classification === 'player_choice');

  if (!hasEffect) {
    reasons.push('no_effect_applied_or_queued');
  }

  if (parsedSteps && parsedSteps.length > 0) {
    for (const reason of describeOracleIrMandatoryExecutionIncomplete(parsedSteps, result, {
      resolutionQueueStepsBefore,
      resolutionQueueStepsAfter,
      state,
    })) {
      reasons.push(reason);
    }
  }

  return reasons;
}

export function describeOracleIrActivatedAbilityIncomplete(
  parsedSteps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  options?: {
    resolutionQueueStepsBefore?: number;
    resolutionQueueStepsAfter?: number;
  },
): readonly string[] {
  const reasons: string[] = [];
  const queueBefore = Number(options?.resolutionQueueStepsBefore ?? 0);
  const queueAfter = Number(options?.resolutionQueueStepsAfter ?? 0);
  const queueBridged = queueAfter > queueBefore;

  appendUnqueuedPlayerChoiceReasons(reasons, result, queueBridged);

  const applied = (result.appliedSteps || []).length;
  const pendingOptional = (result.pendingOptionalSteps || []).length;
  const pendingContinuation = (result.pendingContinuationSteps || []).length;

  if (
    applied === 0
    && pendingOptional === 0
    && pendingContinuation === 0
    && !queueBridged
  ) {
    reasons.push('no_steps_applied_or_queued');
  }

  for (const reason of describeOracleIrMandatoryExecutionIncomplete(parsedSteps, result, options)) {
    reasons.push(reason);
  }

  return reasons;
}

export function formatOracleIrAllOrNothingFailure(
  scope: OracleIrAllOrNothingScope,
  label: string,
  reasons: readonly string[],
  stats?: { applied?: number; parsed?: number; mandatory?: number },
): string {
  let headline = `[oracleIR] All-or-nothing ${scope} failed for ${label}`;
  if (stats?.applied !== undefined && stats?.parsed !== undefined) {
    headline += `: applied ${stats.applied}/${stats.parsed} step(s)`;
    if (stats.mandatory !== undefined) {
      headline += ` (${stats.mandatory} mandatory)`;
    }
  }
  const reasonLines = (reasons.length > 0 ? reasons : ['unknown'])
    .map((reason) => `  reason: ${reason}`);
  return [headline, ...reasonLines].join('\n');
}

export function logOracleIrAllOrNothingFailure(
  scope: OracleIrAllOrNothingScope,
  label: string,
  reasons: readonly string[] | string,
  stats?: { applied?: number; parsed?: number; mandatory?: number },
): void {
  const normalizedReasons: readonly string[] = Array.isArray(reasons)
    ? reasons
    : [String(reasons)];
  debugWarn(1, formatOracleIrAllOrNothingFailure(scope, label, normalizedReasons, stats));
  recordOracleIrGapTelemetry({
    kind: 'all_or_nothing_failure',
    scope,
    label,
    reasons: normalizedReasons,
    stats,
  });
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
    state?: any;
  },
): boolean {
  return describeOracleIrMandatoryExecutionIncomplete(parsedSteps, result, options).length === 0;
}

export function isOracleIrActivatedAbilityHandled(
  parsedSteps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  options?: {
    resolutionQueueStepsBefore?: number;
    resolutionQueueStepsAfter?: number;
  },
): boolean {
  return describeOracleIrActivatedAbilityIncomplete(parsedSteps, result, options).length === 0;
}
