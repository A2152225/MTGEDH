import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  collectOracleEffectSteps,
  isTriggerStepRuntimeWired,
  ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS,
  ORACLE_IR_FALLBACK_STEP_KINDS,
  TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
} from './trigger-runtime-wiring.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrTriggerExecution.js';
import { isJoinForcesEffectText } from './joinForcesResolutionQueue.js';

/**
 * Oracle IR step kinds with trigger parity proof under ORACLE_IR_TRIGGER_PRIMARY.
 * Kept in sync with mandatory fallback kinds plus optional trigger runtime kinds.
 * Legacy regex handlers for fully-wired effect text are skipped when primary owns the text.
 */
export const ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS = new Set<string>([
  ...ORACLE_IR_FALLBACK_STEP_KINDS,
  ...TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
  ...ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS,
]);
export function isTriggerStepKindRetiredUnderOracleIrPrimary(kind: string | undefined): boolean {
  if (!kind) return false;
  return ORACLE_IR_TRIGGER_RETIRED_STEP_KINDS.has(String(kind));
}

/**
 * Returns true when Oracle IR trigger primary mode owns this effect text * (parsed steps are fully runtime-wired). Used to skip duplicate legacy regex
 * handlers and the secondary uncategorized fallback shim in executeTriggerEffect.
 */
export function isTriggerEffectFullyIrWired(
  effectText: string,
  sourceName: string,
): boolean {
  const text = String(effectText || '').trim();
  if (!text) return false;

  const steps = collectOracleEffectSteps(text, sourceName);
  if (steps.length === 0) return false;
  if (steps.some((step) => step.kind === 'unknown')) return false;

  return steps.every((step) => isTriggerStepRuntimeWired(step as OracleEffectStep));
}

export function isTriggerEffectOwnedByOracleIrPrimary(
  effectText: string,
  sourceName: string,
): boolean {
  if (!isOracleIrTriggerPrimaryEnabled()) return false;
  if (isJoinForcesEffectText(effectText)) return false;
  return isTriggerEffectFullyIrWired(effectText, sourceName);
}

export function shouldSkipTriggerUncategorizedFallback(
  effectText: string,
  sourceName: string,
): boolean {
  return isTriggerEffectOwnedByOracleIrPrimary(effectText, sourceName);
}

export function shouldSkipLegacyTriggerRegexHandlers(
  effectText: string,
  sourceName: string,
): boolean {
  return isTriggerEffectOwnedByOracleIrPrimary(effectText, sourceName);
}

/**
 * Defense-in-depth for individual legacy regex handlers.
 * Always returns false: orchestrators (tryResolveTriggerViaOracleIR early return,
 * tail IR fallback early return) already prevent double-apply when IR succeeds.
 * Skipping on static "ownership" alone caused silent no-ops when IR failed to handle.
 */
export function skipRetiredTriggerLegacyHandler(_desc: string, _sourceName = ''): boolean {
  return false;
}

/**
 * Orchestrator-level skip: when IR primary owns the effect, bypass the legacy
 * body handler chain entirely. Tail still runs for copy_permanent bridge and
 * parity logging via shouldSkipLegacyTriggerRegexHandlers.
 */
export function shouldSkipLegacyTriggerBodyHandlers(
  effectText: string,
  sourceName: string,
): boolean {
  return shouldSkipLegacyTriggerRegexHandlers(effectText, sourceName);
}
