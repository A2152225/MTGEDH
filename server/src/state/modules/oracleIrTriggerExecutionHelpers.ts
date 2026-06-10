import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import {
  collectOracleEffectSteps,
  parseTriggerEffectSteps,
} from './trigger-runtime-wiring.js';
import { normalizeOracleIrSelectedModeIds } from './oracleIrModeSelection.js';

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
): ReturnType<typeof parseTriggerEffectSteps> {
  const steps = collectOracleEffectSteps(effectText, sourceName);
  if (steps.length > 0) return steps;
  return parseTriggerEffectSteps(effectText, sourceName);
}

export function buildTriggerExecutionOptionsFromSteps(
  steps: readonly OracleEffectStep[],
  triggerItem?: any,
): {
  allowOptional: true;
  selectedModeIds?: readonly string[];
} {
  const rawModeIds = resolveTriggerSelectedModeIds(triggerItem);
  return {
    allowOptional: true,
    selectedModeIds: normalizeOracleIrSelectedModeIds(steps, rawModeIds),
  };
}
