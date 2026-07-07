import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  collectOracleEffectSteps,
  parseTriggerEffectSteps,
} from './trigger-runtime-wiring.js';
import { extractOracleCardLookupKeys } from './oracleIrCompiledOverlayLookup.js';import { normalizeOracleIrSelectedModeIds } from './oracleIrModeSelection.js';

export function resolveTriggerSelectedModeIds(triggerItem?: any): readonly string[] | undefined {
  const raw = Array.isArray(triggerItem?.selectedModeIds)
    ? triggerItem.selectedModeIds
    : Array.isArray(triggerItem?.selectedModes)
      ? triggerItem.selectedModes
      : undefined;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((mode: unknown) => String(mode || '').trim()).filter(Boolean);
}

export function collectTriggerExecutionSteps(
  effectText: string,
  sourceName: string,
  triggerItem?: any,
): ReturnType<typeof parseTriggerEffectSteps> {
  const cardKeys = extractOracleCardLookupKeys({
    cardName: sourceName,
    sourceName,
    triggerItem,
  });
  const steps = collectOracleEffectSteps(effectText, sourceName, cardKeys);
  if (steps.length > 0) return steps;
  return parseTriggerEffectSteps(effectText, sourceName);
}

export function resolveTriggerPreselectedObjectIds(triggerItem?: any): readonly string[] {
  const normalizedTargetIds = Array.isArray(triggerItem?.targets)
    ? triggerItem.targets.map((target: unknown) => String(target || '').trim()).filter(Boolean)
    : [];
  const ids = [
    triggerItem?.interveningIfSubjectPermanentId,
    ...normalizedTargetIds,
    triggerItem?.effectData?.discardedCardId,
    triggerItem?.boundGraveyardCardId,
    ...(Array.isArray(triggerItem?.chosenObjectIds) ? triggerItem.chosenObjectIds : []),
  ]
    .map((id: unknown) => String(id || '').trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

export function buildTriggerExecutionOptionsFromSteps(
  steps: readonly OracleEffectStep[],
  triggerItem?: any,
): {
  allowOptional: boolean;
  selectedModeIds?: readonly string[];
} {
  const rawModeIds = resolveTriggerSelectedModeIds(triggerItem);
  const hasPreselectedObjects = resolveTriggerPreselectedObjectIds(triggerItem).length > 0;
  return {
    // Defer optional "you may …" steps to resolution prompts unless the trigger
    // already carries explicit object ids (graveyard pick, etc.).
    allowOptional: hasPreselectedObjects,
    selectedModeIds: normalizeOracleIrSelectedModeIds(steps, rawModeIds),
  };
}
