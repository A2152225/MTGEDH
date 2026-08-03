import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  collectSpellResolutionEffectSteps,
  isTriggerStepRuntimeWired,
  ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS,
  ORACLE_IR_FALLBACK_STEP_KINDS,
  TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
} from './trigger-runtime-wiring.js';
import { buildOracleOverlayCollectOptions } from './oracleIrCompiledOverlayLookup.js';
import { isOracleIrSpellPrimaryEnabled } from './oracleIrSpellExecution.js';

/**
 * Oracle IR step kinds with spell parity proof under ORACLE_IR_SPELL_PRIMARY.
 * Kept in sync with mandatory fallback kinds plus optional trigger runtime kinds.
 */
export const ORACLE_IR_SPELL_RETIRED_STEP_KINDS = new Set<string>([
  ...ORACLE_IR_FALLBACK_STEP_KINDS,
  ...TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
  ...ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS,
]);

/**
 * categorizeSpell opcodes with IR parity proof under ORACLE_IR_SPELL_PRIMARY.
 * Used for documentation and incremental retirement; spell routing skips all
 * categorizeSpell execution when isSpellEffectOwnedByOracleIrPrimary is true.
 */
export const ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS = new Set<string>([
  'DRAW_CARDS',
  'DRAW_CARDS_EACH_OPPONENT',
  'DRAW_CARDS_EACH_PLAYER',
  'DRAW_TARGET_PLAYER',
  'GAIN_LIFE',
  'GAIN_LIFE_TARGET_PLAYER',
  'GAIN_LIFE_EACH_OPPONENT',
  'GAIN_LIFE_EACH_PLAYER',
  'LOSE_LIFE',
  'LOSE_LIFE_TARGET_PLAYER',
  'LOSE_LIFE_EACH_OPPONENT',
  'LOSE_LIFE_EACH_PLAYER',
  'SCRY',
  'SCRY_EACH_OPPONENT',
  'SCRY_EACH_PLAYER',
  'SURVEIL',
  'SURVEIL_EACH_OPPONENT',
  'SURVEIL_EACH_PLAYER',
  'SURVEIL_TARGET_PLAYER',
  'INVESTIGATE',
  'GOAD_TARGET',
  'TAP_ALL',
  'UNTAP_ALL',
  'TAP_ALL_TARGET_PLAYER',
  'UNTAP_ALL_TARGET_PLAYER',
  'DISCARD_TARGET_PLAYER',
  'DISCARD_EACH_OPPONENT',
  'DISCARD_EACH_PLAYER',
  'DESTROY_TARGET',
  'MILL_TARGET_PLAYER',
  'MILL_EACH_OPPONENT',
  'MILL_EACH_PLAYER',
  'MILL_SELF',
  'CREATE_TOKEN',
  'DAMAGE_TARGET_PLAYER',
  'DAMAGE_EACH_OPPONENT',
  'DAMAGE_EACH_PLAYER',
  'ANY_TARGET_DAMAGE',
  'DAMAGE_TARGET',
  'DAMAGE_EACH',
  'DESTROY_EACH',
  'DESTROY_ALL',
  'DESTROY_ALL_TARGET_PLAYER',
  'EXILE_TARGET',
  'EXILE_ALL',
  'EXILE_ALL_TARGET_PLAYER',
  'BOUNCE_TARGET',
  'COUNTER_TARGET_SPELL',
  'COUNTER_TARGET_ABILITY',
  'TAP_TARGET',
  'UNTAP_TARGET',
  'ADD_COUNTERS_TARGET',
  'ADD_COUNTERS_EACH',
  'FLICKER_TARGET',
  'BLIGHT_SELF',
  'BLIGHT_EACH_OPPONENT',
  'BLIGHT_EACH_PLAYER',
  'BLIGHT_TARGET_OPPONENT',
  'BLIGHT_TARGET_PLAYER',
  'TARGET_CREATURE',
  'TARGET_PERMANENT',
  'TARGET_PLAYER',
]);

function collectSpellEffectSteps(oracleText: string, spellName: string): OracleEffectStep[] {
  return collectSpellResolutionEffectSteps(
    oracleText,
    spellName,
    buildOracleOverlayCollectOptions({ cardName: spellName, sourceName: spellName }),
  );
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

  return isSpellEffectFullyIrWired(text, spellName);
}

/** Parsed spell steps are fully runtime-wired (independent of ORACLE_IR_SPELL_PRIMARY). */
export function isSpellEffectFullyIrWired(oracleText: string, spellName: string): boolean {
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

/**
 * Defense-in-depth for individual legacy spell regex handlers.
 * Always returns false: orchestrators (tryResolveInstantSorceryOracleIrSpell early
 * return, oracleIrSpellHandled body gate) already prevent double-apply when IR succeeds.
 */
export function skipRetiredSpellLegacyHandler(_oracleText: string, _spellName = ''): boolean {
  return false;
}

export function shouldSkipLegacySpellCategorizeExecution(
  oracleText: string,
  spellName: string,
): boolean {
  return isSpellEffectOwnedByOracleIrPrimary(oracleText, spellName);
}

/**
 * Orchestrator-level skip: when IR primary owns the spell effect, bypass the
 * legacy body handler chain entirely. Structural graveyard/copy riders still
 * run before this gate; finalize tail still runs after.
 */
export function shouldSkipLegacySpellBodyHandlers(
  oracleText: string,
  spellName: string,
): boolean {
  return shouldSkipLegacySpellRegexHandlers(oracleText, spellName);
}

export function isCategorizeOpcodeRetiredUnderOracleIrPrimary(op: string | undefined): boolean {
  if (!op) return false;
  return ORACLE_IR_SPELL_RETIRED_CATEGORIZE_OPS.has(String(op));
}

export function isSpellStepKindRetiredUnderOracleIrPrimary(kind: string | undefined): boolean {
  if (!kind) return false;
  return ORACLE_IR_SPELL_RETIRED_STEP_KINDS.has(String(kind));
}

export function maybeSuppressRetiredCategorizeSpellSpec<T extends { op?: string } | null>(spec: T): T {
  if (!spec) return spec;
  if (!isOracleIrSpellPrimaryEnabled()) return spec;
  if (isCategorizeOpcodeRetiredUnderOracleIrPrimary(String(spec.op || ''))) {
    return null as T;
  }
  return spec;
}
