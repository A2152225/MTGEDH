// server/src/state/modules/apply-event-handlers/applyEventCastSpellEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: The castSpell event: cost payment, alternative costs, and stack item construction.
// Public entry: applyCastSpellEvents(ctx, e) -> true when it handled the event.
//
// Handles: castSpell
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { movePermanentToHand } from "../zones";
import { cleanupCardLeavingExile } from "../playable-from-exile";
import { clearPreparedPermanent } from "../prepared.js";
import { castSpell } from "../stackCastSpellUtils.js";
import { getMatchingGraveyardCastingPermission } from "../graveyard-permissions.js";
import {
  getDurableCommandZonePermissionForCard,
  getDurableLibraryPermissionForCard,
  getDurablePlayableFromExilePermissionForCard,
} from "../durable-permissions.js";
import { resolveCastPermissionId, resolveDurablePermissionForCastReplay } from "../castIntent.js";
import {
  resolveReplayCommanderCard,
  getReplayLibraryForPlayer,
  resolveReplayCardForPermissionUse,
  recordReplayDurablePermissionUse,
  clearReplayQueuedSteps,
  recordGraveyardPermanentTypesCastThisTurn,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import { applyReplaySacrificedPermanent } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { getOrInitManaPool } from "../../../socket/util.js";

export function applyCastSpellEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "castSpell": {
        // Turn-tracking: "a spell was warped this turn" (702.185c) means it was cast for its warp cost.
        // Persisted events may include alternateCostId; older streams may only have it on the card object.
        try {
          const pid = String((e as any).playerId || '');
          const alt =
            (e as any).alternateCostId ??
            (e as any).alternate_cost_id ??
            (e as any).card?.alternateCostId ??
            (e as any).card?.card?.alternateCostId;
          const altLower = String(alt || '').toLowerCase().trim();
          if (pid && altLower === 'warp') {
            const stateAny = (ctx.state as any) as any;
            stateAny.spellWasWarpedThisTurn = stateAny.spellWasWarpedThisTurn || {};
            stateAny.spellWasWarpedThisTurn[pid] = true;
          }
        } catch {
          // best-effort only
        }

        // Turn-tracking: persisted castSpell events can carry `fromZone`.
        // Use this as authoritative positive evidence during replay.
        try {
          const pid = String((e as any).playerId || '').trim();
          const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
          if (pid && fromZone === 'graveyard') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromGraveyardThisTurn = stateAny.castFromGraveyardThisTurn || {};
            stateAny.castFromGraveyardThisTurn[pid] = true;
            recordGraveyardPermanentTypesCastThisTurn(stateAny, pid, (e as any).card);
          }
          if (pid && fromZone === 'exile') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromExileThisTurn = stateAny.castFromExileThisTurn || {};
            stateAny.castFromExileThisTurn[pid] = true;
          }
          if (pid && fromZone === 'library') {
            const stateAny = (ctx.state as any) as any;
            stateAny.castFromLibraryThisTurn = stateAny.castFromLibraryThisTurn || {};
            stateAny.castFromLibraryThisTurn[pid] = true;
          }
        } catch {
          // best-effort only
        }

        try {
          const tappedPermanents = Array.isArray((e as any).tappedPermanents)
            ? ((e as any).tappedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
            : [];
          if (tappedPermanents.length > 0) {
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            for (const permanentId of tappedPermanents) {
              const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
              if (permanent) {
                (permanent as any).tapped = true;
              }
            }
          }
        } catch {
          // best-effort only
        }

        try {
          const sacrificedPermanents = Array.isArray((e as any).sacrificedPermanents)
            ? ((e as any).sacrificedPermanents as any[]).map((id: any) => String(id)).filter(Boolean)
            : [];
          for (const permanentId of sacrificedPermanents) {
            applyReplaySacrificedPermanent(ctx, permanentId);
          }
        } catch {
          // best-effort only
        }

        try {
          const playerId = String((e as any).playerId || '').trim();
          const manaDelta = (e as any).paymentManaDelta;
          if (playerId && manaDelta && typeof manaDelta === 'object' && !Array.isArray(manaDelta)) {
            const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
            for (const [poolKey, rawAmount] of Object.entries(manaDelta as Record<string, unknown>)) {
              const amount = Number(rawAmount || 0);
              if (!Number.isFinite(amount) || amount === 0) continue;
              pool[poolKey] = Number(pool[poolKey] || 0) + amount;
            }
          }
        } catch {
          // best-effort only
        }

        // Web-slinging's return-to-hand is a nonmana cost paid before the spell
        // reaches the stack. Persisted casts carry the exact permanent ID so a
        // restart/undo never needs to infer a fresh legal selection.
        try {
          const alternateCostId = String((e as any).alternateCostId || '').trim().toLowerCase();
          const returnedCreatureId = String(
            (e as any).webSlingingReturnedCreatureId
            || (e as any).card?.webSlingingReturnedCreatureId
            || '',
          ).trim();
          if (alternateCostId === 'web_slinging' && returnedCreatureId) {
            const stillOnBattlefield = (ctx.state.battlefield || []).some(
              (permanent: any) => String(permanent?.id || '') === returnedCreatureId,
            );
            if (stillOnBattlefield) {
              movePermanentToHand(ctx as any, returnedCreatureId);
            }
          }
        } catch {
          // The cast event remains replayable even if an older stream omitted
          // the selected permanent or an intervening effect already moved it.
        }

        const stackLengthBefore = ctx.state.stack?.length || 0;

        // Prefer full card object for replay (contains all card data)
        // Fall back to cardId for backward compatibility with old events
        const fromZone = String((e as any).fromZone || '').toLowerCase().trim();
        let spellCardData = (e as any).card || (e as any).cardId;
        if (fromZone === 'command' && typeof spellCardData === 'string') {
          const commanderCard = resolveReplayCommanderCard(ctx as any, e, String(spellCardData));
          if (commanderCard) {
            spellCardData = commanderCard;
          }
        }
        if ((fromZone === 'library' || fromZone === 'graveyard' || fromZone === 'exile') && typeof spellCardData === 'string') {
          const replayCard = resolveReplayCardForPermissionUse(ctx as any, e, fromZone, spellCardData);
          if (replayCard && typeof replayCard === 'object') {
            spellCardData = replayCard;
          }
        }
        if (fromZone === 'library' && typeof spellCardData === 'string') {
          const library = getReplayLibraryForPlayer(ctx as any, String((e as any).playerId || '').trim());
          const libraryCard = library.find((card: any) => String(card?.id || '') === String(spellCardData));
          if (libraryCard) {
            spellCardData = libraryCard;
          }
        }

        const playerIdForDurablePermissionUse = String((e as any).playerId || '').trim();
        const cardForDurablePermissionUse = typeof spellCardData === 'object' && spellCardData
          ? spellCardData
          : { id: spellCardData };
        const durablePermissionToRecord = playerIdForDurablePermissionUse
          ? resolveDurablePermissionForCastReplay(
            ctx.state as any,
            e as any,
            fromZone === 'library'
              ? getDurableLibraryPermissionForCard(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
              : fromZone === 'command'
                ? getDurableCommandZonePermissionForCard(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
                : fromZone === 'exile'
                  ? getDurablePlayableFromExilePermissionForCard(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
                  : fromZone === 'graveyard'
                    ? getMatchingGraveyardCastingPermission(ctx.state as any, playerIdForDurablePermissionUse as any, cardForDurablePermissionUse, 'cast')
                    : undefined,
          )
          : undefined;

        if (fromZone === 'library') {
          const library = getReplayLibraryForPlayer(ctx as any, String((e as any).playerId || '').trim());
          const spellCardId = String((spellCardData as any)?.id || (e as any).cardId || '').trim();
          const libraryIdx = library.findIndex((card: any) => String(card?.id || '') === spellCardId);
          if (libraryIdx !== -1) {
            const [removedCard] = library.splice(libraryIdx, 1);
            if (typeof spellCardData === 'string') {
              spellCardData = removedCard;
            }
          }
        }

        // Defensive replay hardening: if the persisted event indicates the spell
        // was cast from true exile, ensure any impulse-style tags/permissions are
        // cleaned up even if castSpell can't infer the source from current zones.
        try {
          if (fromZone === 'exile') {
            const cardObj = typeof spellCardData === 'string' ? { id: spellCardData } : spellCardData;
            const preparedSourcePermanentId = String((cardObj as any)?.preparedSourcePermanentId || '').trim();
            if (preparedSourcePermanentId) {
              const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
              const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === preparedSourcePermanentId);
              if (sourcePermanent) {
                clearPreparedPermanent((ctx.state as any) as any, sourcePermanent, {
                  preserveExileCardId: String((cardObj as any)?.id || '').trim(),
                });
              }
            }
            cleanupCardLeavingExile((ctx.state as any) as any, cardObj);
          }
        } catch {
          // best-effort only
        }
        castSpell(
          ctx as any,
          (e as any).playerId,
          typeof spellCardData === 'object' && spellCardData
            ? { ...spellCardData, ...(fromZone ? { fromZone } : {}) }
            : spellCardData,
          (e as any).targets,
          (e as any).xValue
        );

        try {
          const stackLengthAfter = ctx.state.stack?.length || 0;
          if (playerIdForDurablePermissionUse && stackLengthAfter > stackLengthBefore) {
            recordReplayDurablePermissionUse(ctx.state as any, durablePermissionToRecord);
          }
        } catch {
          // best-effort only
        }

        // Intervening-if support: persist replay-stable cast/payment metadata onto the new stack item.
        try {
          const stackArr = (ctx.state.stack || []) as any[];
          if (stackArr.length > stackLengthBefore && stackArr.length > 0) {
            const topStackItem = stackArr[stackArr.length - 1];
            const persistedStackItemId = String((e as any).stackItemId || '').trim();

            if (persistedStackItemId) {
              (topStackItem as any).id = persistedStackItemId;
            }

            const applyToStackItem = (key: string, value: any) => {
              (topStackItem as any)[key] = value;
              if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                (topStackItem as any).card[key] = value;
              }
            };

            if ((e as any).targetGrouping && typeof (e as any).targetGrouping === 'object') {
              applyToStackItem('targetGrouping', (e as any).targetGrouping);
            }

            // Provenance
            if (typeof (e as any).fromZone === 'string' && (e as any).fromZone) {
              const fromZone = String((e as any).fromZone);
              const fromZoneLower = fromZone.toLowerCase().trim();
              applyToStackItem('fromZone', fromZone);
              applyToStackItem('castSourceZone', fromZone);
              applyToStackItem('source', fromZone);

              if (fromZoneLower === 'hand') {
                applyToStackItem('castFromHand', true);
              }
              if (fromZoneLower === 'exile') {
                applyToStackItem('castFromExile', true);
              }
              if (fromZoneLower === 'graveyard') {
                applyToStackItem('castFromGraveyard', true);
              }
              if (fromZoneLower === 'command') {
                applyToStackItem('isCommander', true);
              }
            }
            if ((e as any).castFromHand === true) {
              applyToStackItem('castFromHand', true);
              applyToStackItem('source', 'hand');
              applyToStackItem('castSourceZone', 'hand');
            }
            if ((e as any).castWithoutPayingManaCost === true) {
              applyToStackItem('castWithoutPayingManaCost', true);
            }
            const graveyardPermissionId = resolveCastPermissionId(e as any);
            if (graveyardPermissionId) {
              applyToStackItem('graveyardPermissionId', graveyardPermissionId);
              applyToStackItem('castPermissionId', graveyardPermissionId);
            }
            const graveyardPermissionSourceName =
              (e as any).graveyardPermissionSourceName ??
              (e as any).card?.graveyardPermissionSourceName ??
              (e as any).card?.card?.graveyardPermissionSourceName;
            if (graveyardPermissionSourceName) {
              applyToStackItem('graveyardPermissionSourceName', String(graveyardPermissionSourceName));
            }
            const graveyardPermissionCostMode =
              (e as any).graveyardPermissionCostMode ??
              (e as any).card?.graveyardPermissionCostMode ??
              (e as any).card?.card?.graveyardPermissionCostMode;
            if (graveyardPermissionCostMode) {
              applyToStackItem('graveyardPermissionCostMode', String(graveyardPermissionCostMode));
              if (String(graveyardPermissionCostMode) === 'without_paying_mana_cost') {
                applyToStackItem('castWithoutPayingManaCost', true);
              }
            }
            if ((e as any).exileAfterResolution === true || (e as any).card?.exileAfterResolution === true || (e as any).card?.card?.exileAfterResolution === true) {
              applyToStackItem('exileAfterResolution', true);
            }
            const leaveBattlefieldReplacementDestination =
              (e as any).leaveBattlefieldReplacementDestination ??
              (e as any).card?.leaveBattlefieldReplacementDestination ??
              (e as any).card?.card?.leaveBattlefieldReplacementDestination;
            if (String(leaveBattlefieldReplacementDestination || '') === 'exile') {
              applyToStackItem('leaveBattlefieldReplacementDestination', 'exile');
            }
            const leaveBattlefieldReplacementSourceName =
              (e as any).leaveBattlefieldReplacementSourceName ??
              (e as any).card?.leaveBattlefieldReplacementSourceName ??
              (e as any).card?.card?.leaveBattlefieldReplacementSourceName;
            if (leaveBattlefieldReplacementSourceName) {
              applyToStackItem('leaveBattlefieldReplacementSourceName', String(leaveBattlefieldReplacementSourceName));
            }
            const leaveBattlefieldReplacementLifeGain = Number(
              (e as any).leaveBattlefieldReplacementLifeGain ??
              (e as any).card?.leaveBattlefieldReplacementLifeGain ??
              (e as any).card?.card?.leaveBattlefieldReplacementLifeGain ??
              0
            );
            if (leaveBattlefieldReplacementLifeGain > 0) {
              applyToStackItem('leaveBattlefieldReplacementLifeGain', leaveBattlefieldReplacementLifeGain);
            }
            if (typeof (e as any).faceIndex === 'number') {
              applyToStackItem('faceIndex', Number((e as any).faceIndex));
            }
            if (typeof (e as any).castAsAdventure === 'boolean') {
              applyToStackItem('castAsAdventure', (e as any).castAsAdventure);
            }
            if ((e as any).giftPromised === true) {
              applyToStackItem('giftPromised', true);
            }
            if (typeof (e as any).giftRecipient === 'string' && (e as any).giftRecipient) {
              applyToStackItem('giftRecipient', String((e as any).giftRecipient));
            }
            if (typeof (e as any).giftType === 'string' && (e as any).giftType) {
              applyToStackItem('giftType', String((e as any).giftType));
            }
            if (Array.isArray((e as any).copyRetargetValidTargets)) {
              applyToStackItem('copyRetargetValidTargets', (e as any).copyRetargetValidTargets.map((target: any) => (
                target && typeof target === 'object' && !Array.isArray(target)
                  ? { ...target }
                  : target
              )));
            }
            if (Array.isArray((e as any).copyRetargetTargetTypes)) {
              applyToStackItem('copyRetargetTargetTypes', (e as any).copyRetargetTargetTypes.slice());
            }
            if (typeof (e as any).copyRetargetMinTargets === 'number') {
              applyToStackItem('copyRetargetMinTargets', Number((e as any).copyRetargetMinTargets));
            }
            if (typeof (e as any).copyRetargetMaxTargets === 'number') {
              applyToStackItem('copyRetargetMaxTargets', Number((e as any).copyRetargetMaxTargets));
            }
            if (typeof (e as any).copyRetargetTargetDescription === 'string' && (e as any).copyRetargetTargetDescription) {
              applyToStackItem('copyRetargetTargetDescription', String((e as any).copyRetargetTargetDescription));
            }

            // Alternate-cost identifier
            const alt =
              (e as any).alternateCostId ??
              (e as any).alternate_cost_id ??
              (e as any).card?.alternateCostId ??
              (e as any).card?.card?.alternateCostId;
            if (alt) {
              applyToStackItem('alternateCostId', alt);
              const altLower = String(alt || '').toLowerCase().trim();
              // Best-effort boolean flags for common alternate cost templates.
              applyToStackItem('prowlCostWasPaid', altLower === 'prowl');
              applyToStackItem('surgeCostWasPaid', altLower === 'surge');
              applyToStackItem('madnessCostWasPaid', altLower === 'madness');
              applyToStackItem('spectacleCostWasPaid', altLower === 'spectacle');
              applyToStackItem('webSlingingCostWasPaid', altLower === 'web_slinging' || (e as any).webSlingingCostWasPaid === true);
              if (altLower === 'web_slinging' || (e as any).webSlingingCostWasPaid === true) {
                applyToStackItem('castUsingWebSlinging', true);
                const returnedId = String(
                  (e as any).webSlingingReturnedCreatureId
                  || (e as any).card?.webSlingingReturnedCreatureId
                  || '',
                ).trim();
                if (returnedId) applyToStackItem('webSlingingReturnedCreatureId', returnedId);
              }
            }

            // Mana/payment metadata
            if ((e as any).manaPayment && typeof (e as any).manaPayment === 'object') {
              const manaPayment = (e as any).manaPayment;
              applyToStackItem('manaPayment', Array.isArray(manaPayment) ? manaPayment.slice() : { ...manaPayment });
            }
            if (typeof (e as any).manaSpentTotal === 'number') {
              applyToStackItem('manaSpentTotal', (e as any).manaSpentTotal);
            }
            if ((e as any).manaSpentBreakdown && typeof (e as any).manaSpentBreakdown === 'object') {
              applyToStackItem('manaSpentBreakdown', { ...(e as any).manaSpentBreakdown });
            }
            if ((e as any).snowManaSpentByColor && typeof (e as any).snowManaSpentByColor === 'object') {
              applyToStackItem('snowManaSpentByColor', { ...(e as any).snowManaSpentByColor });
            }
            if (Array.isArray((e as any).snowManaColorsSpent)) {
              applyToStackItem('snowManaColorsSpent', (e as any).snowManaColorsSpent.slice());
            }
            if ((e as any).snowManaSpentKnown === true && typeof (e as any).snowManaSpent === 'boolean') {
              applyToStackItem('snowManaSpentKnown', true);
              applyToStackItem('snowManaSpent', (e as any).snowManaSpent);
            }
            if ((e as any).snowManaOfSpellColorsSpentKnown === true && typeof (e as any).snowManaOfSpellColorsSpent === 'boolean') {
              applyToStackItem('snowManaOfSpellColorsSpentKnown', true);
              applyToStackItem('snowManaOfSpellColorsSpent', (e as any).snowManaOfSpellColorsSpent);
            }
            if (typeof (e as any).convergeValue === 'number') {
              applyToStackItem('convergeValue', (e as any).convergeValue);
            }
            if (Array.isArray((e as any).manaSpentColors)) {
              applyToStackItem('manaSpentColors', (e as any).manaSpentColors.slice());
              applyToStackItem('manaColorsSpent', (e as any).manaSpentColors.slice());
            }
            if (Array.isArray((e as any).manaColorsSpent)) {
              applyToStackItem('manaColorsSpent', (e as any).manaColorsSpent.slice());
              if (!Array.isArray((e as any).manaSpentColors)) {
                applyToStackItem('manaSpentColors', (e as any).manaColorsSpent.slice());
              }
            }
            if (Array.isArray((e as any).convokeTappedCreatures)) {
              applyToStackItem('convokeTappedCreatures', (e as any).convokeTappedCreatures.slice());
            }
            if (typeof (e as any).manaFromCreaturesSpent === 'number') {
              applyToStackItem('manaFromCreaturesSpent', (e as any).manaFromCreaturesSpent);
            }
            if ((e as any).cantBeCountered === true) {
              applyToStackItem('cantBeCountered', true);
            }
            if (Array.isArray((e as any).cantBeCounteredBySourceColors)) {
              applyToStackItem('cantBeCounteredBySourceColors', (e as any).cantBeCounteredBySourceColors.slice());
            }
            const rawCounterImmunity = (e as any).counterImmunity;
            if (rawCounterImmunity !== undefined) {
              if (rawCounterImmunity === true) {
                applyToStackItem('counterImmunity', { unconditional: true });
                applyToStackItem('cantBeCountered', true);
              } else if (Array.isArray(rawCounterImmunity)) {
                applyToStackItem('counterImmunity', rawCounterImmunity.slice());
              } else if (rawCounterImmunity && typeof rawCounterImmunity === 'object') {
                applyToStackItem('counterImmunity', { ...rawCounterImmunity });
                if ((rawCounterImmunity as any).unconditional === true || (rawCounterImmunity as any).cantBeCountered === true) {
                  applyToStackItem('cantBeCountered', true);
                }
                const sourceColors =
                  (rawCounterImmunity as any).counterSourceColors ??
                  (rawCounterImmunity as any).sourceColors ??
                  (rawCounterImmunity as any).onlyAgainstSourceColors ??
                  (rawCounterImmunity as any).cantBeCounteredBySourceColors;
                if (!Array.isArray((e as any).cantBeCounteredBySourceColors) && Array.isArray(sourceColors)) {
                  applyToStackItem('cantBeCounteredBySourceColors', sourceColors.slice());
                }
              }
            }
            if ((e as any).entersBattlefieldWithCounters && typeof (e as any).entersBattlefieldWithCounters === 'object') {
              applyToStackItem('entersBattlefieldWithCounters', { ...(e as any).entersBattlefieldWithCounters });
            } else if (
              (e as any).card?.entersBattlefieldWithCounters
              && typeof (e as any).card.entersBattlefieldWithCounters === 'object'
            ) {
              applyToStackItem('entersBattlefieldWithCounters', { ...(e as any).card.entersBattlefieldWithCounters });
            }
            const timesKickedRaw = (e as any).timesKicked ?? (e as any).kickerPaidCount ?? (e as any).card?.timesKicked ?? (e as any).card?.kickerPaidCount;
            const timesKicked = Number.isFinite(Number(timesKickedRaw)) ? Math.max(0, Math.floor(Number(timesKickedRaw))) : undefined;
            if (timesKicked != null && timesKicked > 0) {
              applyToStackItem('timesKicked', timesKicked);
              applyToStackItem('kickerPaidCount', timesKicked);
              applyToStackItem('wasKicked', true);
            } else if ((e as any).wasKicked === true || (e as any).card?.wasKicked === true) {
              applyToStackItem('wasKicked', true);
            }
            if ((e as any).gainsHasteUntilEndOfTurnFromManaSpent === true) {
              applyToStackItem('gainsHasteUntilEndOfTurnFromManaSpent', true);
            }

            // Positive-only evidence flags
            if ((e as any).manaFromTreasureSpent === true) {
              applyToStackItem('manaFromTreasureSpent', true);
            }
            if ((e as any).manaFromTreasureSpentKnown === true && typeof (e as any).manaFromTreasureSpent === 'boolean') {
              applyToStackItem('manaFromTreasureSpentKnown', true);
              applyToStackItem('manaFromTreasureSpent', (e as any).manaFromTreasureSpent);
            }
            // Additional cost payment metadata (deterministic when explicitly known).
            if ((e as any).additionalCostPaidKnown === true && typeof (e as any).additionalCostPaid === 'boolean') {
              const v = (e as any).additionalCostPaid;
              applyToStackItem('additionalCostPaidKnown', true);
              applyToStackItem('additionalCostPaid', v);
              // Keep legacy aliases in sync.
              applyToStackItem('additionalCostWasPaid', v);
              applyToStackItem('paidAdditionalCost', v);
            } else if ((e as any).additionalCostWasPaid === true || (e as any).paidAdditionalCost === true || (e as any).additionalCostPaid === true) {
              // Positive-only evidence.
              applyToStackItem('additionalCostWasPaid', true);
              applyToStackItem('paidAdditionalCost', true);
              applyToStackItem('additionalCostPaid', true);
            }
            if ((e as any).evidenceCollected === true || (e as any).evidenceWasCollected === true || (e as any).collectedEvidence === true) {
              applyToStackItem('evidenceCollected', true);
              applyToStackItem('evidenceWasCollected', true);
              applyToStackItem('collectedEvidence', true);
            }

            // Bargain (explicit, replay-stable boolean if present)
            const rawWasBargained =
              (e as any).wasBargained ??
              (e as any).bargained ??
              (e as any).card?.wasBargained ??
              (e as any).card?.card?.wasBargained;
            if (typeof rawWasBargained === 'boolean') {
              applyToStackItem('wasBargained', rawWasBargained);
              if ((e as any).bargainResolved === true) {
                applyToStackItem('bargainResolved', true);
              }
            }

            const rawTeamworkWasPaid =
              (e as any).teamworkWasPaid ??
              (e as any).card?.teamworkWasPaid ??
              (e as any).card?.card?.teamworkWasPaid;
            if (typeof rawTeamworkWasPaid === 'boolean') {
              applyToStackItem('teamworkWasPaid', rawTeamworkWasPaid);
              if ((e as any).teamworkResolved === true) {
                applyToStackItem('teamworkResolved', true);
              }
            }
          }
        } catch {
          // best-effort only
        }

        try {
          const stateAny = (ctx.state as any) as any;
          const delayedEntries = Array.isArray(stateAny.delayedSpellCopiesThisTurn)
            ? stateAny.delayedSpellCopiesThisTurn
            : [];
          const playerId = String((e as any).playerId || '').trim();
          const spellTypeLine = String((spellCardData as any)?.type_line || (e as any)?.card?.type_line || '').toLowerCase();
          if (
            delayedEntries.length > 0
            && playerId
            && (spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery'))
          ) {
            stateAny.delayedSpellCopiesThisTurn = delayedEntries.filter((entry: any) => !(
              String(entry?.controllerId || '').trim() === playerId
              && String(entry?.spellType || '').trim() === 'instant_or_sorcery'
            ));
          }
        } catch {
          // best-effort only
        }

        // Replay: once castSpell is applied, drop any pre-cast payment/target prompts and
        // pendingSpellCasts for this card so restore/undo does not re-ask for mana.
        try {
          const replayGameId = String((ctx as any).gameId || '').trim();
          const castCardId = String(
            (typeof spellCardData === 'object' && spellCardData ? (spellCardData as any).id : '')
            || (e as any).cardId
            || '',
          ).trim();
          const effectIdFromEvent = String((e as any).effectId || '').trim();
          const pending = (ctx.state as any)?.pendingSpellCasts;
          if (pending && typeof pending === 'object') {
            for (const [eid, cast] of Object.entries(pending)) {
              const castCard = String((cast as any)?.cardId || '').trim();
              if (
                (effectIdFromEvent && String(eid) === effectIdFromEvent)
                || (castCardId && castCard === castCardId)
              ) {
                delete pending[eid];
              }
            }
          }
          if (replayGameId && (castCardId || effectIdFromEvent)) {
            clearReplayQueuedSteps(replayGameId, (step: any) => {
              if (!step) return false;
              const stepEffectId = String(step?.effectId || step?.spellCastContext?.effectId || '').trim();
              const stepCardId = String(
                step?.cardId || step?.spellCastContext?.cardId || step?.sourceId || '',
              ).trim();
              if (effectIdFromEvent && stepEffectId === effectIdFromEvent) return true;
              if (!castCardId || stepCardId !== castCardId) return false;
              const stepType = String(step?.type || '');
              return (
                step?.spellPaymentRequired === true
                || stepType === 'mana_payment_choice'
                || stepType === 'target_selection'
                || stepType === 'mode_selection'
                || stepType === 'additional_cost_payment'
                || stepType === 'x_value_selection'
                || stepType === 'mutate_target_selection'
                || stepType === 'option_choice'
              );
            });
          }
        } catch {
          // best-effort only
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
