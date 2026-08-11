import {
  ResolutionStepType,
  type ResolutionStep,
} from '../resolution/index.js';
import { getSavedMayAbilityTriggerDecision } from '../../socket/trigger-shortcuts.js';
import { checkLifeGainPrevention } from '../utils.js';
import { getMaxHandSizeForPlayer } from '../modules/handSizeUtils.js';
import { readEffectProgramQueueMetadata } from './effectProgramQueueAdapter.js';
import {
  buildOptionalEffectKey as buildNormalizedOptionalEffectKey,
  findMayAutoPreferenceEntry,
} from '../../../../shared/src/optionalEffectKey.js';
import { resolveNoUntilTargetsChangePreference } from '../../../../shared/src/mayAutoPreference.js';

export function extractOptionalEffectText(step: ResolutionStep): string {
  const stepData = step as any;
  const fromField = String(stepData?.effectText || '').trim();
  if (fromField) return fromField;

  const description = String(step.description || '').trim();
  const youMayMatch = description.match(/you may[:\s]+(.+?)(?:\?|$)/i);
  if (youMayMatch?.[1]) {
    return String(youMayMatch[1]).trim();
  }

  const colonMatch = description.match(/:\s*you may\s+(.+?)(?:\?|$)/i);
  if (colonMatch?.[1]) {
    return String(colonMatch[1]).trim();
  }

  return description.replace(/^[^:]+:\s*/i, '').trim() || 'optional effect';
}

export function buildOptionalEffectKey(step: ResolutionStep): string {
  const sourceName = String(step.sourceName || 'Ability').trim();
  const effectText = extractOptionalEffectText(step);
  return buildNormalizedOptionalEffectKey(sourceName, effectText);
}

export function isOptionalEffectProgramChoiceStep(step: ResolutionStep): boolean {
  if (step.type !== ResolutionStepType.OPTION_CHOICE) return false;
  if ((step as any).mandatory === true) return false;
  if (readEffectProgramQueueMetadata(step)) return true;
  return (step as any).optionalTriggeredAbilityPrompt === true || (step as any).mayAbilityPrompt === true;
}

function normalizeOptionalDecisionCore(text: string): string {
  return String(text || '')
    .replace(/\u2019/g, "'")
    .replace(/^you may[:\s]+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Global Auto-Yes Optional is intentionally narrow: only pure freebies with no
 * targeting, costs, or "If you do" follow-ups. Everything else stays a player choice.
 * Per-card Always Yes / Yes×N / trigger shortcuts still apply.
 */
export function isPurelyBeneficialOptionalEffectText(text: string): boolean {
  const full = String(text || '').replace(/\u2019/g, "'").trim();
  if (!full) return false;
  // Multi-clause / consequential templates never qualify.
  if (/\bif you do\b/i.test(full)) return false;
  if (/\btarget\b/i.test(full)) return false;

  const core = normalizeOptionalDecisionCore(full);
  if (!core || /\./.test(core)) return false; // multiple sentences after normalize

  if (/^gain (?:a |an |\d+ |one |two |three |four |five |six |seven |eight |nine |ten )?life$/.test(core)) {
    return true;
  }
  if (/^draw (?:a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?$/.test(core)) {
    return true;
  }
  return false;
}

/** @deprecated Use isPurelyBeneficialOptionalEffectText — kept for older test names. */
export function optionalEffectTextHasConsequentialFollowUp(text: string): boolean {
  return !isPurelyBeneficialOptionalEffectText(text);
}

function collectOptionalStepDecisionText(step: ResolutionStep): string {
  const stepData = step as any;
  // Prefer the short effect clause; fall back to description fragments.
  const primary = extractOptionalEffectText(step);
  if (primary) return primary;
  return [
    String(step.description || ''),
    String(stepData?.effectText || ''),
    String(stepData?.fullAbilityText || ''),
  ].filter(Boolean).join('\n');
}

/** True when accepting this may would queue another player choice in the same Effect Program. */
export function optionalYesLeadsToFurtherPlayerChoice(
  step: ResolutionStep,
  programSteps: readonly { id?: string; kind?: string; guard?: { bindingKey?: string; selectionIncludes?: string }; command?: { kind?: string } }[] | undefined,
): boolean {
  if (!programSteps || programSteps.length === 0) return false;

  const metadata = readEffectProgramQueueMetadata(step);
  const bindingKey = String(metadata?.effectProgramBindingKey || (step as any).effectProgramBindingKey || '').trim();
  const stepId = String(metadata?.effectProgramStepId || (step as any).effectProgramStepId || step.id || '').trim();
  if (!bindingKey && !stepId) return false;

  const startIndex = programSteps.findIndex((entry) => String(entry?.id || '') === stepId);
  const from = startIndex >= 0 ? startIndex + 1 : 0;

  for (let i = from; i < programSteps.length; i += 1) {
    const later = programSteps[i] as any;
    if (!later) continue;

    const guardedByThisMay =
      Boolean(bindingKey)
      && String(later.guard?.bindingKey || '') === bindingKey
      && String(later.guard?.selectionIncludes || 'yes').toLowerCase() === 'yes';

    if (later.kind === 'choice') {
      if (!later.guard || guardedByThisMay || String(later.guard?.bindingKey || '') === bindingKey) {
        return true;
      }
    }

    if (guardedByThisMay && later.kind === 'command') {
      const commandKind = String(later.command?.kind || later.command?.step?.kind || '').toLowerCase();
      if (
        commandKind === 'discard'
        || commandKind === 'sacrifice'
        || commandKind === 'pay_mana'
        || commandKind === 'pay_life'
        || commandKind.includes('discard')
        || commandKind.includes('sacrifice')
      ) {
        return true;
      }
    }
  }

  return false;
}

function lifeGainIsSafeToAutoYes(state: any, playerId: string): boolean {
  try {
    const check = checkLifeGainPrevention(state, playerId);
    // Plague Drone / Tainted Remedy: gain becomes loss — must ask.
    if (check.reversedToLoss) return false;
    // Sulfuric Vortex / Erebos: can't gain — auto-yes is a no-op; still ask.
    if (check.prevented) return false;
    return true;
  } catch {
    return false;
  }
}

const DRAW_COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function parseOptionalDrawCount(text: string): number | undefined {
  const core = normalizeOptionalDecisionCore(text);
  const match = core.match(/^draw (a|an|\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards?$/);
  if (!match) return undefined;
  const token = String(match[1] || '').toLowerCase();
  if (/^\d+$/.test(token)) {
    const n = Number(token);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return DRAW_COUNT_WORDS[token];
}

function getPlayerHandCount(state: any, playerId: string): number {
  const zoneHand = state?.zones?.[playerId]?.hand;
  if (Array.isArray(zoneHand)) return zoneHand.length;
  const zoneCount = Number(state?.zones?.[playerId]?.handCount);
  if (Number.isFinite(zoneCount) && zoneCount >= 0) return zoneCount;
  const player = Array.isArray(state?.players)
    ? state.players.find((entry: any) => entry?.id === playerId)
    : undefined;
  if (Array.isArray(player?.hand)) return player.hand.length;
  return 0;
}

/**
 * Optional draws are only auto-yes safe when they won't force a later hand-size
 * discard (unless Reliquary Tower / Venser's Journal / similar removes the cap).
 */
export function drawIsSafeToAutoYes(state: any, playerId: string, effectText: string): boolean {
  try {
    const drawCount = parseOptionalDrawCount(effectText);
    if (!drawCount) return false;

    const maxHandSize = getMaxHandSizeForPlayer(state, playerId);
    if (maxHandSize === Infinity) return true;

    const handCount = getPlayerHandCount(state, playerId);
    return handCount + drawCount <= maxHandSize;
  } catch {
    return false;
  }
}

export function isGlobalAutoYesOptionalEligible(
  state: any,
  playerId: string,
  step: ResolutionStep,
  programSteps?: readonly { id?: string; kind?: string; guard?: { bindingKey?: string; selectionIncludes?: string }; command?: { kind?: string } }[],
): boolean {
  const effectText = collectOptionalStepDecisionText(step);
  if (!isPurelyBeneficialOptionalEffectText(effectText)) {
    return false;
  }
  if (optionalYesLeadsToFurtherPlayerChoice(step, programSteps)) {
    return false;
  }
  if (/\bgain\b[\s\S]*\blife\b/i.test(effectText) && !lifeGainIsSafeToAutoYes(state, playerId)) {
    return false;
  }
  if (/\bdraw\b/i.test(effectText) && !drawIsSafeToAutoYes(state, playerId, effectText)) {
    return false;
  }
  return true;
}

/** @deprecated Prefer isGlobalAutoYesOptionalEligible (whitelist). */
export function shouldSuppressGlobalAutoYesOptional(
  step: ResolutionStep,
  programSteps?: readonly { id?: string; kind?: string; guard?: { bindingKey?: string; selectionIncludes?: string }; command?: { kind?: string } }[],
  state?: any,
  playerId?: string,
): boolean {
  if (state && playerId) {
    return !isGlobalAutoYesOptionalEligible(state, playerId, step, programSteps);
  }
  // Text-only fallback used by older unit tests without game state.
  if (!isPurelyBeneficialOptionalEffectText(collectOptionalStepDecisionText(step))) {
    return true;
  }
  return optionalYesLeadsToFurtherPlayerChoice(step, programSteps);
}

export function resolveOptionalAutoChoice(
  state: any,
  playerId: string,
  step: ResolutionStep,
  options?: {
    readonly programSteps?: readonly { id?: string; kind?: string; guard?: { bindingKey?: string; selectionIncludes?: string }; command?: { kind?: string } }[];
  },
): 'yes' | 'no' | undefined {
  const effectKey = buildOptionalEffectKey(step);
  const effectText = extractOptionalEffectText(step);
  const prefs = state?.mayAutoPreferences?.[playerId] ?? {};
  const prefEntry = findMayAutoPreferenceEntry(prefs, effectKey);
  const autoPref = prefEntry?.value;
  const storageKey = prefEntry?.key || effectKey;

  // Explicit per-effect / shortcut prefs win over the global Auto-Yes Optional toggle.
  if (autoPref === 'yes') return 'yes';
  if (autoPref === 'no') return 'no';

  const noUntilChoice = resolveNoUntilTargetsChangePreference(
    state,
    playerId,
    storageKey,
    autoPref,
    effectText,
  );
  if (noUntilChoice) return noUntilChoice;

  if (typeof autoPref === 'number' && autoPref > 0) {
    const remaining = autoPref - 1;
    if (!state.mayAutoPreferences) state.mayAutoPreferences = {};
    if (!state.mayAutoPreferences[playerId]) state.mayAutoPreferences[playerId] = {};
    if (remaining <= 0) {
      delete state.mayAutoPreferences[playerId][storageKey];
    } else {
      state.mayAutoPreferences[playerId][storageKey] = remaining;
    }
    return 'yes';
  }

  const sourceName = String(step.sourceName || '').trim();
  const triggerDecision = getSavedMayAbilityTriggerDecision(state, playerId, sourceName);
  if (triggerDecision === 'yes') return 'yes';
  if (triggerDecision === 'no') return 'no';

  if (state?.autoYesOptional?.[playerId] === true) {
    if (!isGlobalAutoYesOptionalEligible(state, playerId, step, options?.programSteps)) {
      return undefined;
    }
    return 'yes';
  }

  return undefined;
}
