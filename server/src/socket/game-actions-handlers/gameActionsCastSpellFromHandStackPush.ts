/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand applyEvent stack push + verify, then
 * the legacy pushStack fallback (CR 601.2i). Stamp is stampCastSpellStackItemFromHand.
 *
 * Public entry symbols: tryPushCastSpellFromHandToStack.
 */
import type { Socket } from "socket.io";
import type { PaymentItem, PlayerID } from "../../../../shared/src/index.js";
import {
  buildPersistedCastPermissionFields,
  buildPersistedFreeCastIntentFields,
  buildPersistedSacrificedPermanentFields,
  buildPersistedWebSlingingCastIntentFields,
} from "../../state/modules/castIntent.js";
import { cleanupCardLeavingExile } from "../../state/modules/playable-from-exile.js";
import { canPermanentBeTargetedByPlayer, evaluateTargeting } from "../../rules-engine/targeting";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { getOrInitManaPool } from "../util";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import { restorePlayerCastSpellPaymentCheckpoint } from "./gameActionsCastSpellPaymentSources.js";
import { stampCastSpellStackItemFromHand } from "./gameActionsCastSpellFromHandStackStamp.js";
import { canCompleteSpellCastAtCurrentTiming } from "./gameActionsSpellCastLock.js";
import { buildSpellCopyRetargetValidTargetsFallback } from "./gameActionsSpellCopyHeroicTriggers.js";
import {
  buildSpellTargetListFromRequirements,
  mapSpellTargetRefToDisplay,
  resolveTargetCount,
} from "./gameActionsSpellTargetSelection.js";

export type CastSpellFromHandStackPushArgs = {
  socket: Socket;
  game: any;
  playerId: string;
  cardId: string;
  cardInHand: any;
  targets: any;
  payment: PaymentItem[] | undefined;
  alternateCostId: string | undefined;
  castSourceZone: SpellCastSourceZone;
  convokeTappedCreatures: string[] | undefined;
  xValue: number | undefined;
  selectedFaceIndex: number | undefined;
  castAsAdventure: boolean | undefined;
  resolvedTimesKicked: number | undefined;
  giftPromisedForCast: boolean;
  isAura: boolean;
  auraTargetType: any;
  auraControllerRestriction: any;
  spellSpec: any;
  targetReqs: any;
  preferParsedTargetReqs: boolean;
  multiTargetClauses: any[];
  sourceArr: any[];
  zones: any;
  hand: any[];
  exile: any[];
  graveyard: any[];
  delayedSpellCopiesSnapshot: any[];
  abortCastSpellPayment: any;
  allowResolutionModeCompletion: boolean;
  castSpellPaymentCheckpoint: any;
  poolBeforeSpellPayment: any;
  manaProducedByPermanentBeforeSpellPayment: any;
  tappedPaymentPermanents: Set<string>;
  sacrificedPaymentPermanents: Set<string>;
  persistedSacrificedPermanentFields: any;
  manaConsumption: any;
  manaSpentTotal: number;
  convergeValue: number;
  gainsHasteUntilEndOfTurnFromManaSpent: boolean;
  cantBeCounteredFromCavern: boolean;
  manaFromTreasureSpent: true | undefined;
  manaFromTreasureSpentKnown: boolean | undefined;
  snowManaSpentByColor: Record<string, number> | undefined;
  snowManaColorsSpent: string[] | undefined;
  snowManaSpentKnown: boolean | undefined;
  snowManaSpent: boolean | undefined;
  snowManaOfSpellColorsSpentKnown: boolean | undefined;
  snowManaOfSpellColorsSpent: boolean | undefined;
  additionalCost: any;
  additionalCostPaid: boolean | undefined;
  bargainResolved: boolean;
  wasBargained: boolean;
  teamworkResolved: boolean;
  teamworkWasPaid: boolean;
  evidenceCollected: boolean;
};

export type CastSpellFromHandStackPushContinue = {
  kind: "continue";
  persistedSacrificedPermanentFields: any;
};

export function tryPushCastSpellFromHandToStack(
  args: CastSpellFromHandStackPushArgs,
): CastSpellFromHandStackPushContinue | void {
  const {
    socket,
    game,
    playerId,
    cardId,
    cardInHand,
    targets,
    payment,
    alternateCostId,
    castSourceZone,
    convokeTappedCreatures,
    xValue,
    selectedFaceIndex,
    castAsAdventure,
    resolvedTimesKicked,
    giftPromisedForCast,
    isAura,
    auraTargetType,
    auraControllerRestriction,
    spellSpec,
    targetReqs,
    preferParsedTargetReqs,
    multiTargetClauses,
    sourceArr,
    zones,
    hand,
    exile,
    graveyard,
    delayedSpellCopiesSnapshot,
    abortCastSpellPayment,
    allowResolutionModeCompletion,
    castSpellPaymentCheckpoint,
    poolBeforeSpellPayment,
    manaProducedByPermanentBeforeSpellPayment,
    tappedPaymentPermanents,
    sacrificedPaymentPermanents,
    manaConsumption,
    manaSpentTotal,
    convergeValue,
    gainsHasteUntilEndOfTurnFromManaSpent,
    cantBeCounteredFromCavern,
    manaFromTreasureSpent,
    manaFromTreasureSpentKnown,
    snowManaSpentByColor,
    snowManaColorsSpent,
    snowManaSpentKnown,
    snowManaSpent,
    snowManaOfSpellColorsSpentKnown,
    snowManaOfSpellColorsSpent,
    additionalCost,
    additionalCostPaid,
    bargainResolved,
    wasBargained,
    teamworkResolved,
    teamworkWasPaid,
    evidenceCollected,
  } = args;
  let { persistedSacrificedPermanentFields } = args;
          // Check stack length before attempting to cast
          const stackLengthBefore = game.state.stack?.length || 0;
          const spellCopyRetargetMetadata = (() => {
            if (!Array.isArray(targets) || targets.length === 0) return null;
            let minTargets = 1;
            let maxTargets = 1;
            let validTargetList: any[] = [];
            let targetDescription = 'target';
            let targetTypes: string[] = ['spell_target'];

            if (isAura) {
              if (!auraTargetType) return null;

              targetTypes = ['aura_target'];
              targetDescription = `Enchant ${auraTargetType}`;

              if (auraTargetType === 'player') {
                validTargetList = (game.state.players || []).map((player: any) => ({
                  id: player.id,
                  kind: 'player',
                  name: player.name || player.id,
                  isOpponent: player.id !== playerId,
                }));
              } else if (auraTargetType === 'opponent') {
                validTargetList = (game.state.players || [])
                  .filter((player: any) => player.id !== playerId)
                  .map((player: any) => ({
                    id: player.id,
                    kind: 'player',
                    name: player.name || player.id,
                    isOpponent: true,
                  }));
              } else if (auraTargetType === 'creature') {
                validTargetList = (game.state.battlefield || [])
                  .filter((permanent: any) => {
                    const permanentTypeLine = String(permanent?.card?.type_line || '').toLowerCase();
                    if (!permanentTypeLine.includes('creature')) return false;
                    if (auraControllerRestriction === 'you_control' && permanent.controller !== playerId) return false;
                    if (auraControllerRestriction === 'opponent_controls' && permanent.controller === playerId) return false;
                    return canPermanentBeTargetedByPlayer(permanent, game.state, playerId as PlayerID);
                  })
                  .map((permanent: any) => ({
                    id: permanent.id,
                    kind: 'permanent',
                    name: permanent.card?.name || 'Unknown',
                    controller: permanent.controller,
                    isOpponent: permanent.controller !== playerId,
                    imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
                    typeLine: permanent.card?.type_line,
                  }));
              } else if (auraTargetType === 'permanent') {
                validTargetList = (game.state.battlefield || [])
                  .filter((permanent: any) => canPermanentBeTargetedByPlayer(permanent, game.state, playerId as PlayerID))
                  .map((permanent: any) => ({
                    id: permanent.id,
                    kind: 'permanent',
                    name: permanent.card?.name || 'Unknown',
                    controller: permanent.controller,
                    isOpponent: permanent.controller !== playerId,
                    imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
                    typeLine: permanent.card?.type_line,
                  }));
              } else if (auraTargetType === 'artifact' || auraTargetType === 'land' || auraTargetType === 'enchantment') {
                validTargetList = (game.state.battlefield || [])
                  .filter((permanent: any) => String(permanent?.card?.type_line || '').toLowerCase().includes(auraTargetType)
                    && canPermanentBeTargetedByPlayer(permanent, game.state, playerId as PlayerID))
                  .map((permanent: any) => ({
                    id: permanent.id,
                    kind: 'permanent',
                    name: permanent.card?.name || 'Unknown',
                    controller: permanent.controller,
                    isOpponent: permanent.controller !== playerId,
                    imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
                    typeLine: permanent.card?.type_line,
                  }));
              }
            } else {
              if (multiTargetClauses.length > 1) return null;
              if ((targetReqs as any)?.perOpponent === true) return null;

              minTargets = spellSpec && !preferParsedTargetReqs
                ? resolveTargetCount(spellSpec.minTargets, (spellSpec as any).minTargetsIsX === true, xValue)
                : resolveTargetCount(targetReqs?.minTargets, (targetReqs as any)?.minTargetsIsX === true, xValue);
              maxTargets = spellSpec && !preferParsedTargetReqs
                ? resolveTargetCount(spellSpec.maxTargets, (spellSpec as any).maxTargetsIsX === true, xValue)
                : resolveTargetCount(targetReqs?.maxTargets, (targetReqs as any)?.maxTargetsIsX === true, xValue);
              if (!(maxTargets > 0)) return null;

              validTargetList = spellSpec && !preferParsedTargetReqs
                ? evaluateTargeting(game.state as any, playerId, spellSpec).map((targetRef: any) => mapSpellTargetRefToDisplay(game, String(playerId), targetRef))
                : (targetReqs?.needsTargets ? buildSpellTargetListFromRequirements(game, String(playerId), targetReqs) : []);
              targetDescription = preferParsedTargetReqs
                ? targetReqs?.targetDescription || spellSpec?.targetDescription || 'target'
                : spellSpec?.targetDescription || targetReqs?.targetDescription || 'target';
              targetTypes = Array.isArray(targetReqs?.targetTypes) && targetReqs.targetTypes.length > 0
                ? [...targetReqs.targetTypes]
                : ['spell_target'];
            }

            if (!Array.isArray(validTargetList) || validTargetList.length === 0) {
              const fallbackTargets = buildSpellCopyRetargetValidTargetsFallback(game, playerId, targets);
              if (!fallbackTargets || fallbackTargets.length === 0) return null;
              validTargetList = fallbackTargets;
              targetTypes = ['player'];
              targetDescription = 'player';
              minTargets = Array.isArray(targets) ? targets.length : 1;
              maxTargets = Array.isArray(targets) ? targets.length : 1;
            }

            return {
              copyRetargetValidTargets: validTargetList.map((target: any) => ({
                id: String(target?.id || ''),
                name: String(target?.name || target?.label || 'Target'),
                type: target?.kind === 'player' ? 'player' : (target?.kind === 'stack' ? 'stack' : 'permanent'),
                controller: target?.controller,
                imageUrl: target?.imageUrl,
                typeLine: target?.typeLine,
                life: target?.life,
                isOpponent: target?.isOpponent,
              })),
              copyRetargetTargetTypes: targetTypes,
              copyRetargetMinTargets: minTargets,
              copyRetargetMaxTargets: maxTargets,
              copyRetargetTargetDescription: String(targetDescription || 'target'),
            };
          })();

          persistedSacrificedPermanentFields = buildPersistedSacrificedPermanentFields(
            sacrificedPaymentPermanents,
            (cardInHand as any)?.pendingAdditionalCostSacrificeIds,
          );
          
          if (typeof game.applyEvent === 'function') {
            if (!canCompleteSpellCastAtCurrentTiming(game, playerId, allowResolutionModeCompletion)) {
              Object.assign(getOrInitManaPool(game.state, playerId), poolBeforeSpellPayment);
              restorePlayerCastSpellPaymentCheckpoint(game, playerId, {
                pool: castSpellPaymentCheckpoint.pool,
                tappedPermanentIds: castSpellPaymentCheckpoint.tappedPermanentIds,
                harmonizePermanentId: castSpellPaymentCheckpoint.harmonizePermanentId,
                removedCounters: castSpellPaymentCheckpoint.removedCounters,
              });
              try {
                delete (cardInHand as any).pendingAdditionalCostSacrificeIds;
                delete (cardInHand as any).additionalCostPaid;
                delete (cardInHand as any).additionalCostMethod;
              } catch { /* ignore */ }
              debugWarn(
                1,
                `[castSpellFromHand] Aborting applyEvent for ${cardInHand.name} (${cardId}) � cast timing lost before stack push`,
              );
              socket.emit('error', {
                code: 'CAST_TIMING_LOST',
                message: 'Cannot finish casting this spell because priority was lost.',
              });
              return;
            }

            const castEv: any = {
              type: "castSpell",
              playerId,
              cardId,
              card: {
                ...cardInHand,
                ...(castSourceZone === 'command' ? { isCommander: true } : {}),
                ...(cantBeCounteredFromCavern ? { cantBeCountered: true } : {}),
              },
              targets: targets || [],
              xValue,
              ...(resolvedTimesKicked != null && resolvedTimesKicked > 0
                ? {
                    timesKicked: resolvedTimesKicked,
                    kickerPaidCount: resolvedTimesKicked,
                    wasKicked: true,
                  }
                : {}),
              ...((cardInHand as any).entersBattlefieldWithCounters
                && typeof (cardInHand as any).entersBattlefieldWithCounters === 'object'
                ? { entersBattlefieldWithCounters: { ...(cardInHand as any).entersBattlefieldWithCounters } }
                : {}),
              ...(typeof selectedFaceIndex === 'number' ? { faceIndex: selectedFaceIndex } : {}),
              ...(typeof castAsAdventure === 'boolean' ? { castAsAdventure } : {}),
              alternateCostId,
              ...buildPersistedWebSlingingCastIntentFields(cardInHand as any, alternateCostId),
              ...buildPersistedFreeCastIntentFields(cardInHand as any, alternateCostId),
              ...(giftPromisedForCast === true
                ? {
                    giftPromised: true,
                    giftRecipient: String((cardInHand as any).giftRecipient || '') || undefined,
                    giftType: String((cardInHand as any).giftType || '') || undefined,
                  }
                : {}),
              // Provenance / replay-stable metadata for intervening-if templates.
              fromZone: castSourceZone,
              castFromHand: castSourceZone === 'hand',
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
              manaSpentTotal,
              manaSpentBreakdown: { ...manaConsumption.consumed },
              ...(manaFromTreasureSpentKnown === true
                ? {
                    manaFromTreasureSpentKnown: true,
                    manaFromTreasureSpent: manaFromTreasureSpent === true,
                  }
                : {}),
              ...(bargainResolved === true && typeof wasBargained === 'boolean'
                ? {
                    bargainResolved: true,
                    wasBargained,
                  }
                : {}),
              ...(teamworkResolved === true && typeof teamworkWasPaid === 'boolean'
                ? {
                    teamworkResolved: true,
                    teamworkWasPaid,
                  }
                : {}),
              ...(gainsHasteUntilEndOfTurnFromManaSpent === true
                ? {
                    gainsHasteUntilEndOfTurnFromManaSpent: true,
                  }
                : {}),
              ...(cantBeCounteredFromCavern ? { cantBeCountered: true } : {}),
              ...(snowManaSpentByColor
                ? {
                    snowManaSpentByColor: { ...snowManaSpentByColor },
                    ...(snowManaColorsSpent && snowManaColorsSpent.length > 0 ? { snowManaColorsSpent: snowManaColorsSpent.slice() } : {}),
                  }
                : {}),
              ...(snowManaSpentKnown === true && typeof snowManaSpent === 'boolean'
                ? {
                    snowManaSpentKnown: true,
                    snowManaSpent,
                  }
                : {}),
              ...(snowManaOfSpellColorsSpentKnown === true && typeof snowManaOfSpellColorsSpent === 'boolean'
                ? {
                    snowManaOfSpellColorsSpentKnown: true,
                    snowManaOfSpellColorsSpent,
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
              ...(Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0
                ? {
                    convokeTappedCreatures: convokeTappedCreatures.slice(),
                    manaFromCreaturesSpent: convokeTappedCreatures.length,
                  }
                : {}),
              ...(tappedPaymentPermanents.size > 0
                ? {
                    tappedPermanents: Array.from(tappedPaymentPermanents),
                  }
                : {}),
              ...persistedSacrificedPermanentFields,
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
              ...(spellCopyRetargetMetadata ? { ...spellCopyRetargetMetadata } : {}),
            };
            if (alternateCostId === 'free' || (cardInHand as any).castWithoutPayingManaCost === true) {
              castEv.castWithoutPayingManaCost = true;
              if (castEv.card && typeof castEv.card === 'object') {
                castEv.card.castWithoutPayingManaCost = true;
              }
            }
            if (manaFromTreasureSpent === true) {
              // Preserve positive-only evidence when we don't have a replay-stable known/boolean.
              if (manaFromTreasureSpentKnown !== true) {
                castEv.manaFromTreasureSpent = true;
              }
            }
            game.applyEvent(castEv);
            
            // Verify the spell was actually added to the stack
            const stackLengthAfter = game.state.stack?.length || 0;
            if (stackLengthAfter <= stackLengthBefore) {
              const stillInHand = Array.isArray((zones as any)?.hand)
                && (zones as any).hand.some((entry: any) => entry && String(entry.id || '') === String(cardId));
              const alreadyOnBattlefield = Array.isArray(game.state.battlefield)
                && game.state.battlefield.some((permanent: any) =>
                  permanent
                  && String(permanent.controller || '') === String(playerId)
                  && String(permanent.card?.id || '') === String(cardId),
                );
              if (alreadyOnBattlefield && !stillInHand) {
                // castSpell repaired a dual-zone ghost (card already a permanent). Refund mana;
                // do not emit CAST_FAILED or the AI will thrash retrying a card that is gone.
                restorePlayerCastSpellPaymentCheckpoint(game, playerId, {
                  pool: castSpellPaymentCheckpoint.pool,
                  tappedPermanentIds: castSpellPaymentCheckpoint.tappedPermanentIds,
                  harmonizePermanentId: castSpellPaymentCheckpoint.harmonizePermanentId,
                  removedCounters: castSpellPaymentCheckpoint.removedCounters,
                });
                debugWarn(
                  1,
                  `[castSpellFromHand] applyEvent was idempotent for ${cardInHand.name} (${cardId}) � already on battlefield; refunded payment`,
                );
                return;
              }
              // The spell wasn't added to the stack - something went wrong
              debugError(1, `[castSpellFromHand] applyEvent did not add spell to stack. Stack: ${stackLengthBefore} -> ${stackLengthAfter}`);
              try {
                delete (cardInHand as any).pendingAdditionalCostSacrificeIds;
                delete (cardInHand as any).additionalCostPaid;
                delete (cardInHand as any).additionalCostMethod;
              } catch { /* ignore */ }
              abortCastSpellPayment({
                code: 'CAST_FAILED',
                message: `Failed to cast ${cardInHand.name}. The card may have been removed or an internal error occurred.`,
              });
              return;
            }
            
            stampCastSpellStackItemFromHand({
              game,
              playerId,
              cardId,
              cardInHand,
              targets,
              payment,
              alternateCostId,
              castSourceZone,
              convokeTappedCreatures,
              convergeValue,
              manaConsumption,
              manaSpentTotal,
              poolBeforeSpellPayment,
              manaProducedByPermanentBeforeSpellPayment,
              gainsHasteUntilEndOfTurnFromManaSpent,
              cantBeCounteredFromCavern,
              manaFromTreasureSpent,
              manaFromTreasureSpentKnown,
              snowManaSpentByColor,
              snowManaColorsSpent,
              snowManaSpentKnown,
              snowManaSpent,
              snowManaOfSpellColorsSpentKnown,
              snowManaOfSpellColorsSpent,
              additionalCost,
              additionalCostPaid,
              bargainResolved,
              wasBargained,
              teamworkResolved,
              teamworkWasPaid,
              evidenceCollected,
            });

          } else {
          // Fallback for legacy game instances without applyEvent
          // Remove from source zone
          const sourceCards = sourceArr;
          const idx = sourceCards.findIndex((c: any) => c && c.id === cardId);
          if (idx !== -1) {
            const [removedCard] = sourceCards.splice(idx, 1);
            if (castSourceZone === 'hand') {
              zones.handCount = hand.length;
            } else if (castSourceZone === 'exile') {
              (zones as any).exileCount = exile.length;
              cleanupCardLeavingExile(game.state as any, removedCard);
            } else if (castSourceZone === 'graveyard') {
              (zones as any).graveyardCount = graveyard.length;
            }
            
            // Build target details for display
            const targetDetails: Array<{ id: string; type: 'permanent' | 'player' | 'spell' | 'ability'; name?: string; controllerId?: string; controllerName?: string }> = [];
            if (targets && targets.length > 0) {
              for (const target of targets) {
                const targetId = typeof target === 'string' ? target : target.id;
                const targetKind = typeof target === 'object' ? target.kind : undefined;
                
                if (targetKind === 'player') {
                  // Find player name
                  const player = (game.state.players || []).find((p: any) => p.id === targetId);
                  targetDetails.push({
                    id: targetId,
                    type: 'player',
                    name: player?.name || targetId,
                  });
                } else if (
                  targetKind === 'stack'
                  || (!targetKind && Array.isArray(game.state.stack) && game.state.stack.some((s: any) => String(s?.id || '') === String(targetId)))
                ) {
                  const stackItem = (game.state.stack || []).find((s: any) => String(s?.id || '') === String(targetId));
                  const isAbility = stackItem
                    && (stackItem.type === 'ability' || stackItem.type === 'triggered_ability');
                  const controllerId = stackItem?.controller;
                  const controllerPlayer = controllerId ? (game.state.players || []).find((p: any) => p.id === controllerId) : undefined;
                  targetDetails.push({
                    id: targetId,
                    type: isAbility ? 'ability' : 'spell',
                    name: stackItem?.card?.name || stackItem?.sourceName || stackItem?.description,
                    controllerId,
                    controllerName: controllerPlayer?.name,
                  });
                } else {
                  // Find permanent name and controller
                  const perm = (game.state.battlefield || []).find((p: any) => p.id === targetId);
                  // Try to get name from multiple sources (card.name, card_faces[0].name for DFCs)
                  let permName = perm?.card?.name;
                  if (!permName && (perm?.card as any)?.card_faces?.[0]?.name) {
                    permName = (perm.card as any).card_faces[0].name;
                  }
                  // Don't use ID as fallback name - leave it undefined so client can try to look up
                  const controllerId = perm?.controller;
                  const controllerPlayer = controllerId ? (game.state.players || []).find((p: any) => p.id === controllerId) : undefined;
                  targetDetails.push({
                    id: targetId,
                    type: 'permanent',
                    name: permName,
                    controllerId: controllerId,
                    controllerName: controllerPlayer?.name,
                  });
                }
              }
            }
            
            // Add to stack
            const stackItem = {
              id: `stack_${Date.now()}_${cardId}`,
              controller: playerId,
              card: {
                ...cardInHand,
                zone: "stack",
                ...(cantBeCounteredFromCavern ? { cantBeCountered: true } : {}),
                ...(manaFromTreasureSpent === true ? { manaFromTreasureSpent: true } : {}),
                ...(giftPromisedForCast === true
                  ? {
                      giftPromised: true,
                      giftRecipient: String((cardInHand as any).giftRecipient || '') || undefined,
                      giftType: String((cardInHand as any).giftType || '') || undefined,
                    }
                  : {}),
              },
              targets: targets || [],
              targetDetails: targetDetails.length > 0 ? targetDetails : undefined,
              xValue,
              ...(giftPromisedForCast === true
                ? {
                    giftPromised: true,
                    giftRecipient: String((cardInHand as any).giftRecipient || '') || undefined,
                    giftType: String((cardInHand as any).giftType || '') || undefined,
                  }
                : {}),
              ...(manaFromTreasureSpent === true ? { manaFromTreasureSpent: true } : {}),
              ...(cantBeCounteredFromCavern ? { cantBeCountered: true } : {}),
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
              // Converge tracking for cards like Bring to Light
              convergeValue: convergeValue > 0 ? convergeValue : undefined,
              manaColorsSpent: convergeValue > 0 ? Object.entries(manaConsumption.consumed as Record<string, number>)
                .filter(([color, amount]) => color !== 'colorless' && Number(amount) > 0)
                .map(([color]) => color) : undefined,
              manaSpentTotal,
              manaSpentBreakdown: { ...manaConsumption.consumed },
              ...(typeof selectedFaceIndex === 'number' ? { faceIndex: selectedFaceIndex } : {}),
              ...(typeof castAsAdventure === 'boolean' ? { castAsAdventure } : {}),
              // Track source zone for rebound and other "cast from hand" effects
              castFromHand: castSourceZone === 'hand',
              source: castSourceZone,
              ...(spellCopyRetargetMetadata ? { ...spellCopyRetargetMetadata } : {}),
            };

            const pendingDelayedSpellCopies = delayedSpellCopiesSnapshot;
            
            if (typeof game.pushStack === 'function') {
              game.pushStack(stackItem);
            } else {
              // Fallback: manually add to stack
              game.state.stack = game.state.stack || [];
              game.state.stack.push(stackItem as any);
            }
            
            // Bump sequence
            if (typeof game.bumpSeq === 'function') {
              game.bumpSeq();
            }
            
            debug(2, `[castSpell] Player ${playerId} cast ${cardInHand.name} (${cardId}) from ${castSourceZone} via fallback`);

            // Track per-turn "cast from hand" (best-effort)
            if (castSourceZone === 'hand') {
              game.state.spellsCastFromHandThisTurn = game.state.spellsCastFromHandThisTurn || {};
              game.state.spellsCastFromHandThisTurn[playerId] = (game.state.spellsCastFromHandThisTurn[playerId] || 0) + 1;
            }
          }
        }

  return {
    kind: "continue",
    persistedSacrificedPermanentFields,
  };
}
