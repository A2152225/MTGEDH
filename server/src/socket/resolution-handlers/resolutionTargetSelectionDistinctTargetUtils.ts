/**
 * socket/resolution-handlers/resolutionTargetSelectionDistinctTargetUtils.ts
 *
 * Extracted from server/src/socket/resolution.ts.
 *
 * Cluster: the "another / different target" heuristics shared by the TARGET_SELECTION pre-complete
 * validator, sanitizeStepForClient and the AI target picker. They were private functions of the
 * parent, which forced aiTargetSelectionStepResponses.ts to take getFilteredValidTargetsForStep as
 * an injected helper; hosting them in a leaf lets validators import them directly.
 *
 * Public entry symbols: stepIndicatesDifferentTarget, getPreviouslyChosenTargetsForSource,
 * getFilteredValidTargetsForStep.
 */

import {
  ResolutionQueueManager,
  ResolutionStepStatus,
  ResolutionStepType,
  type TargetSelectionStep,
} from "../../state/resolution/index.js";

export function stepIndicatesDifferentTarget(step: TargetSelectionStep): boolean {
  if ((step as any).disallowPreviouslyChosenTargets === true) return true;

  const combinedText = `${step.targetDescription || ''} ${step.description || ''}`.toLowerCase();

  // Phrasing where the distinctness indicator comes after "target".
  // Examples: "target creature other than that target", "other than the chosen target".
  // Be conservative: require explicit reference to a previously chosen target.
  if (/\bother than\b[^.]*\b(that|the chosen|the first|the second)\s+targets?\b/.test(combinedText)) {
    return true;
  }

  // Be conservative: only infer a cross-step distinct-target constraint for phrases like
  // "another target" / "different target" / "other target" etc. Plain "another/other" can mean other things.
  // Allow plural "targets" as well.
  // Also allow a small number of adjective words between the keyword and the literal word "target(s)",
  // e.g. "a different creature target" / "choose another permanent target".
  if (
    /\b(another|different|other|new|next|additional|remaining)\b(?:\s+[a-z0-9-]+){0,3}\s+targets?\b/.test(
      combinedText
    )
  ) {
    return true;
  }

  // Also common in templated prompts: "second target" / "third target" / "2nd target".
  if (/\b(second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+target\b/.test(combinedText)) {
    return true;
  }
  if (/\b\d+(?:st|nd|rd|th)\s+target\b/.test(combinedText)) return true;

  // Secondary heuristic: require that the target description is explicitly target-oriented.
  const targetDesc = (step.targetDescription || '').toLowerCase();
  if (targetDesc.includes('target') && /\b(another|different|other|new|next|additional|remaining)\b/.test(combinedText)) {
    return true;
  }

  return false;
}

export function getPreviouslyChosenTargetsForSource(gameId: string, sourceId: string): Set<string> {
  const queue = ResolutionQueueManager.getQueue(gameId);
  const chosen = new Set<string>();

  for (const completed of queue.completedSteps) {
    if (completed.status !== ResolutionStepStatus.COMPLETED) continue;
    if (completed.type !== ResolutionStepType.TARGET_SELECTION) continue;
    if (completed.sourceId !== sourceId) continue;

    const respSelections = (completed.response as any)?.selections;
    if (!Array.isArray(respSelections)) continue;

    for (const id of respSelections) {
      if (typeof id === 'string' && id.length > 0) chosen.add(id);
    }
  }

  return chosen;
}

/**
 * If a TARGET_SELECTION step indicates "another" / "different" target, we can optionally
 * filter out already-chosen target ids from earlier TARGET_SELECTION steps for the same
 * sourceId. Safety fallback: if filtering would drop below minTargets, do not filter.
 */
export function getFilteredValidTargetsForStep(
  gameId: string,
  step: TargetSelectionStep
): readonly any[] {
  if (!step.sourceId) return step.validTargets;
  if (!stepIndicatesDifferentTarget(step)) return step.validTargets;

  const previouslyChosen = getPreviouslyChosenTargetsForSource(gameId, step.sourceId);
  if (previouslyChosen.size === 0) return step.validTargets;

  const filtered = (step.validTargets || []).filter((t: any) => !previouslyChosen.has(t.id));
  if (filtered.length < (step.minTargets ?? 0)) return step.validTargets;
  return filtered;
}
