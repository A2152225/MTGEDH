import {
  ResolutionStepType,
  type ResolutionStep,
} from '../resolution/index.js';
import { getSavedMayAbilityTriggerDecision } from '../../socket/trigger-shortcuts.js';
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

/**
 * Global Auto-Yes Optional is for freebies (gain life, pure draw). Suppress it when the
 * optional text has an "If you do" follow-up, a player cost (discard/sac/pay/exile), or
 * requires choosing a target (Aura Shards — even with one legal target you may want No).
 * Per-card Always Yes / Yes×N / trigger shortcuts still apply.
 */
export function optionalEffectTextHasConsequentialFollowUp(text: string): boolean {
  const normalized = String(text || '').replace(/\u2019/g, "'").trim();
  if (!normalized) return false;
  if (/\bif you do\b/i.test(normalized)) return true;
  // Targeting mays always need a decision — sole legal target can be your own permanent.
  if (/\btarget\b/i.test(normalized)) return true;
  if (/\b(?:destroy|exile|sacrifice|bounce|return)\b/i.test(normalized)) return true;
  if (/\byou may\b[\s\S]{0,120}\b(?:discard|sacrifice|pay|exile)\b/i.test(normalized)) return true;
  return false;
}

function collectOptionalStepDecisionText(step: ResolutionStep): string {
  const stepData = step as any;
  return [
    extractOptionalEffectText(step),
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

export function shouldSuppressGlobalAutoYesOptional(
  step: ResolutionStep,
  programSteps?: readonly { id?: string; kind?: string; guard?: { bindingKey?: string; selectionIncludes?: string }; command?: { kind?: string } }[],
): boolean {
  if (optionalEffectTextHasConsequentialFollowUp(collectOptionalStepDecisionText(step))) {
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
    if (shouldSuppressGlobalAutoYesOptional(step, options?.programSteps)) {
      return undefined;
    }
    return 'yes';
  }

  return undefined;
}
