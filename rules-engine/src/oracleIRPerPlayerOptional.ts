import type { OracleEffectStep } from './oracleIR.js';
import {
  isEachPlayerMayPutCountersOnCreatureTheyControlStep,
  isEachPlayerMayPutCountersOnCreatureTheyControlText,
} from './oracleIRCounterPlacement.js';

export function normalizePerPlayerOptionalText(text: string): string {
  return String(text || '').replace(/\u2019/g, "'").trim();
}

const PER_PLAYER_OPTIONAL_EFFECT_PATTERNS: readonly RegExp[] = [
  /\beach player may\b/i,
  /\bstarting with you, each player may\b/i,
  /\bin turn order, each player may\b/i,
  /\byou and (?:that player|target player) may each\b/i,
];

/**
 * Effect text that resolves with per-player choices (APNAP), not a single controller yes/no.
 * Examples: Orzhov Advokist, Agitator Ant, Kynaios land/draw, Join Forces, Hypergenesis.
 */
export function isPerPlayerOptionalEffectText(effectText: string): boolean {
  const normalized = normalizePerPlayerOptionalText(effectText);
  if (!normalized || !/\bmay\b/i.test(normalized)) return false;
  if (isEachPlayerMayPutCountersOnCreatureTheyControlText(normalized)) return true;
  return PER_PLAYER_OPTIONAL_EFFECT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Controller may decline the entire triggered ability (Rule 603.4 optional).
 * Per-player "each player may …" effects are mandatory at trigger time.
 * Opponent-tax "you may … unless that player pays" is not a controller Yes/No.
 */
export function isControllerOptionalTriggeredAbilityEffectText(effectText: string): boolean {
  const lower = normalizePerPlayerOptionalText(effectText).toLowerCase();
  if (!lower) return false;
  if (isPerPlayerOptionalEffectText(effectText)) return false;
  if (/\bunless\b[\s\S]*\b(?:that player|that opponent|its controller|they)\b[\s\S]*\bpays?\b/.test(lower)) {
    return false;
  }
  return /\byou may\b/.test(lower);
}

export function isEachPlayerMayPutLandFromHandOracleStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'move_zone') return false;
  if ((step as { optional?: boolean }).optional !== true) return false;
  const raw = normalizePerPlayerOptionalText(String(step.raw || ''));
  return /^each player may put a land card from their hand onto the battlefield$/i.test(raw);
}

function normalizeControllerLandPlayStepRaw(raw: string): string {
  return normalizePerPlayerOptionalText(raw)
    .replace(/^then,?\s+/i, '')
    .trim();
}

export function isControllerMayPutLandFromHandOracleStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'move_zone') return false;
  if ((step as { optional?: boolean }).optional !== true) return false;
  const raw = normalizeControllerLandPlayStepRaw(String(step.raw || ''));
  return /^you may put a land card from your hand onto the battlefield$/i.test(raw);
}

export function isBothPlayersMayPutPermanentFromHandOracleStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'move_zone') return false;
  if ((step as { optional?: boolean }).optional !== true) return false;
  const raw = normalizePerPlayerOptionalText(String(step.raw || ''));
  return /^you and that player may each put a permanent card from your hand onto the battlefield$/i.test(raw);
}

export function isStartingWithYouEachPlayerMayPutFromHandOracleStep(step: OracleEffectStep): boolean {
  if (step.kind !== 'move_zone') return false;
  if ((step as { optional?: boolean }).optional !== true) return false;
  const raw = normalizePerPlayerOptionalText(String(step.raw || ''));
  return /^starting with you, each player may put /i.test(raw);
}

/** Optional IR steps that must defer to server per-player prompts instead of auto-applying. */
export function isPerPlayerOptionalOracleStep(step: OracleEffectStep): boolean {
  if ((step as { optional?: boolean }).optional !== true) return false;
  return (
    isEachPlayerMayPutCountersOnCreatureTheyControlStep(step)
    || isEachPlayerMayPutLandFromHandOracleStep(step)
    || isBothPlayersMayPutPermanentFromHandOracleStep(step)
    || isStartingWithYouEachPlayerMayPutFromHandOracleStep(step)
  );
}

/**
 * Optional IR steps whose prompts are bridged to dedicated server resolution flows
 * (per-player APNAP batches, Kynaios land/draw, counter placement, controller
 * land-from-hand, etc.). The generic OPTION_CHOICE bridge must skip these — otherwise
 * duplicate prompts recurse through Oracle IR resume and can blow the stack.
 *
 * Keep in sync with queue*PromptsFromOracleIRResult in oracleIrServerZoneSync.ts.
 */
export function isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt(
  step: OracleEffectStep,
): boolean {
  if (isPerPlayerOptionalOracleStep(step)) return true;
  if (isControllerMayPutLandFromHandOracleStep(step)) return true;
  // Mill-from-among free-cast queues GRAVEYARD_SELECTION, not generic Yes/No.
  return String(step.kind || '') === 'may_cast_from_among';
}
