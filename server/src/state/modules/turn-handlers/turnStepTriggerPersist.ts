// server/src/state/modules/turn-handlers/turnStepTriggerPersist.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: persistTurnStepTriggeredAbility and
// persistTurnStepTriggerOrderStep.
// Public entry symbols: those two functions.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

export function persistTurnStepTriggeredAbility(ctx: GameContext, stackItem: any, reason: string): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying || !stackItem) return;

  try {
    const {
      id: triggerId,
      type: _type,
      controller: controllerId,
      source: sourceId,
      ...rest
    } = stackItem as Record<string, any>;

    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
      triggerId,
      sourceId,
      controllerId,
      ...rest,
    });
  } catch (err) {
    debugWarn(1, `${ts()} [nextStep] Failed to persist ${reason} trigger:`, err);
  }
}

export function persistTurnStepTriggerOrderStep(ctx: GameContext, step: any, reason: string): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying || !step) return;

  try {
    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'queueTriggerOrderStep', {
      stepId: String(step.id || '').trim(),
      playerId: String(step.playerId || '').trim(),
      description: String(step.description || '').trim(),
      mandatory: step.mandatory !== false,
      triggers: Array.isArray(step.triggers)
        ? step.triggers.map((trigger: any) => ({
            id: String(trigger?.id || '').trim(),
            sourceName: String(trigger?.sourceName || '').trim(),
            effect: String(trigger?.effect || '').trim(),
            ...(trigger?.imageUrl ? { imageUrl: String(trigger.imageUrl) } : null),
          }))
        : [],
      requireAll: step.requireAll === true,
    });
  } catch (err) {
    debugWarn(1, `${ts()} [nextStep] Failed to persist ${reason} trigger-order step:`, err);
  }
}
