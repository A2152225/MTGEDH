// server/src/state/modules/apply-event-handlers/applyEventPlayerInitiatedCancelEvents.ts
//
// Cluster: player-started prompt cancellation (cast-time Choose X, Replicate count,
// planeswalker +X/-X, cast-time spell target selection).
// Public entry: applyPlayerInitiatedCancelEvents(ctx, e) -> true when it handled the event.
//
// Handles: playerInitiatedStepCancel
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { debugWarn } from "../../../utils/debug.js";

export function applyPlayerInitiatedCancelEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
    case "playerInitiatedStepCancel": {
      try {
        const ev = e as any;
        const gameId = String((ctx as any).gameId || '').trim();
        const playerId = String(ev.playerId || '').trim();
        const stepIds = (Array.isArray(ev.cancelledStepIds) ? ev.cancelledStepIds : [ev.stepId])
          .map((id: any) => String(id || '').trim())
          .filter(Boolean);

        if (gameId) {
          const queue = ResolutionQueueManager.getQueue(gameId) as any;
          const queuedIds = new Set<string>([
            ...(Array.isArray(queue?.steps) ? queue.steps.map((step: any) => String(step?.id || '')) : []),
            ...(queue?.activeStep ? [String(queue.activeStep.id || '')] : []),
          ]);
          for (const stepId of stepIds) {
            if (queuedIds.has(stepId)) ResolutionQueueManager.cancelStep(gameId, stepId);
          }
        }

        const stateAny = ctx.state as any;
        const pending = stateAny?.pendingSpellCasts;
        if (pending && typeof pending === 'object') {
          const effectId = String(ev.effectId || '').trim();
          if (effectId && pending[effectId]) delete pending[effectId];
          const spellCardId = String(ev.spellCardId || '').trim();
          if (spellCardId) {
            for (const [pendingId, entry] of Object.entries(pending)) {
              const p = entry as any;
              if (String(p?.cardId || '') !== spellCardId) continue;
              if (playerId && p?.playerId && String(p.playerId) !== playerId) continue;
              delete pending[pendingId];
            }
          }
        }

        if (gameId) {
          const summary = ResolutionQueueManager.getPendingSummary(gameId);
          if (!summary.hasPending && stateAny?.priority == null && stateAny?.turnPlayer) {
            stateAny.priority = stateAny.turnPlayer;
            stateAny.priorityPassedBy = new Set<string>();
          }
        }

        ctx.bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(playerInitiatedStepCancel): failed', err);
      }
      return true;
    }
    default:
      return false;
  }
}
