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

export function resolveOptionalAutoChoice(
  state: any,
  playerId: string,
  step: ResolutionStep,
): 'yes' | 'no' | undefined {
  if (state?.autoYesOptional?.[playerId] === true) {
    return 'yes';
  }

  const effectKey = buildOptionalEffectKey(step);
  const prefs = state?.mayAutoPreferences?.[playerId] ?? {};
  const prefEntry = findMayAutoPreferenceEntry(prefs, effectKey);
  const autoPref = prefEntry?.value;

  if (autoPref === 'yes') return 'yes';
  if (autoPref === 'no') return 'no';

  if (typeof autoPref === 'number' && autoPref > 0) {
    const remaining = autoPref - 1;
    if (!state.mayAutoPreferences) state.mayAutoPreferences = {};
    if (!state.mayAutoPreferences[playerId]) state.mayAutoPreferences[playerId] = {};
    const storageKey = prefEntry?.key || effectKey;
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

  return undefined;
}
