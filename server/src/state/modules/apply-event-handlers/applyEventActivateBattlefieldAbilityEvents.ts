// server/src/state/modules/apply-event-handlers/applyEventActivateBattlefieldAbilityEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Battlefield activation replay wrapper plus leftover cascadeResolve.
// Public entry: applyActivateBattlefieldAbilityEvents(ctx, e) -> true when it handled the event.
//
// Handles: activateBattlefieldAbility, cascadeResolve
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { markExhaustAbilityActivated } from "../keywordActivationState.js";
import { clearReplayQueuedSteps, clearReplayQueuedStepById } from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  cloneLibraryCards,
  getPlayerLibraryFromContext,
  buildLibraryAfterCascadeResolve,
  eventHasOwnField,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../resolution/index.js";
import { applyActivateBattlefieldAbilityCostReplay } from "./applyEventActivateBattlefieldAbilityCostReplay.js";
import { applyActivateBattlefieldAbilityStackReplay } from "./applyEventActivateBattlefieldAbilityStackReplay.js";

export function applyActivateBattlefieldAbilityEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "activateBattlefieldAbility": {
        // Critical undo/replay gap #3 contract (split, not a full effect re-executor):
        // - Replay cost/tap/stack evidence recorded on the event (discard/exile/sac/bounce/tap/
        //   mana delta/life/counters-as-cost/exert/hideaway/queued step).
        // - Rebuild stack items for usesStack / known abilityTypes so later resolve events apply effects.
        // - Apply rich non-stack effect payload fields when present (counterUpdates, specialAnimation,
        //   hideawayMovedCardToHand, known abilityType one-shots like humble-defector).
        // - Do NOT invent arbitrary activated effects. Live paths must emit discrete follow-up events
        //   (activateManaAbility, battlefieldPermanentPatch, updateCounters, resolve events, etc.)
        //   for mutations this stub cannot reconstruct. Fail closed with a warning when usesStack is
        //   false and no reconstructible effect evidence is present.
        try {
          const stateAny = ctx.state as any;
          const replayGameId = String((ctx as any).gameId || '').trim();
          clearReplayQueuedStepById(replayGameId, String((e as any).resolvedStepId || '').trim());

          const playerId = (e as any).playerId;
          const permId = (e as any).permanentId;
          const abilityId = (e as any).abilityId;
          const abilityText = String((e as any).abilityText || '');
          const activatedAbilityText = String((e as any).activatedAbilityText || '');
          const activatedAbilityIndex = Number((e as any).activatedAbilityIndex);
          const persistedStackItemId = String((e as any).stackItemId || '').trim();
          const persistedTargets = Array.isArray((e as any).targets)
            ? ((e as any).targets as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
            : [];

          if ((e as any).exhaustAbility === true && permId != null && Number.isFinite(activatedAbilityIndex)) {
            markExhaustAbilityActivated(stateAny, permId, activatedAbilityIndex);
          }

          if (replayGameId && (persistedStackItemId || persistedTargets.length > 0)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;

              const stepType = String((step as any)?.type || '');
              const isBattlefieldTargetStep =
                stepType === String(ResolutionStepType.TARGET_SELECTION) &&
                (step as any)?.battlefieldAbilityTargetSelection === true;
              const isBattlefieldPaymentStep =
                stepType === String(ResolutionStepType.MANA_PAYMENT_CHOICE) &&
                (step as any)?.activationPaymentChoice === true;
              if (!isBattlefieldTargetStep && !isBattlefieldPaymentStep) {
                return false;
              }

              const stepPermId = String((step as any)?.permanentId || (step as any)?.sourceId || '').trim();
              if (permId != null && stepPermId !== String(permId)) return false;
              if (playerId != null && String((step as any)?.playerId || '').trim() !== String(playerId)) return false;

              const stepAbilityId = String((step as any)?.abilityId || '').trim();
              const eventAbilityId = String(abilityId || '').trim();
              if (stepAbilityId && eventAbilityId && stepAbilityId !== eventAbilityId) return false;

              return true;
            });
          }
          if (applyActivateBattlefieldAbilityCostReplay(ctx, e)) break;
          applyActivateBattlefieldAbilityStackReplay(ctx, e);

          // Detect mana ability (mirrors socket-side checks): produces mana and doesn't target.
          const isManaAbility =
            /add\s+(\{[wubrgc]\}(?:\s+or\s+\{[wubrgc]\})?|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) &&
            !/target/i.test(abilityText);

          if (!isManaAbility) break;

          const playerKey = playerId != null ? String(playerId) : '';
          const permKey = permId != null ? String(permId) : '';
          const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
          if (playerKey && permKey) {
            stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
            stateAny.addedManaWithThisAbilityThisTurn[playerKey] = stateAny.addedManaWithThisAbilityThisTurn[playerKey] || {};
            const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
            (stateAny.addedManaWithThisAbilityThisTurn[playerKey] as any)[k] = true;
          }

          try {
            if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
          } catch {}
        } catch (err) {
          debugWarn(1, 'applyEvent(activateBattlefieldAbility): failed', err);
        }
        break;
      }

        case "cascadeResolve": {
          const pid = String((e as any).playerId || '').trim();
          const effectId = String((e as any).effectId || '').trim();
          const sourceCardId = String((e as any).sourceCardId || '').trim();
          const sourceName = String((e as any).sourceName || '').trim();
          const cascadeNumber = Number((e as any).cascadeNumber || 0);
          const cast = (e as any).cast === true;
          const hitCard = (e as any).hitCard && typeof (e as any).hitCard === 'object'
            ? { ...(e as any).hitCard }
            : null;
          const exiledCards = Array.isArray((e as any).exiledCards) ? (e as any).exiledCards as any[] : [];
          const remainingLibraryIds = Array.isArray((e as any).remainingLibraryIds)
            ? ((e as any).remainingLibraryIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const bottomCardIds = Array.isArray((e as any).bottomCardIds)
            ? ((e as any).bottomCardIds as any[]).map((id: any) => String(id || '')).filter(Boolean)
            : [];
          const hasLibraryAfterField = eventHasOwnField(e, 'libraryAfter');
          const libraryAfterSnapshot = hasLibraryAfterField
            ? cloneLibraryCards((e as any).libraryAfter as any[])
            : [];
          const libraryAfter = hasLibraryAfterField
            ? libraryAfterSnapshot
            : buildLibraryAfterCascadeResolve(
                getPlayerLibraryFromContext(ctx, pid),
                exiledCards,
                remainingLibraryIds,
                bottomCardIds,
              );

          try {
            if (!pid) break;

            const gameId = String((ctx as any).gameId || '').trim();
            if (gameId) {
              try {
                const queue = ResolutionQueueManager.getQueue(gameId) as any;
                const matchesCascadeStep = (step: any): boolean => {
                  if (!step || String(step?.type || '') !== String(ResolutionStepType.CASCADE)) {
                    return false;
                  }
                  if (String(step?.playerId || '') !== pid) {
                    return false;
                  }
                  if (effectId && String(step?.effectId || '') === effectId) {
                    return true;
                  }
                  if (sourceCardId && String(step?.sourceId || '') === sourceCardId) {
                    return cascadeNumber <= 0 || Number(step?.cascadeNumber || 0) === cascadeNumber;
                  }
                  return Boolean(sourceName) && String(step?.sourceName || '') === sourceName;
                };

                const activeStepMatched = matchesCascadeStep(queue?.activeStep);
                const beforeCount = Array.isArray(queue?.steps) ? queue.steps.length : 0;

                if (activeStepMatched) {
                  queue.activeStep = undefined;
                }
                if (Array.isArray(queue?.steps) && beforeCount > 0) {
                  queue.steps = queue.steps.filter((step: any) => !matchesCascadeStep(step));
                }
                if (activeStepMatched || beforeCount !== (Array.isArray(queue?.steps) ? queue.steps.length : 0)) {
                  queue.seq = Number(queue?.seq || 0) + 1;
                }
              } catch {
                // best-effort only
              }
            }

            const pendingCascade = (((ctx.state as any) || {}).pendingCascade || {}) as Record<string, any[]>;
            const playerQueue = Array.isArray(pendingCascade[pid]) ? pendingCascade[pid] : [];
            const matchingIndex = playerQueue.findIndex((entry: any) => {
              if (effectId && String(entry?.effectId || '') === effectId) return true;
              if (sourceCardId && String(entry?.sourceCardId || '') === sourceCardId) {
                return cascadeNumber <= 0 || Number(entry?.instance || 0) === cascadeNumber;
              }
              return Boolean(sourceName) && String(entry?.sourceName || '') === sourceName;
            });
            if (matchingIndex >= 0) {
              playerQueue.splice(matchingIndex, 1);
            }
            if (playerQueue.length > 0) {
              pendingCascade[pid] = playerQueue;
            } else if (pid in pendingCascade) {
              delete pendingCascade[pid];
            }
            if (Object.keys(pendingCascade).length > 0) {
              (ctx.state as any).pendingCascade = pendingCascade;
            } else {
              delete (ctx.state as any).pendingCascade;
            }

            const zones = (ctx.state as any).zones || {};
            const z = zones[pid] || {
              hand: [],
              handCount: 0,
              library: [],
              libraryCount: 0,
              graveyard: [],
              graveyardCount: 0,
              exile: [],
              exileCount: 0,
            };
            zones[pid] = z;

            (z as any).library = libraryAfter;
            z.libraryCount = libraryAfter.length;
            if (ctx.libraries?.set) {
              ctx.libraries.set(pid as any, cloneLibraryCards(libraryAfter));
            }

            if (cast && hitCard) {
              const exile = Array.isArray((z as any).exile) ? (z as any).exile : [];
              if (!exile.some((card: any) => String(card?.id || '') === String(hitCard.id || ''))) {
                exile.push({ ...hitCard, zone: 'exile' });
              }
              (z as any).exile = exile;
              (z as any).exileCount = exile.length;
            }

            ctx.bumpSeq();
          } catch (err) {
            debugWarn(1, 'applyEvent(cascadeResolve): failed', err);
          }
          break;
        }

      default:
        return false;
  }

  return true;
}
