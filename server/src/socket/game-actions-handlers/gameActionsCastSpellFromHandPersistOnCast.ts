/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand persist of appendEvent(castSpell)
 * plus on-cast trigger glue (self on-cast, processSpellCastTriggersForCast,
 * heroic, opponent-cast triggers) and pending cascade/scry/etc. after the
 * spell is on the stack (CR 601.2i).
 *
 * Public entry symbols: persistAndProcessCastSpellFromHand.
 */
import type { Server } from "socket.io";
import { formatCastSpellMessage } from "../../../../shared/src/gameLogFormat.js";
import { appendEvent } from "../../db";
import { buildPersistedCastPermissionFields, buildPersistedFreeCastIntentFields, buildPersistedWebSlingingCastIntentFields } from "../../state/modules/castIntent.js";
import { inferTriggeredAbilityTargetMetadata } from "../../state/modules/inferTriggeredAbilityTargetMetadata.js";
import { isOnCastReflexiveCostGateEffect, resolveOnCastSpellTriggerDescriptions } from "../../state/modules/onCastSpellTriggerUtils.js";
import { isInterveningIfSatisfied } from "../../state/modules/triggers/intervening-if";
import { getOpponentSpellCastTriggers } from "../../state/modules/triggers/index.js";
import { orderTriggersByAPNAP } from "../../state/modules/triggers/ordering.js";
import { uid } from "../../state/utils";
import { debug, debugWarn } from "../../utils/debug.js";
import {
  completeDanceWithCalamityDeferredAdvance,
  processPendingBottomOrder,
  processPendingCascades,
  processPendingDanceWithCalamity,
  processPendingLimDulsVault,
  processPendingOracleIrCompoundResume,
  processPendingPonder,
  processPendingProliferate,
  processPendingScry,
  processPendingSurveil,
} from "../resolution.js";
import { broadcastGame, getPlayerName } from "../util";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { recordSpellCastThisTurn } from "./gameActionsSpellCastTriggerDetection.js";
import { processSpellCastTriggersForCast } from "./gameActionsSpellCastTriggerProcessing.js";
import { findTriggeringSpellOnStack } from "../../state/modules/triggerCastSpellStackBinding.js";
import {
  applyHeroicTrigger,
  consumeDelayedSpellCopiesForCast,
  getHeroicTriggers,
} from "./gameActionsSpellCopyHeroicTriggers.js";

export type PersistAndProcessCastSpellFromHandArgs = {
  io: Server;
  game: any;
  gameId: string;
  playerId: string;
  cardId: string;
  cardInHand: any;
  targets: any;
  xValue: number | undefined;
  selectedFaceIndex: number | undefined;
  castAsAdventure: boolean | undefined;
  alternateCostId: string | undefined;
  castSourceZone: SpellCastSourceZone;
  giftPromisedForCast: boolean;
  manaSpentTotal: number;
  manaConsumption: any;
  bargainResolved: boolean;
  wasBargained: boolean;
  convergeValue: number;
  tappedPaymentPermanents: Set<string>;
  persistedSacrificedPermanentFields: any;
  convokeTappedCreatures: string[] | undefined;
  additionalCost: any;
  additionalCostPaid: boolean | undefined;
  evidenceCollected: boolean;
  manaFromTreasureSpent: true | undefined;
  paymentManaDelta: any;
  delayedSpellCopiesSnapshot: any[];
};

export async function persistAndProcessCastSpellFromHand(
  args: PersistAndProcessCastSpellFromHandArgs,
): Promise<void> {
  const {
    io,
    game,
    gameId,
    playerId,
    cardId,
    cardInHand,
    targets,
    xValue,
    selectedFaceIndex,
    castAsAdventure,
    alternateCostId,
    castSourceZone,
    giftPromisedForCast,
    manaSpentTotal,
    manaConsumption,
    bargainResolved,
    wasBargained,
    convergeValue,
    tappedPaymentPermanents,
    persistedSacrificedPermanentFields,
    convokeTappedCreatures,
    additionalCost,
    additionalCostPaid,
    evidenceCollected,
    manaFromTreasureSpent,
    paymentManaDelta,
    delayedSpellCopiesSnapshot,
  } = args;

      // Persist the event to DB with full card data for reliable replay after server restart
      try {
        const persistedCastStackItem = Array.isArray(game.state.stack) && game.state.stack.length > 0
          ? game.state.stack[game.state.stack.length - 1]
          : undefined;
        if (persistedCastStackItem && (targets as any)?.targetGrouping) {
          (persistedCastStackItem as any).targetGrouping = (targets as any).targetGrouping;
        }
        const persistedCastMetadata = (() => {
          const stackItem: any = persistedCastStackItem;
          if (!stackItem) return {};

          const manaPayment = stackItem.manaPayment ?? stackItem.card?.manaPayment;
          const manaSpentColors = Array.isArray(stackItem.manaSpentColors)
            ? stackItem.manaSpentColors.slice()
            : (Array.isArray(stackItem.card?.manaSpentColors) ? stackItem.card.manaSpentColors.slice() : undefined);
          const manaColorsSpent = Array.isArray(stackItem.manaColorsSpent)
            ? stackItem.manaColorsSpent.slice()
            : (Array.isArray(stackItem.card?.manaColorsSpent) ? stackItem.card.manaColorsSpent.slice() : undefined);
          const cantBeCounteredBySourceColors = Array.isArray(stackItem.cantBeCounteredBySourceColors)
            ? stackItem.cantBeCounteredBySourceColors.slice()
            : (Array.isArray(stackItem.card?.cantBeCounteredBySourceColors)
              ? stackItem.card.cantBeCounteredBySourceColors.slice()
              : undefined);
          const counterImmunity = stackItem.counterImmunity ?? stackItem.card?.counterImmunity;
          const entersBattlefieldWithCounters =
            stackItem.entersBattlefieldWithCounters ?? stackItem.card?.entersBattlefieldWithCounters;
          const gainsHasteUntilEndOfTurnFromManaSpent =
            stackItem.gainsHasteUntilEndOfTurnFromManaSpent === true
              || stackItem.card?.gainsHasteUntilEndOfTurnFromManaSpent === true;
          const copyRetargetValidTargets = Array.isArray(stackItem.copyRetargetValidTargets)
            ? stackItem.copyRetargetValidTargets.map((target: any) => (
                target && typeof target === 'object' && !Array.isArray(target)
                  ? { ...target }
                  : target
              ))
            : (Array.isArray(stackItem.card?.copyRetargetValidTargets)
              ? stackItem.card.copyRetargetValidTargets.map((target: any) => (
                  target && typeof target === 'object' && !Array.isArray(target)
                    ? { ...target }
                    : target
                ))
              : undefined);
          const copyRetargetTargetTypes = Array.isArray(stackItem.copyRetargetTargetTypes)
            ? stackItem.copyRetargetTargetTypes.slice()
            : (Array.isArray(stackItem.card?.copyRetargetTargetTypes)
              ? stackItem.card.copyRetargetTargetTypes.slice()
              : undefined);
          const copyRetargetMinTargets = Number(stackItem.copyRetargetMinTargets ?? stackItem.card?.copyRetargetMinTargets ?? NaN);
          const copyRetargetMaxTargets = Number(stackItem.copyRetargetMaxTargets ?? stackItem.card?.copyRetargetMaxTargets ?? NaN);
          const copyRetargetTargetDescription = String(stackItem.copyRetargetTargetDescription ?? stackItem.card?.copyRetargetTargetDescription ?? '').trim();

          return {
            ...(manaPayment && typeof manaPayment === 'object'
              ? { manaPayment: Array.isArray(manaPayment) ? manaPayment.slice() : { ...manaPayment } }
              : {}),
            ...(manaSpentColors && manaSpentColors.length > 0 ? { manaSpentColors } : {}),
            ...(manaColorsSpent && manaColorsSpent.length > 0 ? { manaColorsSpent } : {}),
            ...(gainsHasteUntilEndOfTurnFromManaSpent ? { gainsHasteUntilEndOfTurnFromManaSpent: true } : {}),
            ...(stackItem.cantBeCountered === true || stackItem.card?.cantBeCountered === true
              ? { cantBeCountered: true }
              : {}),
            ...(cantBeCounteredBySourceColors && cantBeCounteredBySourceColors.length > 0
              ? { cantBeCounteredBySourceColors }
              : {}),
            ...(counterImmunity === true
              ? { counterImmunity: true }
              : (counterImmunity && typeof counterImmunity === 'object'
                ? { counterImmunity: Array.isArray(counterImmunity) ? counterImmunity.slice() : { ...counterImmunity } }
                : {})),
            ...(entersBattlefieldWithCounters && typeof entersBattlefieldWithCounters === 'object'
              ? { entersBattlefieldWithCounters: { ...entersBattlefieldWithCounters } }
              : {}),
            ...(copyRetargetValidTargets && copyRetargetValidTargets.length > 0
              ? { copyRetargetValidTargets }
              : {}),
            ...(copyRetargetTargetTypes && copyRetargetTargetTypes.length > 0
              ? { copyRetargetTargetTypes }
              : {}),
            ...(Number.isFinite(copyRetargetMinTargets)
              ? { copyRetargetMinTargets }
              : {}),
            ...(Number.isFinite(copyRetargetMaxTargets)
              ? { copyRetargetMaxTargets }
              : {}),
            ...(copyRetargetTargetDescription
              ? { copyRetargetTargetDescription }
              : {}),
          };
        })();
        appendEvent(gameId, (game as any).seq ?? 0, "castSpell", { 
          playerId, 
          cardId, 
          targets,
          ...((targets as any)?.targetGrouping ? { targetGrouping: (targets as any).targetGrouping } : {}),
          ...(persistedCastStackItem?.id ? { stackItemId: String(persistedCastStackItem.id) } : {}),
          // Include full card data for replay to work correctly after server restart
          card: { ...cardInHand, ...(castSourceZone === 'command' ? { isCommander: true } : {}) },
          xValue,
          ...(typeof selectedFaceIndex === 'number' ? { faceIndex: selectedFaceIndex } : {}),
          ...(typeof castAsAdventure === 'boolean' ? { castAsAdventure } : {}),
          alternateCostId,
          ...buildPersistedWebSlingingCastIntentFields(cardInHand as any, alternateCostId),
          fromZone: castSourceZone,
          castFromHand: castSourceZone === 'hand',
          ...buildPersistedFreeCastIntentFields(cardInHand as any, alternateCostId),
          ...buildPersistedCastPermissionFields(cardInHand as any),
          ...(typeof (cardInHand as any).graveyardPermissionSourceName === 'string' && (cardInHand as any).graveyardPermissionSourceName
            ? { graveyardPermissionSourceName: String((cardInHand as any).graveyardPermissionSourceName) }
            : {}),
          ...(typeof (cardInHand as any).graveyardPermissionCostMode === 'string' && (cardInHand as any).graveyardPermissionCostMode
            ? { graveyardPermissionCostMode: String((cardInHand as any).graveyardPermissionCostMode) }
            : {}),
          ...((cardInHand as any).exileAfterResolution === true ? { exileAfterResolution: true } : {}),
          ...(String((cardInHand as any).leaveBattlefieldReplacementDestination || '') === 'exile'
            ? { leaveBattlefieldReplacementDestination: 'exile' }
            : {}),
          ...(typeof (cardInHand as any).leaveBattlefieldReplacementSourceName === 'string' && (cardInHand as any).leaveBattlefieldReplacementSourceName
            ? { leaveBattlefieldReplacementSourceName: String((cardInHand as any).leaveBattlefieldReplacementSourceName) }
            : {}),
          ...(typeof (cardInHand as any).leaveBattlefieldReplacementLifeGain === 'number' && (cardInHand as any).leaveBattlefieldReplacementLifeGain > 0
            ? { leaveBattlefieldReplacementLifeGain: Number((cardInHand as any).leaveBattlefieldReplacementLifeGain) }
            : {}),
          ...(giftPromisedForCast === true
            ? {
                giftPromised: true,
                giftRecipient: String((cardInHand as any).giftRecipient || '') || undefined,
                giftType: String((cardInHand as any).giftType || '') || undefined,
              }
            : {}),
          // Persist mana/payment metadata for deterministic replay / intervening-if.
          manaSpentTotal,
          manaSpentBreakdown: { ...manaConsumption.consumed },
          ...(bargainResolved === true && typeof wasBargained === 'boolean'
            ? {
                bargainResolved: true,
                wasBargained,
              }
            : {}),
          ...(convergeValue > 0
            ? {
                convergeValue,
                manaColorsSpent: Object.entries(manaConsumption.consumed as Record<string, number>)
                  .filter(([color, amount]) => color !== 'colorless' && Number(amount) > 0)
                  .map(([color]) => color),
              }
            : {}),
          ...(tappedPaymentPermanents.size > 0
            ? {
                tappedPermanents: Array.from(tappedPaymentPermanents),
              }
            : {}),
          ...persistedSacrificedPermanentFields,
          ...(Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0
            ? {
                convokeTappedCreatures: convokeTappedCreatures.slice(),
                manaFromCreaturesSpent: convokeTappedCreatures.length,
              }
            : {}),
          ...(additionalCost && typeof additionalCostPaid === 'boolean'
            ? {
                additionalCostPaidKnown: true,
                additionalCostPaid: additionalCostPaid === true,
                ...(additionalCostPaid === true
                  ? {
                      additionalCostWasPaid: true,
                      paidAdditionalCost: true,
                    }
                  : {}),
              }
            : additionalCostPaid === true
              ? {
                  additionalCostWasPaid: true,
                  paidAdditionalCost: true,
                  additionalCostPaid: true,
                }
              : {}),
          ...(evidenceCollected === true
            ? {
                evidenceCollected: true,
                evidenceWasCollected: true,
                collectedEvidence: true,
              }
            : {}),
          ...(manaFromTreasureSpent === true ? { manaFromTreasureSpent: true } : {}),
          ...(paymentManaDelta ? { paymentManaDelta } : {}),
          ...persistedCastMetadata,
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(castSpell) failed:', e);
      }

      if (castSourceZone === 'exile') {
        try {
          completeDanceWithCalamityDeferredAdvance(io, game, gameId, playerId, cardId);
        } catch (err) {
          debugWarn(1, '[castSpell] completeDanceWithCalamityDeferredAdvance failed:', err);
        }
      }

      {
        const stackTop = Array.isArray(game.state.stack) && game.state.stack.length > 0
          ? game.state.stack[game.state.stack.length - 1]
          : undefined;
        const castSuffix = castSourceZone === 'command'
          ? 'from the command zone'
          : castSourceZone === 'graveyard'
            ? 'from their graveyard'
            : castSourceZone === 'exile'
              ? 'from exile'
              : castSourceZone === 'library'
                ? 'from their library'
                : undefined;
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: formatCastSpellMessage(
            getPlayerName(game, playerId),
            cardInHand.name,
            stackTop?.targetDetails?.map((target) => ({
              ...target,
              type: target.type === 'player' ? 'player' as const : 'permanent' as const,
            })),
            (id) => getPlayerName(game, id),
            castSuffix,
          ),
          ts: Date.now(),
        });
      }

      const persistTriggeredAbilityPush = (payload: Record<string, unknown>, reason: string) => {
        try {
          appendEvent(gameId, (game as any).seq ?? 0, 'pushTriggeredAbility', payload);
        } catch (err) {
          debugWarn(1, `[castSpellFromHand] appendEvent(pushTriggeredAbility ${reason}) failed:`, err);
        }
      };

      // Check for "When you cast this spell" triggers on the spell itself (Kozilek, Ulamog, etc.)
      try {
        // Capture the cast spell's stack id BEFORE pushing on-cast triggers on top of it.
        // Deferred this_spell copies (Storm suite / Hatut) need triggeringStackItemId to find the original.
        const onCastStackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
        let onCastTriggeringStackItemId = '';
        for (let i = onCastStackArr.length - 1; i >= 0; i -= 1) {
          const item = onCastStackArr[i];
          if (!item) continue;
          if (String(item.type || '').trim() === 'triggered_ability') continue;
          if (String(item.controller || '') !== String(playerId)) continue;
          const itemCardId = String(item?.card?.id || '').trim();
          if (itemCardId && itemCardId === String(cardId || '').trim()) {
            onCastTriggeringStackItemId = String(item.id || '').trim();
            break;
          }
        }
        if (!onCastTriggeringStackItemId) {
          for (let i = onCastStackArr.length - 1; i >= 0; i -= 1) {
            const item = onCastStackArr[i];
            if (!item) continue;
            if (String(item.type || '').trim() === 'triggered_ability') continue;
            if (String(item.controller || '') !== String(playerId)) continue;
            if (String(item.type || '').trim() === 'spell' || item.card) {
              onCastTriggeringStackItemId = String(item.id || '').trim();
              break;
            }
          }
        }

        const onCastTriggers = resolveOnCastSpellTriggerDescriptions(cardInHand);
        for (const onCastTrigger of onCastTriggers) {
          debug(2, `[castSpellFromHand] On-cast trigger matching: ${cardInHand.name} - ${onCastTrigger.description}`);

          const triggerLower = onCastTrigger.description.toLowerCase();
          const description = onCastTrigger.description;
          // Use the rich inferrer so GY return patterns (Artisan of Kozilek, etc.)
          // get targetZone/targetDestination/filter metadata, not just battlefield "creature".
          const targetMetadata = inferTriggeredAbilityTargetMetadata(description, {
            gameState: game.state,
            controllerId: String(playerId),
            sourceName: String(cardInHand?.name || ''),
          });
          const triggerId = uid('trigger');
          const isOptionalMay = /\byou may\b/i.test(description)
            && !isOnCastReflexiveCostGateEffect(onCastTrigger.effect || description);

          const triggerPayload: any = {
            id: triggerId,
            type: 'triggered_ability',
            controller: playerId,
            source: cardId,
            sourceName: cardInHand.name,
            description,
            triggerType: 'triggered_ability',
            effect: onCastTrigger.effect,
            mandatory: !isOptionalMay,
            ...(onCastTriggeringStackItemId
              ? {
                  triggeringStackItemId: onCastTriggeringStackItemId,
                  effectData: { triggeringStackItemId: onCastTriggeringStackItemId },
                }
              : null),
            card: {
              ...cardInHand,
              owner: cardInHand.owner || playerId,
            },
            // Kicker ledger for intervening-if ("if it was kicked" / "with its {G} kicker").
            wasKicked: (cardInHand as any).wasKicked === true,
            ...(Number((cardInHand as any).kickerPaidCount) > 0
              ? { kickerPaidCount: Number((cardInHand as any).kickerPaidCount) }
              : null),
            ...(Number((cardInHand as any).timesKicked) > 0
              ? { timesKicked: Number((cardInHand as any).timesKicked) }
              : null),
            ...(Array.isArray((cardInHand as any).paidKickerCosts) && (cardInHand as any).paidKickerCosts.length > 0
              ? { paidKickerCosts: [...(cardInHand as any).paidKickerCosts] }
              : null),
          };

          // Overwrite the description for Emrakul Extra Turn to match regex anchor
          if (triggerLower.includes('extra turn after this one')) {
            triggerPayload.description = "Take an extra turn after this one.";
            triggerPayload.effect = "Take an extra turn after this one.";
          }

          // Attach inferred target metadata if it requires targeting / GY selection
          if (
            targetMetadata.requiresTarget
            || String(targetMetadata.targetZone || '').length > 0
            || String(targetMetadata.targetAction || '').length > 0
          ) {
            if (targetMetadata.requiresTarget) {
              triggerPayload.requiresTarget = true;
              triggerPayload.needsTargetSelection = true;
            }
            if (targetMetadata.targetType) triggerPayload.targetType = targetMetadata.targetType;
            if (targetMetadata.targetConstraint) triggerPayload.targetConstraint = targetMetadata.targetConstraint;
            if (targetMetadata.targetZone) triggerPayload.targetZone = targetMetadata.targetZone;
            if (targetMetadata.targetDestination) triggerPayload.targetDestination = targetMetadata.targetDestination;
            if (targetMetadata.targetGraveyardScope) triggerPayload.targetGraveyardScope = targetMetadata.targetGraveyardScope;
            if (targetMetadata.destinationUsesSelectedCardOwner === true) {
              triggerPayload.destinationUsesSelectedCardOwner = true;
            }
            if (targetMetadata.battlefieldControllerMode) {
              triggerPayload.battlefieldControllerMode = targetMetadata.battlefieldControllerMode;
            }
            if (targetMetadata.battlefieldCounters) {
              triggerPayload.battlefieldCounters = targetMetadata.battlefieldCounters;
            }
            if (targetMetadata.targetAction) triggerPayload.targetAction = targetMetadata.targetAction;
            if (Array.isArray(targetMetadata.targetFilterTypes)) {
              triggerPayload.targetFilterTypes = targetMetadata.targetFilterTypes;
            }
            if (Array.isArray(targetMetadata.targetFilterRequiredTypeWords)) {
              triggerPayload.targetFilterRequiredTypeWords = targetMetadata.targetFilterRequiredTypeWords;
            }
            if (Array.isArray(targetMetadata.targetFilterExcludeTypes)) {
              triggerPayload.targetFilterExcludeTypes = targetMetadata.targetFilterExcludeTypes;
            }
            if (targetMetadata.targetFilterPermanentOnly === true) {
              triggerPayload.targetFilterPermanentOnly = true;
            }
            if (typeof targetMetadata.targetFilterExactManaValue === 'number') {
              triggerPayload.targetFilterExactManaValue = targetMetadata.targetFilterExactManaValue;
            }
            if (typeof targetMetadata.targetFilterMinManaValue === 'number') {
              triggerPayload.targetFilterMinManaValue = targetMetadata.targetFilterMinManaValue;
            }
            if (typeof targetMetadata.targetFilterMaxManaValue === 'number') {
              triggerPayload.targetFilterMaxManaValue = targetMetadata.targetFilterMaxManaValue;
            }
            if (typeof targetMetadata.targetTotalPowerLimit === 'number') {
              triggerPayload.targetTotalPowerLimit = targetMetadata.targetTotalPowerLimit;
            }
            if (targetMetadata.targetCastWithoutPayingManaCost === true) {
              triggerPayload.targetCastWithoutPayingManaCost = true;
            }
            if (targetMetadata.targetCastIsOptional === true) {
              triggerPayload.targetCastIsOptional = true;
            }
            if (targetMetadata.targetFilterRequiresOneOrMoreColors === true) {
              triggerPayload.targetFilterRequiresOneOrMoreColors = true;
            }
            triggerPayload.minTargets = typeof targetMetadata.minTargets === 'number' ? targetMetadata.minTargets : 1;
            triggerPayload.maxTargets = typeof targetMetadata.maxTargets === 'number' ? targetMetadata.maxTargets : 1;

            // Map actions for target-selection validation / UX.
            // Prefer generic oracle patterns; keep inferred min/max (including "up to" = 0).
            if (/\bgain control of target opponent\b/i.test(triggerLower)) {
              triggerPayload.action = 'gain_control_target_opponent';
              triggerPayload.targetType = 'opponent';
            } else if (/\bgain control of all creatures target player controls\b/i.test(triggerLower)) {
              triggerPayload.action = 'gain_control_all_creatures_target_player';
              triggerPayload.targetType = 'player';
            } else if (/\bdestroy\b[^.]*\btarget\b/i.test(triggerLower)) {
              triggerPayload.action = 'destroy_target_permanent';
            } else if (/\bexile\b[^.]*\btarget\b/i.test(triggerLower)) {
              triggerPayload.action = 'exile_target_permanent';
            } else if (/\btap\b[^.]*\btarget\b/i.test(triggerLower)) {
              triggerPayload.action = 'tap_untap_target';
            }
          }

          game.state.stack = game.state.stack || [];
          game.state.stack.push(triggerPayload);
          persistTriggeredAbilityPush(triggerPayload, 'eldrazi_on_cast_trigger');

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${cardInHand.name}: Cast trigger "${triggerPayload.description}" placed on the stack.`,
            ts: Date.now(),
          });
        }
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process on-cast triggers:', err);
      }
      
      // Check for spell-cast triggers (Jeskai Ascendancy, Beast Whisperer, etc.)
      try {
        // Track spells cast this turn (for Storm and other "cast this turn" checks)
        recordSpellCastThisTurn(game, playerId, cardInHand, castSourceZone);

        // Track: "no opponent cast a spell since your last turn ended" (best-effort)
        // Only flips `false -> true` for already-known opponent entries to avoid guessing in team games.
        try {
          const stateAny = game.state as any;
          const map = stateAny?.opponentCastSpellSinceYourLastTurnEnded;
          if (map && typeof map === 'object') {
            // Per-player nested shape
            for (const [, inner] of Object.entries(map)) {
              if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
              if (typeof (inner as any)[playerId] === 'boolean') (inner as any)[playerId] = true;
            }
            // Legacy flat shape (kept for backward compatibility)
            if (typeof (map as any)[playerId] === 'boolean') (map as any)[playerId] = true;
          }
        } catch (err) {
          debugWarn(2, '[castSpellFromHand] Failed to update opponentCastSpellSinceYourLastTurnEnded:', err);
        }

        let triggeringStackItemId: string | undefined;
        let triggeringStackItem: any = null;
        const stackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
        if (stackArr.length > 0) {
          const topStackItem = stackArr[stackArr.length - 1];
          if (topStackItem) {
            triggeringStackItem = topStackItem;
            triggeringStackItemId = String(topStackItem.id || '');
          }
        }
        if (!triggeringStackItem) {
          for (let i = stackArr.length - 1; i >= 0; i--) {
            const item = stackArr[i];
            if (!item || String(item.controller || '') !== String(playerId)) continue;
            if (String(item?.card?.id || '') === String(cardId)) {
              triggeringStackItem = item;
              triggeringStackItemId = String(item.id || '');
              break;
            }
          }
        }

        processSpellCastTriggersForCast(gameId, game, io, playerId, cardInHand, castSourceZone, triggeringStackItemId);
        consumeDelayedSpellCopiesForCast(
          gameId,
          game,
          io,
          playerId,
          triggeringStackItem?.card || cardInHand,
          triggeringStackItemId,
          triggeringStackItem,
          delayedSpellCopiesSnapshot,
        );
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process spell-cast triggers:', err);
      }
      
      // Check for heroic triggers on targeted creatures
      // Heroic: "Whenever you cast a spell that targets this creature..."
      try {
        if (targets && targets.length > 0) {
          const targetIds = targets.map((t: any) => typeof t === 'string' ? t : t.id);
          const heroicTriggers = getHeroicTriggers(game, playerId, targetIds);
          for (const trigger of heroicTriggers) {
            debug(2, `[castSpellFromHand] Heroic triggered: ${trigger.cardName} - ${trigger.description}`);
            applyHeroicTrigger(game, trigger, io, gameId);
          }
        }
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process heroic triggers:', err);
      }
      
      // ========================================================================
      // OPPONENT SPELL CAST TRIGGERS (Esper Sentinel, Rhystic Study, Mystic Remora)
      // These trigger when OPPONENTS cast spells, not the caster themselves
      // ========================================================================
      try {
        const allPlayerIds = (game.state?.players || []).map((p: any) => p.id);
        const battlefield = game.state?.battlefield || [];
        const ctxForInterveningIf = { state: game.state } as any;
        const opponentCastStackArr: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
        const boundCastSpell = findTriggeringSpellOnStack(game.state, {
          triggeringPlayer: playerId,
          effectData: {
            casterId: playerId,
            triggeringSpell: {
              id: cardId,
              name: cardInHand?.name,
            },
          },
        }, { casterId: playerId, cardId: String(cardId || '') });
        let opponentCastTriggeringStackItemId = String(boundCastSpell?.id || '');
        if (!opponentCastTriggeringStackItemId) {
          for (let i = opponentCastStackArr.length - 1; i >= 0; i--) {
            const item = opponentCastStackArr[i];
            if (!item || String(item.controller || '') !== String(playerId)) continue;
            if (String(item.type || '').trim().toLowerCase() === 'triggered_ability') continue;
            if (String(item?.card?.id || '') === String(cardId)) {
              opponentCastTriggeringStackItemId = String(item.id || '');
              break;
            }
          }
        }
        
        // Track if this is the first noncreature spell the caster has cast this turn
        const spellTypeLine = (cardInHand?.type_line || '').toLowerCase();
        const isNoncreatureSpell = !spellTypeLine.includes('creature');
        
        // Check noncreature spells cast this turn by this player
        const noncreatureSpellsThisTurn = (game.state?.noncreatureSpellsCastThisTurn || {})[playerId] || 0;
        const isFirstNoncreatureThisTurn = isNoncreatureSpell && noncreatureSpellsThisTurn === 0;
        
        // Increment counter if this is a noncreature spell
        if (isNoncreatureSpell) {
          game.state.noncreatureSpellsCastThisTurn = game.state.noncreatureSpellsCastThisTurn || {};
          game.state.noncreatureSpellsCastThisTurn[playerId] = noncreatureSpellsThisTurn + 1;
        }
        
        const opponentTriggers = orderTriggersByAPNAP(
          { state: game.state } as any,
          getOpponentSpellCastTriggers(
            battlefield,
            playerId, // The caster (opponent to the trigger controllers)
            cardInHand,
            allPlayerIds,
            isFirstNoncreatureThisTurn,
            castSourceZone,
          ),
        );
        
        for (const trigger of opponentTriggers) {
          // Intervening-if (Rule 603.4): if recognized and false at trigger time, do not trigger.
          const raw = String(trigger.description || (trigger as any).effect || "").trim();
          let triggerText = raw;
          if (triggerText && !/^(?:when|whenever|at)\b/i.test(triggerText)) {
            triggerText = `Whenever an opponent casts a spell, ${triggerText}`;
          }
          const casterId = String((trigger as any).casterId || playerId || '').trim();
          const sourcePerm = (game.state?.battlefield || []).find((p: any) => p && p.id === (trigger as any).permanentId);
          const needsThatPlayerRef = /\bthat player\b/i.test(triggerText);
          const wantsHandCast = /\bfrom (?:their|your|his or her) hand\b/i.test(triggerText);
          if (wantsHandCast && castSourceZone && castSourceZone !== 'hand') {
            debug(2, `[castSpellFromHand] Skipping opponent spell trigger: ${trigger.cardName} (spell was not cast from hand)`);
            continue;
          }
          const ok = isInterveningIfSatisfied(
            ctxForInterveningIf,
            String(trigger.controllerId),
            triggerText,
            sourcePerm,
            needsThatPlayerRef && casterId
              ? {
                  thatPlayerId: casterId,
                  referencedPlayerId: casterId,
                  theirPlayerId: casterId,
                }
              : undefined
          );
          if (ok === false) {
            debug(2, `[castSpellFromHand] Skipping opponent spell trigger due to unmet intervening-if: ${trigger.cardName} - ${triggerText}`);
            continue;
          }

          debug(2, `[castSpellFromHand] Opponent spell trigger: ${trigger.cardName} - ${trigger.description}`);
          
          // Push the trigger to the stack for resolution
          // The trigger's controller can choose to draw a card unless the caster pays
          game.state.stack = game.state.stack || [];
          const triggerId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          
          const stackItem: any = {
            id: triggerId,
            type: 'triggered_ability',
            controller: trigger.controllerId, // The Esper Sentinel/Rhystic Study controller
            source: trigger.permanentId,
            permanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            description: trigger.description,
            effect: (trigger as any).effect || trigger.benefitIfNotPaid || trigger.description,
            triggerType: trigger.triggerType,
            mandatory: trigger.mandatory,
            // Context for resolution-time checks and pronoun binding (e.g., "that player")
            targetPlayer: String((trigger as any).casterId || playerId || ''),
            triggeringPlayer: String((trigger as any).casterId || playerId || ''),
            ...(opponentCastTriggeringStackItemId ? { triggeringStackItemId: opponentCastTriggeringStackItemId } : null),
            ...(castSourceZone ? { triggeringSpellCastSourceZone: castSourceZone } : null),
            effectData: {
              casterId: trigger.casterId,
              ...(castSourceZone ? { castSourceZone, sourceCastZone: castSourceZone } : null),
              ...(opponentCastTriggeringStackItemId ? { triggeringStackItemId: opponentCastTriggeringStackItemId } : null),
              triggeringSpell: {
                id: cardInHand?.id,
                name: cardInHand?.name,
                type_line: cardInHand?.type_line,
                ...(castSourceZone ? { castSourceZone } : null),
              },
              paymentCost: trigger.paymentCost,
              paymentAmount: trigger.paymentAmount,
              benefitIfNotPaid: trigger.benefitIfNotPaid,
            },
          };
          game.state.stack.push(stackItem);

          persistTriggeredAbilityPush({
            triggerId,
            sourceId: trigger.permanentId,
            permanentId: trigger.permanentId,
            sourceName: trigger.cardName,
            controllerId: trigger.controllerId,
            description: trigger.description,
            triggerType: trigger.triggerType,
            effect: (trigger as any).effect || trigger.description,
            mandatory: trigger.mandatory,
            targetPlayer: stackItem.targetPlayer,
            triggeringPlayer: stackItem.triggeringPlayer,
            ...(opponentCastTriggeringStackItemId ? { triggeringStackItemId: opponentCastTriggeringStackItemId } : null),
            ...(castSourceZone ? { triggeringSpellCastSourceZone: castSourceZone } : null),
            effectData: stackItem.effectData,
          }, 'opponent spell-cast');
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${trigger.cardName} triggers (${trigger.description}).`,
            ts: Date.now(),
          });
        }
      } catch (err) {
        debugWarn(1, '[castSpellFromHand] Failed to process opponent spell triggers:', err);
      }
      
      // Foretell cast cleanup: once the spell is successfully cast, clear any pending-restore marker.
      if ((cardInHand as any)?.castFromForetell === true) {
        const pendingForetell = (game.state as any)?.pendingForetellCasts;
        if (pendingForetell?.[cardId]) {
          delete pendingForetell[cardId];
        }
      }

      if (castSourceZone !== 'command') {
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} cast ${cardInHand.name}.`,
          ts: Date.now(),
        });
      }
      
      // Process any cascade triggers
      await processPendingCascades(io, game, gameId);
      
      // Process any pending scry effects
      processPendingScry(io, game, gameId);

      // Process any pending surveil effects
      processPendingSurveil(io, game, gameId);
      
      // Process any pending ponder effects
      processPendingPonder(io, game, gameId);

      // Process any pending bottom-order effects
      processPendingBottomOrder(io, game, gameId);

      // Process any pending Lim-Dul's Vault effects
      processPendingLimDulsVault(io, game, gameId);

      // Process any pending Dance with Calamity effects
      processPendingDanceWithCalamity(io, game, gameId);
      
      // Process any pending proliferate effects
      processPendingProliferate(io, game, gameId);
      processPendingOracleIrCompoundResume(io, game, gameId);
      
      broadcastGame(io, game, gameId);

}
