// server/src/state/resolution/replayCompletedPromptSteps.ts
// Origin parent: server/src/state/modules/applyEvent.ts (endReplayPass)
// Cluster moved: decide which re-queued prompts a finished replay must not show again.
// Public entry symbols: collectPromptStepIdsCompletedBeforeReplayEnd,
//   dropPromptsCompletedBeforeReplayEnd.
//
// A blocking prompt is the last event until someone answers. If the replay
// continues past that event, the choice already happened and must not be asked
// again. A prompt the replay ends on stays open. Several steps queued together
// (one event, many players) stay open until a later event names each step id.

import { ResolutionQueueManager } from './ResolutionQueueManager.js';
import { cancelStep } from './ResolutionQueue.js';

const BATCH_STEP_EVENT_TYPES = new Set([
  'kynaiosChoiceInitiated',
  'joinForcesInitiated',
  'temptingOfferInitiated',
]);

function asIdList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const one = String(value || '').trim();
  return one ? [one] : [];
}

function eventFields(event: any): any {
  const payload = event?.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...payload, ...event, type: event?.type };
  }
  return event;
}

function queuedStepIds(event: any): string[] {
  const ids: string[] = [];
  const push = (step: any) => {
    const id = String(step?.id || '').trim();
    if (id) ids.push(id);
  };
  if (event?.queuedResolutionStep && typeof event.queuedResolutionStep === 'object') {
    push(event.queuedResolutionStep);
  }
  if (Array.isArray(event?.queuedResolutionSteps)) {
    for (const step of event.queuedResolutionSteps) push(step);
  }
  if (BATCH_STEP_EVENT_TYPES.has(String(event?.type || '')) && Array.isArray(event?.steps)) {
    for (const step of event.steps) push(step);
  }
  if (String(event?.type || '') === 'queueTriggerOrderStep') {
    const stepId = String(event?.stepId || '').trim();
    if (stepId) ids.push(stepId);
  }
  return [...new Set(ids)];
}

function explicitResolvedStepIds(event: any, queuedHere: ReadonlySet<string>): string[] {
  const ids = [
    ...asIdList(event?.resolvedStepId),
    ...asIdList(event?.resolvedStepIds),
    ...asIdList(event?.cancelledStepIds),
  ];
  const stepId = String(event?.stepId || '').trim();
  if (stepId && !queuedHere.has(stepId)) ids.push(stepId);
  return [...new Set(ids)];
}

/**
 * Step ids whose prompt was already answered inside this replay window.
 * The last unanswered single-step prompt is omitted, so undo can still stop on it.
 */
export function collectPromptStepIdsCompletedBeforeReplayEnd(events: readonly any[]): Set<string> {
  const completed = new Set<string>();
  const lastQueuedIndex = new Map<string, number>();
  let openSingle: { id: string; index: number } | null = null;

  if (!Array.isArray(events)) return completed;

  for (let index = 0; index < events.length; index++) {
    const event = eventFields(events[index]);
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') continue;

    if (openSingle && openSingle.index < index) {
      completed.add(openSingle.id);
      openSingle = null;
    }

    const queued = queuedStepIds(event);
    const queuedHere = new Set(queued);
    for (const stepId of explicitResolvedStepIds(event, queuedHere)) {
      const queuedAt = lastQueuedIndex.get(stepId);
      if (queuedAt != null && queuedAt < index) completed.add(stepId);
    }

    for (const stepId of queued) {
      lastQueuedIndex.set(stepId, index);
      completed.delete(stepId);
    }

    openSingle = queued.length === 1 ? { id: queued[0], index } : null;
  }

  return completed;
}

/** Remove re-queued prompts that this replay already played past. Does not emit. */
export function dropPromptsCompletedBeforeReplayEnd(gameId: string, events: readonly any[]): void {
  const id = String(gameId || '').trim();
  if (!id) return;
  const completed = collectPromptStepIdsCompletedBeforeReplayEnd(events);
  if (completed.size === 0) return;
  const queue = ResolutionQueueManager.getQueue(id);
  for (const stepId of completed) {
    cancelStep(queue, stepId);
  }
}
