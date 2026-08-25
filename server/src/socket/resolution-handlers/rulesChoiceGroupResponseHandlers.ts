/**
 * socket/resolution-handlers/rulesChoiceGroupResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse prefix).
 * Cluster moved: extractResolutionSelectionId(s), isRulesChoiceMayAccepted,
 * handleRulesChoiceGroupResponse (batched rules-choice group resolution).
 * Public entry symbols: handleRulesChoiceGroupResponse, extractResolutionSelectionId,
 * extractResolutionSelectionIds.
 *
 * Must not import resolution.ts.
 */

import {
  buildResolutionEventDataFromGameState,
  buildTriggeredAbilityEventDataFromChoices,
  executeTriggeredAbilityEffectWithOracleIR,
} from "../../../../rules-engine/src/triggeredAbilities.js";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepStatus,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";

export function extractResolutionSelectionId(selection: any): string | undefined {
  if (typeof selection === 'string') {
    const normalized = selection.trim();
    return normalized || undefined;
  }

  if (Array.isArray(selection)) {
    for (const entry of selection) {
      const extracted = extractResolutionSelectionId(entry);
      if (extracted) return extracted;
    }
    return undefined;
  }

  if (selection && typeof selection === 'object') {
    const id = typeof (selection as any).id === 'string' ? (selection as any).id.trim() : '';
    if (id) return id;
    const value = typeof (selection as any).value === 'string' ? (selection as any).value.trim() : '';
    if (value) return value;
    const choiceId = typeof (selection as any).choiceId === 'string' ? (selection as any).choiceId.trim() : '';
    if (choiceId) return choiceId;
  }

  return undefined;
}

function isRulesChoiceMayAccepted(step: ResolutionStep): boolean {
  const stepAny = step as any;
  const response = step.response as any;
  if (!stepAny?.mayAbilityPrompt) return true;
  if (response?.cancelled) return false;
  return extractResolutionSelectionId(response?.selections) === 'yes';
}

export function extractResolutionSelectionIds(selection: any): string[] {
  if (typeof selection === 'string') {
    const normalized = selection.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(selection)) {
    return selection
      .flatMap((entry: any) => extractResolutionSelectionIds(entry))
      .filter((id: string, index: number, items: string[]) => items.indexOf(id) === index);
  }

  const extracted = extractResolutionSelectionId(selection);
  return extracted ? [extracted] : [];
}

export async function handleRulesChoiceGroupResponse(
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const stepAny = step as any;
  const groupId = String(stepAny?.rulesChoiceGroupId || '').trim();
  if (!groupId) return;

  const queue = ResolutionQueueManager.getQueue(gameId);
  const pendingGroupSteps = queue.steps.filter((queuedStep: any) => queuedStep?.rulesChoiceGroupId === groupId);

  if (stepAny?.mayAbilityPrompt && !isRulesChoiceMayAccepted(step)) {
    for (const pendingStep of pendingGroupSteps) {
      ResolutionQueueManager.cancelStep(gameId, pendingStep.id);
    }
    debug(2, `[Resolution] Declined grouped rules choice ${groupId} for ${String(stepAny?.rulesTriggerSourceName || step.sourceName || 'ability')}`);
    return;
  }

  if (pendingGroupSteps.length > 0) {
    return;
  }

  const completedGroupSteps = queue.completedSteps
    .filter((completed: any) => completed?.status === ResolutionStepStatus.COMPLETED && completed?.rulesChoiceGroupId === groupId)
    .sort((left: any, right: any) => Number(left?.rulesChoiceIndex ?? 0) - Number(right?.rulesChoiceIndex ?? 0));

  if (completedGroupSteps.length === 0) {
    return;
  }

  const firstStep = completedGroupSteps[0] as any;
  const controllerId = String(firstStep?.rulesTriggerControllerId || response.playerId || '').trim();
  const sourceId = String(firstStep?.rulesTriggerSourceId || firstStep?.sourceId || '').trim();
  const sourceName = String(firstStep?.rulesTriggerSourceName || firstStep?.sourceName || 'Ability').trim() || 'Ability';
  const effectText = String(firstStep?.rulesTriggerEffectText || firstStep?.fullAbilityText || firstStep?.effectText || '').trim();

  if (!controllerId || !sourceId || !effectText) {
    debugWarn(1, `[Resolution] Missing grouped rules choice metadata for ${groupId}`);
    return;
  }

  const executionOverrides = buildTriggeredAbilityEventDataFromChoices(
    game.state as any,
    controllerId,
    completedGroupSteps.map((completed: any) => ({
      type: completed?.type,
      selections: completed?.response?.selections,
      targetTypes: completed?.targetTypes,
      mayAbilityPrompt: completed?.mayAbilityPrompt,
    }))
  );

  const executionEventData = buildResolutionEventDataFromGameState(
    game.state as any,
    controllerId,
    {
      ...(firstStep?.rulesTriggerEventData || {}),
      ...executionOverrides,
    } as any
  );

  const executeResult = executeTriggeredAbilityEffectWithOracleIR(
    game.state as any,
    {
      controllerId: controllerId as any,
      sourceId,
      sourceName,
      effect: effectText,
    },
    executionEventData,
    { allowOptional: true }
  );

  game.state = executeResult.state as any;
  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'rulesChoiceResolved', {
      controllerId,
      sourceId,
      sourceName,
      effectText,
      eventData: executionEventData,
      rulesChoiceGroupId: groupId,
      resolvedStepIds: completedGroupSteps.map((completed: any) => String(completed?.id || '').trim()).filter(Boolean),
    });
  } catch (err) {
    debugWarn(1, `[Resolution] appendEvent(rulesChoiceResolved) failed:`, err);
  }

  debug(2, `[Resolution] Executed grouped rules choice ${groupId} for ${sourceName}: ${(executeResult.log || []).join(' | ')}`);
}
