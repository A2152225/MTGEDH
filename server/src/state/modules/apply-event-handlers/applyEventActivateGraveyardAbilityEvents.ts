// server/src/state/modules/apply-event-handlers/applyEventActivateGraveyardAbilityEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: The activateGraveyardAbility event: paying and resolving graveyard activated abilities.
// Public entry: applyActivateGraveyardAbilityEvents(ctx, e) -> true when it handled the event.
//
// Handles: activateGraveyardAbility
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { buildDiscardProvenanceFields } from "../graveyardEntryUtils.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { applyRecordedBeamUpReturnCost, applyRecordedGraveyardKeywordNonManaCost } from "./applyEventGraveyardCastCostReplay.js"; // B42
import { replayGraveyardSpellCastActivation, replayDisturbCastActivation } from "./applyEventGraveyardSpellCastReplay.js";
import { replayUnearthActivation, replayEmbalmEternalizeActivation, replayScavengeEncoreActivation, replayExileToAddCountersActivation } from "./applyEventGraveyardPermanentAbilityReplay.js";
import { replayGraveyardTutorActivation, replayGraveyardReturnActivation } from "./applyEventGraveyardReturnTutorReplay.js";

export function applyActivateGraveyardAbilityEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "activateGraveyardAbility": {
        // Graveyard ability (flashback, unearth, etc.)
        // The specific effect depends on the ability, but typically moves the card
        const cardId = (e as any).cardId;
        const pid = (e as any).playerId;
        const abilityType = (e as any).abilityType ?? (e as any).abilityId;
        try {
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const replayGameId = String((ctx as any).gameId || '').trim();
          const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
          if (replayGameId && rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) && queuedStepType) {
            try {
              const discardedForCost = Array.isArray((rawQueuedStep as any)?.discardedCardIdsForCost)
                ? ((rawQueuedStep as any).discardedCardIdsForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const exiledFromHandForCost = Array.isArray((rawQueuedStep as any)?.exiledCardIdsFromHandForCost)
                ? ((rawQueuedStep as any).exiledCardIdsFromHandForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const zones = ctx.state.zones || {};
              const z = zones[pid];
              if (z && Array.isArray(z.hand)) {
                if (discardedForCost.length > 0) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
                  for (const discardId of discardedForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === discardId);
                    if (handIndex === -1) continue;
                    const [discardedCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.graveyard as any[]).push({
                      ...discardedCard,
                      zone: 'graveyard',
                      ...buildDiscardProvenanceFields(ctx.state, String(pid)),
                    });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                }
                if (exiledFromHandForCost.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];
                  for (const exileId of exiledFromHandForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (handIndex === -1) continue;
                    const [exiledCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;

                  const stateAny = ctx.state as any;
                  stateAny.discardedCardThisTurn = stateAny.discardedCardThisTurn || {};
                  stateAny.discardedCardThisTurn[String(pid)] = true;
                  stateAny.anyPlayerDiscardedCardThisTurn = true;
                }
              }
            } catch {
              // best-effort only
            }

            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
            const alreadyPresent = Boolean(
              (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
              (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
            );

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(replayGameId, {
                ...(rawQueuedStep as any),
                ...(queuedStepId ? { id: queuedStepId } : {}),
                type: queuedStepType as any,
                playerId: String((rawQueuedStep as any).playerId || pid || '') as any,
                description: String((rawQueuedStep as any).description || ''),
                mandatory: (rawQueuedStep as any).mandatory !== false,
              } as any);
            }

            ctx.bumpSeq();
            break;
          }

          if (cardId && pid && ['flashback', 'jump-start', 'retrace', 'escape', 'graveyard-cast', 'beam-me-up'].includes(String(abilityType))) {
              replayGraveyardSpellCastActivation(ctx, e, cardId, pid, abilityType);
          } else if (cardId && pid && abilityType === 'unearth') {
              replayUnearthActivation(ctx, e, cardId, pid, abilityType);
          } else if (cardId && pid && (abilityType === 'embalm' || abilityType === 'eternalize')) {
              replayEmbalmEternalizeActivation(ctx, e, cardId, pid, abilityType);
          } else if (cardId && pid && abilityType === 'disturb') {
              replayDisturbCastActivation(ctx, e, cardId, pid, abilityType);
          } else if (cardId && pid && (abilityType === 'scavenge' || abilityType === 'encore')) {
              replayScavengeEncoreActivation(ctx, e, cardId, pid, abilityType);
          } else if (cardId && pid && abilityType === 'exile-to-add-counters') {
              replayExileToAddCountersActivation(ctx, e, cardId, pid, abilityType);
          } else if (cardId && pid && (e as any).isTutor === true) {
              replayGraveyardTutorActivation(ctx, e, cardId, pid, abilityType);
          } else if (
            cardId &&
            pid &&
            (abilityType === 'return-from-graveyard' || abilityType === 'graveyard-activated' || String(abilityType || '').includes('-return-')) &&
            (e as any).isTutor !== true
          ) {
              replayGraveyardReturnActivation(ctx, e, cardId, pid, abilityType);
          }
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activateGraveyardAbility): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
