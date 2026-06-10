import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  collectOracleEffectSteps,
  isTriggerStepRuntimeWired,
} from './trigger-runtime-wiring.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrSpellExecution.js';

/**
 * categorizeSpell opcodes with IR parity proof under ORACLE_IR_SPELL_PRIMARY.
 * Used for documentation and incremental retirement; spell routing skips all
 * categorizeSpell execution when isSpellEffectOwnedByOracleIrPrimary is true.
 */
export const ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS = new Set<string>([
  'DRAW_CARDS',
  'GAIN_LIFE',
  'GAIN_LIFE_TARGET_PLAYER',
  'SCRY',
  'SURVEIL',
  'DISCARD_TARGET_PLAYER',
  'DESTROY_TARGET',
  'MILL_TARGET_PLAYER',
]);

function collectSpellEffectSteps(oracleText: string, spellName: string): OracleEffectStep[] {
  return collectOracleEffectSteps(oracleText, spellName);
}

/**
 * Returns true when Oracle IR spell primary mode owns this oracle text
 * (parsed steps are fully runtime-wired). Used to skip duplicate legacy regex
 * handlers, categorizeSpell execution, and the uncategorized fallback shim.
 */
export function isSpellEffectOwnedByOracleIrPrimary(
  oracleText: string,
  spellName: string,
): boolean {
  if (!isOracleIrSpellPrimaryEnabled()) return false;

  const text = String(oracleText || '').trim();
  if (!text) return false;

  const steps = collectSpellEffectSteps(text, spellName);
  if (steps.length === 0) return false;
  if (steps.some((step) => step.kind === 'unknown')) return false;

  return steps.every((step) => isTriggerStepRuntimeWired(step as OracleEffectStep));
}

export function shouldSkipSpellUncategorizedFallback(
  oracleText: string,
  spellName: string,
): boolean {
  return isSpellEffectOwnedByOracleIrPrimary(oracleText, spellName);
}

export function shouldSkipLegacySpellRegexHandlers(
  oracleText: string,
  spellName: string,
): boolean {
  return isSpellEffectOwnedByOracleIrPrimary(oracleText, spellName);
}

export function shouldSkipLegacySpellCategorizeExecution(
  oracleText: string,
  spellName: string,
): boolean {
  return isSpellEffectOwnedByOracleIrPrimary(oracleText, spellName);
}

export function isCategorizeOpcodeRetiredUnderOracleIrPrimary(op: string | undefined): boolean {
  if (!op) return false;
  return ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS.has(String(op));
}

export function maybeSuppressRetiredCategorizeSpellSpec<T extends { op?: string } | null>(spec: T): T {
  if (!spec) return spec;
  if (!isOracleIrSpellPrimaryEnabled()) return spec;
  if (isCategorizeOpcodeRetiredUnderOracleIrPrimary(String(spec.op || ''))) {
    return null as T;
  }
  return spec;
}
