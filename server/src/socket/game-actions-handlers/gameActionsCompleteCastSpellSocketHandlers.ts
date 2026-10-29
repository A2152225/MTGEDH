/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handler for completeCastSpell.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 * completeCastSpell also takes handleCastSpellFromHand because that nested
 * helper still lives in registerGameActions.
 *
 * Public entry symbols: handleCompleteCastSpellRequest.
 */
import type { Server, Socket } from "socket.io";
import type { PaymentItem } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { getMultikickerChargeEntryCounters } from "../../state/modules/multikickerCastUtils.js";
import { ResolutionQueueManager } from "../../state/resolution/index.js";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util";
import { repairReplayCardSourceZones } from "../../state/modules/stackReplayUtils.js";
import { rememberAIFailedSpellCast } from "../ai-handlers/aiLandAuraCommander.js";
import { noteGameStallAiFailure } from "../../state/modules/gameStall/gameStallDetector.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { getPlayerCommandZoneCards } from "./gameActionsPlayerZoneCards.js";
import {
  clearPlayerCompletingSpellCast,
  isSpellAlreadyOnStackForPlayer,
  markPlayerCompletingSpellCast,
  restoreSuspendedLibrarySearchStep,
} from "./gameActionsSpellCastLock.js";
import { normalizeSpellCastSourceZone } from "./gameActionsSpellCastTriggerDetection.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

// =====================================================================
// COMPLETE CAST SPELL - Final step after targets selected and payment made
// Called after both target selection and payment are complete
// =====================================================================
export async function handleCompleteCastSpellRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  handleCastSpellFromHand: (payload?: any) => Promise<any>,
  payload?: {
    gameId?: unknown;
    cardId?: unknown;
    faceIndex?: unknown;
    targets?: unknown;
    payment?: unknown;
    effectId?: unknown;
    xValue?: unknown;
    alternateCostId?: unknown;
    convokeTappedCreatures?: unknown;
    harmonizeTappedCreatureId?: unknown;
    sneakReturnedCreatureId?: unknown;
    webSlingingReturnedCreatureId?: unknown;
  },
): Promise<void> {
  const gameId = payload?.gameId;
  const cardId = payload?.cardId;
  const faceIndex = typeof payload?.faceIndex === 'number' && Number.isFinite(payload.faceIndex)
    ? payload.faceIndex
    : undefined;
  const targets = payload?.targets;
  const payment = payload?.payment;
  const effectId = payload?.effectId;
  const xValue = payload?.xValue;
  const alternateCostId = payload?.alternateCostId;
  const convokeTappedCreatures = payload?.convokeTappedCreatures;
  const harmonizeTappedCreatureId = payload?.harmonizeTappedCreatureId;
  const sneakReturnedCreatureId = payload?.sneakReturnedCreatureId;
  const webSlingingReturnedCreatureId = payload?.webSlingingReturnedCreatureId;

  if (!gameId || typeof gameId !== 'string') return;
  if (!cardId || typeof cardId !== 'string') return;
  if (!(targets === undefined || Array.isArray(targets))) return;
  if (!(payment === undefined || Array.isArray(payment))) return;
  if (!(effectId === undefined || typeof effectId === 'string')) return;
  if (!(xValue === undefined || typeof xValue === 'number')) return;
  if (!(alternateCostId === undefined || typeof alternateCostId === 'string')) return;
  if (!(convokeTappedCreatures === undefined || (Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.every((id) => typeof id === 'string')))) return;
  if (!(harmonizeTappedCreatureId === undefined || typeof harmonizeTappedCreatureId === 'string')) return;
  if (!(sneakReturnedCreatureId === undefined || typeof sneakReturnedCreatureId === 'string')) return;
  if (!(webSlingingReturnedCreatureId === undefined || typeof webSlingingReturnedCreatureId === 'string')) return;

  const effectIdStr = effectId as string | undefined;
  const convokeTapped = convokeTappedCreatures as string[] | undefined;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    if (isSpellAlreadyOnStackForPlayer(game, playerId, cardId)) {
      debug(2, `[completeCastSpell] Spell ${cardId} already on stack for ${playerId}, skipping duplicate completion`);
      // Live AI / payment race: spell is already on the stack but a ghost copy can remain
      // in hand. Strip it and remember the card as failed for this turn so findCastableSpells
      // cannot re-queue the same cast forever (G1 Horizon Chimera DRAW loop).
      const repaired = repairReplayCardSourceZones(game.state, playerId, cardId);
      if (repaired.total > 0) {
        debugWarn(1, `[completeCastSpell] Removed ${repaired.total} stale source-zone entr${repaired.total === 1 ? 'y' : 'ies'} for ${cardId} already on stack`);
        if (typeof game.bumpSeq === 'function') game.bumpSeq();
      }
      rememberAIFailedSpellCast(game, String(playerId), String(cardId));
      // Feed stall detector so repeated duplicate completions can auto-unstuck even if
      // cast-loop primary fixes miss a similar busy path.
      noteGameStallAiFailure(
        String(gameId),
        String(playerId),
        new Error(`duplicate completeCastSpell for ${cardId} already on stack`),
        'completeCastSpellAlreadyOnStack',
      );
      if (effectIdStr && (game.state as any).pendingSpellCasts?.[effectIdStr]) {
        delete (game.state as any).pendingSpellCasts[effectIdStr];
      }
      return;
    }

    let pendingFromZone: SpellCastSourceZone | undefined;
    let pendingBypassExilePermissionCheck = false;
    let pendingIgnoreTimingRestrictions = false;
    let pendingAlternateCostId: string | undefined;
    let pendingXValue: number | undefined;
    let pendingTimesKicked: number | undefined;
    let pendingReplicateCount: number | undefined;
    let pendingSquadTimesPaid: number | undefined;
    let pendingFaceIndex: number | undefined;
    let pendingTargetGrouping: any;
    let suspendedLibrarySearchStep: any;
    let deferredMadnessPromptStepsAfterCast: any[] = [];

    // DEBUG: Log incoming parameters
    debug(2, `[completeCastSpell] DEBUG START ========================================`);
    debug(2, `[completeCastSpell] cardId: ${cardId}, effectId: ${effectIdStr}`);
    debug(2, `[completeCastSpell] targets from client: ${targets ? JSON.stringify(targets) : 'undefined'}`);
    debug(2, `[completeCastSpell] payment from client: ${payment ? JSON.stringify(payment) : 'undefined'}`);
    if (convokeTapped && convokeTapped.length > 0) {
      debug(2, `[completeCastSpell] convokeTappedCreatures:`, convokeTapped);
    }
    
    // Retrieve server-authoritative targets from pending cast data before cleaning up.
    // This preserves previously chosen targets through the queued payment/completion path.
    let finalTargets = targets as any[] | undefined;
    if (effectIdStr && (game.state as any).pendingSpellCasts?.[effectIdStr]) {
      const pendingCast = (game.state as any).pendingSpellCasts[effectIdStr];
      const pendingCardId = String(pendingCast?.cardId || '').trim();

      if (pendingCardId && pendingCardId !== String(cardId)) {
        debugWarn(
          1,
          `[completeCastSpell] Ignoring pending cast ${effectIdStr} for card ${pendingCardId} while completing ${String(cardId)}`,
        );
      } else {
        debug(2, `[completeCastSpell] Found pendingCast:`, JSON.stringify(pendingCast, null, 2));

        pendingFromZone = normalizeSpellCastSourceZone(pendingCast?.fromZone) || undefined;
        pendingBypassExilePermissionCheck = pendingCast?.bypassExilePermissionCheck === true;
        pendingIgnoreTimingRestrictions = pendingCast?.ignoreTimingRestrictions === true;
        pendingAlternateCostId = typeof pendingCast?.forcedAlternateCostId === 'string'
          ? pendingCast.forcedAlternateCostId
          : (typeof pendingCast?.alternateCostId === 'string' ? pendingCast.alternateCostId : undefined);
        pendingXValue = Number.isFinite(pendingCast?.xValue) ? Math.max(0, Math.floor(Number(pendingCast.xValue))) : undefined;
        pendingTimesKicked = Number.isFinite(pendingCast?.timesKicked)
          ? Math.max(0, Math.floor(Number(pendingCast.timesKicked)))
          : (Number.isFinite(pendingCast?.card?.timesKicked)
            ? Math.max(0, Math.floor(Number(pendingCast.card.timesKicked)))
            : undefined);
        const replicateRaw = pendingCast?.replicateCount ?? pendingCast?.card?.replicateCount;
        pendingReplicateCount = Number.isFinite(Number(replicateRaw)) && Number(replicateRaw) > 0
          ? Math.max(0, Math.floor(Number(replicateRaw)))
          : undefined;
        pendingSquadTimesPaid = Number.isFinite(pendingCast?.squadTimesPaid)
          ? Math.max(0, Math.floor(Number(pendingCast.squadTimesPaid)))
          : (Number.isFinite(pendingCast?.card?.squadTimesPaid)
            ? Math.max(0, Math.floor(Number(pendingCast.card.squadTimesPaid)))
            : undefined);
        pendingFaceIndex = Number.isFinite(pendingCast?.faceIndex) ? Number(pendingCast.faceIndex) : undefined;
        pendingTargetGrouping = pendingCast?.targetGrouping;
        deferredMadnessPromptStepsAfterCast = Array.isArray(pendingCast?.queuedMadnessStepsAfterCast)
          ? pendingCast.queuedMadnessStepsAfterCast
              .filter((step: any) => step && typeof step === 'object' && !Array.isArray(step))
              .map((step: any) => ({ ...(step as any) }))
          : [];
        suspendedLibrarySearchStep = String(pendingCast?.fromZone || '').toLowerCase().trim() === 'library'
          ? pendingCast?.librarySearchStepToResume
          : undefined;

      // Mutate metadata is stored on pendingCast; copy it to the actual card object in hand before casting.
      if (String(pendingCast?.forcedAlternateCostId || '') === 'mutate') {
        try {
          const zones = (game.state as any)?.zones?.[playerId];
          const fromZone = normalizeSpellCastSourceZone(pendingCast?.fromZone) || 'hand';
          const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
          const exile: any[] = Array.isArray((zones as any)?.exile) ? (zones as any).exile : [];
          const graveyard: any[] = Array.isArray((zones as any)?.graveyard) ? (zones as any).graveyard : [];
          const library: any[] = Array.isArray((game.libraries as any)?.get?.(playerId))
            ? (game.libraries as any).get(playerId)
            : (Array.isArray((game.libraries as any)?.[playerId]) ? (game.libraries as any)[playerId] : []);
          const sourceArr = fromZone === 'command'
            ? getPlayerCommandZoneCards(game, String(playerId))
            : fromZone === 'exile'
              ? exile
              : fromZone === 'graveyard'
                ? graveyard
                : fromZone === 'library'
                  ? library
                  : hand;
          const cardObj = sourceArr.find((c: any) => c && String(c.id) === String(cardId));
          if (cardObj) {
            (cardObj as any).isMutating = true;
            (cardObj as any).mutateTarget = String(pendingCast?.mutateTarget || (pendingCast?.targets?.[0] ?? ''));
            (cardObj as any).mutateOnTop = Boolean(pendingCast?.mutateOnTop);
            (cardObj as any).mutateCost = String(pendingCast?.mutateCost || pendingCast?.manaCost || '');
          }
        } catch (e) {
          debugWarn(1, '[completeCastSpell] Failed to apply mutate metadata:', e);
        }
      }

      if ('giftPromised' in pendingCast || 'giftRecipient' in pendingCast || 'giftType' in pendingCast) {
        try {
          const zones = (game.state as any)?.zones?.[playerId];
          const fromZone = normalizeSpellCastSourceZone(pendingCast?.fromZone) || 'hand';
          const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
          const exile: any[] = Array.isArray((zones as any)?.exile) ? (zones as any).exile : [];
          const graveyard: any[] = Array.isArray((zones as any)?.graveyard) ? (zones as any).graveyard : [];
          const library: any[] = Array.isArray((game.libraries as any)?.get?.(playerId))
            ? (game.libraries as any).get(playerId)
            : (Array.isArray((game.libraries as any)?.[playerId]) ? (game.libraries as any)[playerId] : []);
          const sourceArr = fromZone === 'command'
            ? getPlayerCommandZoneCards(game, String(playerId))
            : fromZone === 'exile'
              ? exile
              : fromZone === 'graveyard'
                ? graveyard
                : fromZone === 'library'
                  ? library
                  : hand;
          const cardObj = sourceArr.find((c: any) => c && String(c.id) === String(cardId));
          if (cardObj) {
            (cardObj as any).giftPromised = pendingCast?.giftPromised === true;
            if (pendingCast?.giftRecipient) {
              (cardObj as any).giftRecipient = String(pendingCast.giftRecipient);
            } else {
              delete (cardObj as any).giftRecipient;
            }
            if (pendingCast?.giftType) {
              (cardObj as any).giftType = String(pendingCast.giftType);
            } else {
              delete (cardObj as any).giftType;
            }
          }
        } catch (e) {
          debugWarn(1, '[completeCastSpell] Failed to apply gift metadata:', e);
        }
      }

      if (pendingTimesKicked != null && pendingTimesKicked > 0) {
        try {
          const zones = (game.state as any)?.zones?.[playerId];
          const fromZone = normalizeSpellCastSourceZone(pendingCast?.fromZone) || 'hand';
          const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
          const exile: any[] = Array.isArray((zones as any)?.exile) ? (zones as any).exile : [];
          const graveyard: any[] = Array.isArray((zones as any)?.graveyard) ? (zones as any).graveyard : [];
          const library: any[] = Array.isArray((game.libraries as any)?.get?.(playerId))
            ? (game.libraries as any).get(playerId)
            : (Array.isArray((game.libraries as any)?.[playerId]) ? (game.libraries as any)[playerId] : []);
          const sourceArr = fromZone === 'command'
            ? getPlayerCommandZoneCards(game, String(playerId))
            : fromZone === 'exile'
              ? exile
              : fromZone === 'graveyard'
                ? graveyard
                : fromZone === 'library'
                  ? library
                  : hand;
          const cardObj = sourceArr.find((c: any) => c && String(c.id) === String(cardId));
          if (cardObj) {
            (cardObj as any).timesKicked = pendingTimesKicked;
            (cardObj as any).kickerPaidCount = pendingTimesKicked;
            (cardObj as any).wasKicked = true;
            const entryCounters = getMultikickerChargeEntryCounters(
              String(cardObj?.oracle_text || pendingCast?.card?.oracle_text || ''),
              pendingTimesKicked,
            );
            if (entryCounters) {
              (cardObj as any).entersBattlefieldWithCounters = {
                ...((cardObj as any).entersBattlefieldWithCounters || {}),
                ...entryCounters,
              };
            }
          }
        } catch (e) {
          debugWarn(1, '[completeCastSpell] Failed to apply multikicker metadata:', e);
        }
      }

      if (pendingSquadTimesPaid != null) {
        try {
          const zones = (game.state as any)?.zones?.[playerId];
          const fromZone = normalizeSpellCastSourceZone(pendingCast?.fromZone) || 'hand';
          const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
          const exile: any[] = Array.isArray((zones as any)?.exile) ? (zones as any).exile : [];
          const graveyard: any[] = Array.isArray((zones as any)?.graveyard) ? (zones as any).graveyard : [];
          const library: any[] = Array.isArray((game.libraries as any)?.get?.(playerId))
            ? (game.libraries as any).get(playerId)
            : (Array.isArray((game.libraries as any)?.[playerId]) ? (game.libraries as any)[playerId] : []);
          const sourceArr = fromZone === 'command'
            ? getPlayerCommandZoneCards(game, String(playerId))
            : fromZone === 'exile'
              ? exile
              : fromZone === 'graveyard'
                ? graveyard
                : fromZone === 'library'
                  ? library
                  : hand;
          const cardObj = sourceArr.find((c: any) => c && String(c.id) === String(cardId));
          if (cardObj) {
            (cardObj as any).squadTimesPaid = pendingSquadTimesPaid;
            (cardObj as any).additionalCostPaid = true;
          }
        } catch (e) {
          debugWarn(1, '[completeCastSpell] Failed to apply squad metadata:', e);
        }
      }

      if ('selectedModes' in pendingCast || 'selectedAdditionalCostModes' in pendingCast || 'selectedSpreeModes' in pendingCast || 'entwineCost' in pendingCast || 'castWithEntwine' in pendingCast) {
        try {
          const zones = (game.state as any)?.zones?.[playerId];
          const fromZone = normalizeSpellCastSourceZone(pendingCast?.fromZone) || 'hand';
          const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
          const exile: any[] = Array.isArray((zones as any)?.exile) ? (zones as any).exile : [];
          const graveyard: any[] = Array.isArray((zones as any)?.graveyard) ? (zones as any).graveyard : [];
          const library: any[] = Array.isArray((game.libraries as any)?.get?.(playerId))
            ? (game.libraries as any).get(playerId)
            : (Array.isArray((game.libraries as any)?.[playerId]) ? (game.libraries as any)[playerId] : []);
          const sourceArr = fromZone === 'command'
            ? getPlayerCommandZoneCards(game, String(playerId))
            : fromZone === 'exile'
              ? exile
              : fromZone === 'graveyard'
                ? graveyard
                : fromZone === 'library'
                  ? library
                  : hand;
          const cardObj = sourceArr.find((c: any) => c && String(c.id) === String(cardId));
          if (cardObj) {
            if (Array.isArray(pendingCast?.selectedModes)) {
              (cardObj as any).selectedModes = [...pendingCast.selectedModes];
            }
            if (Array.isArray(pendingCast?.selectedAdditionalCostModes)) {
              (cardObj as any).selectedAdditionalCostModes = [...pendingCast.selectedAdditionalCostModes];
            }
            if (Array.isArray(pendingCast?.selectedSpreeModes)) {
              (cardObj as any).selectedSpreeModes = [...pendingCast.selectedSpreeModes];
            }
            if (pendingCast?.castWithEntwine === true) {
              (cardObj as any).castWithEntwine = true;
              (cardObj as any).entwineCost = String(pendingCast?.entwineCost || '');
            }
          }
        } catch (e) {
          debugWarn(1, '[completeCastSpell] Failed to apply modal metadata:', e);
        }
      }
      
      // CRITICAL FIX: Always prefer pending targets over client-sent targets
      // This prevents the infinite targeting loop when client doesn't send targets back
      if (pendingCast.targets && pendingCast.targets.length > 0) {
        finalTargets = pendingCast.targets;
        debug(1, `[completeCastSpell] Using pending targets from server: ${finalTargets.join(',')}`);
      } else if (!finalTargets || finalTargets.length === 0) {
        // Fallback: use client-sent targets if no pending targets
        finalTargets = (targets as any[] | undefined) || [];
        debug(1, `[completeCastSpell] Using client-sent targets: ${finalTargets?.join(',') || 'none'}`);
      }

      // Preserve additional-cost payment flag from requestCastSpell flow.
      if (finalTargets) {
        (finalTargets as any).additionalCostPaid = pendingCast.additionalCostPaid === true;
        (finalTargets as any).additionalCostMethod = pendingCast.additionalCostMethod;
        if (pendingTargetGrouping) {
          (finalTargets as any).targetGrouping = pendingTargetGrouping;
        }
      }
      
      // CRITICAL FIX: Validate that spell has required targets before allowing cast
      // Check if this spell requires targets based on validTargetIds
      const requiredTargets = pendingCast.validTargetIds && pendingCast.validTargetIds.length > 0;
      if (requiredTargets && (!finalTargets || finalTargets.length === 0)) {
        debugError(1, `[completeCastSpell] ERROR: Spell ${pendingCast.cardName} requires targets but none provided!`);
        debugError(1, `[completeCastSpell] validTargetIds: ${JSON.stringify(pendingCast.validTargetIds)}`);
        debugError(1, `[completeCastSpell] pendingCast.targets: ${JSON.stringify(pendingCast.targets)}`);
        debugError(1, `[completeCastSpell] client targets: ${JSON.stringify(targets)}`);
        
        // Clean up the pending cast
        delete (game.state as any).pendingSpellCasts[effectIdStr];
        
        socket.emit("error", {
          code: "MISSING_TARGETS",
          message: `${pendingCast.cardName} requires a target but none was provided. Please try casting again.`,
        });
        return;
      }
      }
    } else {
      debug(2, `[completeCastSpell] No pendingCast found for effectId: ${effectIdStr}`);
    }
    
    // CRITICAL FIX: Clean up pendingTargets to prevent game from being blocked.
    // Some older cast flows still populate pendingTargets before the queued completion path.
    if (effectIdStr && game.state.pendingTargets?.[effectIdStr]) {
      debug(2, `[completeCastSpell] Cleaning up pendingTargets for effectId: ${effectIdStr}`);
      delete game.state.pendingTargets[effectIdStr];
    }

    debug(1, `[completeCastSpell] Final targets to use: ${finalTargets?.join(',') || 'none'}`);
    debug(2, `[completeCastSpell] Calling handleCastSpellFromHand with skipInteractivePrompts=true`);
    debug(2, `[completeCastSpell] DEBUG END ==========================================`);

    markPlayerCompletingSpellCast(game, playerId, cardId, effectIdStr);
    try {
    // CRITICAL FIX: Pass skipInteractivePrompts=true to prevent infinite targeting loop
    // This tells handleCastSpellFromHand to skip all target/payment requests since we're completing a previous cast
    await handleCastSpellFromHand({
      gameId,
      cardId,
      faceIndex: faceIndex ?? pendingFaceIndex,
      targets: finalTargets,
      payment: payment as PaymentItem[] | undefined,
      skipInteractivePrompts: true,
      skipPriorityCheck: true,
      xValue: (xValue as number | undefined) ?? pendingXValue,
      timesKicked: pendingTimesKicked,
      replicateCount: pendingReplicateCount,
      alternateCostId: (alternateCostId as string | undefined) ?? pendingAlternateCostId,
      convokeTappedCreatures: convokeTapped,
      harmonizeTappedCreatureId: harmonizeTappedCreatureId as string | undefined,
      sneakReturnedCreatureId: sneakReturnedCreatureId as string | undefined,
      webSlingingReturnedCreatureId: webSlingingReturnedCreatureId as string | undefined,
      fromZone: pendingFromZone,
      bypassExilePermissionCheck: pendingBypassExilePermissionCheck,
      ignoreTimingRestrictions: pendingIgnoreTimingRestrictions,
      allowLibrarySearchCast: Boolean(suspendedLibrarySearchStep),
    });

    } finally {
      clearPlayerCompletingSpellCast(game, playerId, cardId);
      // Keep pendingSpellCasts on failure so the payment-resume path can re-queue payment
      // instead of reporting "cast did not complete" with a cleared pending cast.
      if (effectIdStr && (game.state as any).pendingSpellCasts?.[effectIdStr]) {
        const castFinished = isSpellAlreadyOnStackForPlayer(game, playerId, cardId)
          || !(Array.isArray(game.state?.zones?.[playerId]?.hand)
            && game.state.zones[playerId].hand.some((card: any) => String(card?.id || '') === String(cardId)));
        if (castFinished) {
          delete (game.state as any).pendingSpellCasts[effectIdStr];
        }
      }
    }

    if (suspendedLibrarySearchStep) {
      await restoreSuspendedLibrarySearchStep(io, socket, gameId, suspendedLibrarySearchStep);
    }

    if (deferredMadnessPromptStepsAfterCast.length > 0) {
      const playerZones = (game.state as any)?.zones?.[playerId];
      const handCards: any[] = Array.isArray(playerZones?.hand) ? playerZones.hand : [];
      const spellStillInHand = handCards.some((card: any) => String(card?.id || '') === String(cardId));

      if (!spellStillInHand) {
        const queue = ResolutionQueueManager.getQueue(gameId) as any;
        const queuedMadnessSteps: any[] = [];

        for (const deferredStep of deferredMadnessPromptStepsAfterCast) {
          const deferredStepId = String((deferredStep as any)?.id || '').trim();
          const alreadyPresent = Boolean(
            (queue?.activeStep && String((queue.activeStep as any)?.id || '') === deferredStepId) ||
            (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === deferredStepId))
          );
          if (alreadyPresent) {
            continue;
          }

          queuedMadnessSteps.push(ResolutionQueueManager.addStep(gameId, {
            ...(deferredStep as any),
          } as any));
        }

        if (queuedMadnessSteps.length > 0) {
          try {
            appendEvent(gameId, (game as any).seq ?? 0, 'resolveTopOfStackPrompt', {
              playerId,
              sourceId: String(cardId),
              queuedResolutionSteps: queuedMadnessSteps.map((queuedStep: any) => ({ ...(queuedStep as any) })),
            });
          } catch (err) {
            debugWarn(1, '[completeCastSpell] appendEvent(resolveTopOfStackPrompt) failed:', err);
          }

          if (typeof (game as any).bumpSeq === 'function') {
            (game as any).bumpSeq();
          }
          broadcastGame(io, game, gameId);
        }
      }
    }
    
  } catch (err: any) {
    debugError(1, `[completeCastSpell] Error:`, err);
    socket.emit("error", {
      code: "COMPLETE_CAST_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

