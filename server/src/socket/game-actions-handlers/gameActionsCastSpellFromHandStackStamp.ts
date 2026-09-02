/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand stack-item stamping after applyEvent
 * (converge, haste, cavern, snow, additional cost, Bargain, Teamwork, evidence)
 * plus the from-hand cast counter (CR 601.2i).
 *
 * Public entry symbols: stampCastSpellStackItemFromHand.
 */
import { debug } from "../../utils/debug.js";
import type { PaymentItem } from "../../../../shared/src/index.js";
import { stampReplayedGraveyardCastStackFlags } from "../../state/modules/stackReplayUtils.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";

export type StampCastSpellStackItemFromHandArgs = {
  game: any;
  playerId: string;
  cardId: string;
  cardInHand: any;
  targets: any;
  payment: PaymentItem[] | undefined;
  alternateCostId: string | undefined;
  castSourceZone: SpellCastSourceZone;
  convokeTappedCreatures: string[] | undefined;
  convergeValue: number;
  manaConsumption: any;
  manaSpentTotal: number;
  poolBeforeSpellPayment: any;
  manaProducedByPermanentBeforeSpellPayment: any;
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

export function stampCastSpellStackItemFromHand(
  args: StampCastSpellStackItemFromHandArgs,
): void {
  const {
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
  } = args;

            // Add converge value to the stack item (the top item is the one just added)
            if (convergeValue > 0 && game.state.stack && game.state.stack.length > 0) {
              const topStackItem = game.state.stack[game.state.stack.length - 1];
              (topStackItem as any).convergeValue = convergeValue;
              (topStackItem as any).manaColorsSpent = Object.entries(manaConsumption.consumed as Record<string, number>)
                .filter(([color, amount]) => color !== 'colorless' && Number(amount) > 0)
                .map(([color]) => color);
              (topStackItem as any).manaSpentTotal = manaSpentTotal;
              (topStackItem as any).manaSpentBreakdown = { ...manaConsumption.consumed };
              if (Array.isArray(payment) && payment.length > 0) {
                (topStackItem as any).manaPayment = payment.map((entry: any) => ({ ...entry }));
              }
              (topStackItem as any).poolBeforeSpellPayment = { ...poolBeforeSpellPayment };
              (topStackItem as any).manaProducedByPermanentBeforePayment = { ...manaProducedByPermanentBeforeSpellPayment };

              // Plumb chosen alternate-cost id onto the stack item so intervening-if clauses can evaluate.
              if (alternateCostId) {
                (topStackItem as any).alternateCostId = alternateCostId;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.alternateCostId = alternateCostId;
                }
              }

              // Convoke contribution (each tapped creature contributes {1}).
              if (Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0) {
                (topStackItem as any).convokeTappedCreatures = convokeTappedCreatures.slice();
                (topStackItem as any).manaFromCreaturesSpent = convokeTappedCreatures.length;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.convokeTappedCreatures = convokeTappedCreatures.slice();
                  (topStackItem as any).card.manaFromCreaturesSpent = convokeTappedCreatures.length;
                }
              }

              // Best-effort boolean flags for common alternate cost templates.
              const altLower = alternateCostId ? String(alternateCostId).toLowerCase() : '';
              if (altLower) {
                (topStackItem as any).prowlCostWasPaid = altLower === 'prowl';
                (topStackItem as any).surgeCostWasPaid = altLower === 'surge';
                (topStackItem as any).madnessCostWasPaid = altLower === 'madness';
                (topStackItem as any).spectacleCostWasPaid = altLower === 'spectacle';
                (topStackItem as any).warpCostWasPaid = altLower === 'warp';
                (topStackItem as any).dashCostWasPaid = altLower === 'dash';
                (topStackItem as any).blitzCostWasPaid = altLower === 'blitz';
                (topStackItem as any).sneakCostWasPaid = altLower === 'sneak';
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.prowlCostWasPaid = (topStackItem as any).prowlCostWasPaid;
                  (topStackItem as any).card.surgeCostWasPaid = (topStackItem as any).surgeCostWasPaid;
                  (topStackItem as any).card.madnessCostWasPaid = (topStackItem as any).madnessCostWasPaid;
                  (topStackItem as any).card.spectacleCostWasPaid = (topStackItem as any).spectacleCostWasPaid;
                  (topStackItem as any).card.warpCostWasPaid = (topStackItem as any).warpCostWasPaid;
                  (topStackItem as any).card.dashCostWasPaid = (topStackItem as any).dashCostWasPaid;
                  (topStackItem as any).card.blitzCostWasPaid = (topStackItem as any).blitzCostWasPaid;
                  (topStackItem as any).card.sneakCostWasPaid = (topStackItem as any).sneakCostWasPaid;
                }
              }

              // Intervening-if support: "if mana from a Treasure was spent to cast it".
              if (manaFromTreasureSpentKnown === true) {
                (topStackItem as any).manaFromTreasureSpentKnown = true;
                (topStackItem as any).manaFromTreasureSpent = manaFromTreasureSpent === true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.manaFromTreasureSpentKnown = true;
                  (topStackItem as any).card.manaFromTreasureSpent = manaFromTreasureSpent === true;
                }
              } else if (manaFromTreasureSpent === true) {
                (topStackItem as any).manaFromTreasureSpent = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.manaFromTreasureSpent = true;
                }
              }

              if (gainsHasteUntilEndOfTurnFromManaSpent === true) {
                (topStackItem as any).gainsHasteUntilEndOfTurnFromManaSpent = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.gainsHasteUntilEndOfTurnFromManaSpent = true;
                }
              }

              if (cantBeCounteredFromCavern) {
                (topStackItem as any).cantBeCountered = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.cantBeCountered = true;
                }
              }

              // Intervening-if support: snow mana spent (positive-only lower bound).
              if (snowManaSpentByColor) {
                (topStackItem as any).snowManaSpentByColor = { ...snowManaSpentByColor };
                if (snowManaColorsSpent && snowManaColorsSpent.length > 0) {
                  (topStackItem as any).snowManaColorsSpent = snowManaColorsSpent.slice();
                }
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.snowManaSpentByColor = { ...snowManaSpentByColor };
                  if (snowManaColorsSpent && snowManaColorsSpent.length > 0) {
                    (topStackItem as any).card.snowManaColorsSpent = snowManaColorsSpent.slice();
                  }
                }
              }

              // Intervening-if support: deterministic outcome for "if {S} was spent ..." when known.
              if (snowManaSpentKnown === true && typeof snowManaSpent === 'boolean') {
                (topStackItem as any).snowManaSpentKnown = true;
                (topStackItem as any).snowManaSpent = snowManaSpent;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.snowManaSpentKnown = true;
                  (topStackItem as any).card.snowManaSpent = snowManaSpent;
                }
              }

              // Intervening-if support: deterministic outcome for "{S} of any of that spell's colors" when known.
              if (snowManaOfSpellColorsSpentKnown === true && typeof snowManaOfSpellColorsSpent === 'boolean') {
                (topStackItem as any).snowManaOfSpellColorsSpentKnown = true;
                (topStackItem as any).snowManaOfSpellColorsSpent = snowManaOfSpellColorsSpent;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.snowManaOfSpellColorsSpentKnown = true;
                  (topStackItem as any).card.snowManaOfSpellColorsSpent = snowManaOfSpellColorsSpent;
                }
              }

              // Intervening-if support: "if its additional cost was paid".
              // Deterministic when we know the spell had an additional cost.
              if (additionalCost && typeof additionalCostPaid === 'boolean') {
                (topStackItem as any).additionalCostPaidKnown = true;
                (topStackItem as any).additionalCostPaid = additionalCostPaid === true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostPaidKnown = true;
                  (topStackItem as any).card.additionalCostPaid = additionalCostPaid === true;
                }
                if (additionalCostPaid === true) {
                  (topStackItem as any).additionalCostWasPaid = true;
                  (topStackItem as any).paidAdditionalCost = true;
                  if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                    (topStackItem as any).card.additionalCostWasPaid = true;
                    (topStackItem as any).card.paidAdditionalCost = true;
                  }
                }
              } else if (additionalCostPaid === true) {
                // Legacy positive-only evidence.
                (topStackItem as any).additionalCostWasPaid = true;
                (topStackItem as any).paidAdditionalCost = true;
                (topStackItem as any).additionalCostPaid = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostWasPaid = true;
                  (topStackItem as any).card.paidAdditionalCost = true;
                  (topStackItem as any).card.additionalCostPaid = true;
                }
              }

              // Intervening-if support: "if it was bargained".
              if (bargainResolved === true && typeof wasBargained === 'boolean') {
                (topStackItem as any).bargainResolved = true;
                (topStackItem as any).wasBargained = wasBargained;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.bargainResolved = true;
                  (topStackItem as any).card.wasBargained = wasBargained;
                }
              }

              if (teamworkResolved === true && typeof teamworkWasPaid === 'boolean') {
                (topStackItem as any).teamworkResolved = true;
                (topStackItem as any).teamworkWasPaid = teamworkWasPaid;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.teamworkResolved = true;
                  (topStackItem as any).card.teamworkWasPaid = teamworkWasPaid;
                }
              }

              // Intervening-if support: "if evidence was collected" (Collect evidence additional cost).
              // Be conservative: only set `true` on positive evidence.
              if (evidenceCollected === true) {
                (topStackItem as any).evidenceCollected = true;
                (topStackItem as any).evidenceWasCollected = true;
                (topStackItem as any).collectedEvidence = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.evidenceCollected = true;
                  (topStackItem as any).card.evidenceWasCollected = true;
                  (topStackItem as any).card.collectedEvidence = true;
                }
              }

              const castChosenCreatureType = String(
                (cardInHand as any)?.chosenCreatureType ||
                (targets as any)?.chosenCreatureType ||
                '',
              ).trim();
              if (castChosenCreatureType) {
                (topStackItem as any).chosenCreatureType = castChosenCreatureType;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.chosenCreatureType = castChosenCreatureType;
                }
              }
              debug(1, `[castSpellFromHand] Added converge data to stack item: ${convergeValue} colors (${(topStackItem as any).manaColorsSpent.join(', ')})`);
            } else if (game.state.stack && game.state.stack.length > 0) {
              // Still attach total-mana info for other intervening-if templates.
              const topStackItem = game.state.stack[game.state.stack.length - 1];
              (topStackItem as any).manaSpentTotal = manaSpentTotal;
              (topStackItem as any).manaSpentBreakdown = { ...manaConsumption.consumed };
              if (Array.isArray(payment) && payment.length > 0) {
                (topStackItem as any).manaPayment = payment.map((entry: any) => ({ ...entry }));
              }
              (topStackItem as any).poolBeforeSpellPayment = { ...poolBeforeSpellPayment };
              (topStackItem as any).manaProducedByPermanentBeforePayment = { ...manaProducedByPermanentBeforeSpellPayment };

              // Plumb chosen alternate-cost id onto the stack item so intervening-if clauses can evaluate.
              if (alternateCostId) {
                (topStackItem as any).alternateCostId = alternateCostId;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.alternateCostId = alternateCostId;
                }
              }

              // Convoke contribution (each tapped creature contributes {1}).
              if (Array.isArray(convokeTappedCreatures) && convokeTappedCreatures.length > 0) {
                (topStackItem as any).convokeTappedCreatures = convokeTappedCreatures.slice();
                (topStackItem as any).manaFromCreaturesSpent = convokeTappedCreatures.length;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.convokeTappedCreatures = convokeTappedCreatures.slice();
                  (topStackItem as any).card.manaFromCreaturesSpent = convokeTappedCreatures.length;
                }
              }

              // Best-effort boolean flags for common alternate cost templates.
              const altLower = alternateCostId ? String(alternateCostId).toLowerCase() : '';
              if (altLower) {
                (topStackItem as any).prowlCostWasPaid = altLower === 'prowl';
                (topStackItem as any).surgeCostWasPaid = altLower === 'surge';
                (topStackItem as any).madnessCostWasPaid = altLower === 'madness';
                (topStackItem as any).spectacleCostWasPaid = altLower === 'spectacle';
                (topStackItem as any).warpCostWasPaid = altLower === 'warp';
                (topStackItem as any).dashCostWasPaid = altLower === 'dash';
                (topStackItem as any).blitzCostWasPaid = altLower === 'blitz';
                (topStackItem as any).sneakCostWasPaid = altLower === 'sneak';
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.prowlCostWasPaid = (topStackItem as any).prowlCostWasPaid;
                  (topStackItem as any).card.surgeCostWasPaid = (topStackItem as any).surgeCostWasPaid;
                  (topStackItem as any).card.madnessCostWasPaid = (topStackItem as any).madnessCostWasPaid;
                  (topStackItem as any).card.spectacleCostWasPaid = (topStackItem as any).spectacleCostWasPaid;
                  (topStackItem as any).card.warpCostWasPaid = (topStackItem as any).warpCostWasPaid;
                  (topStackItem as any).card.dashCostWasPaid = (topStackItem as any).dashCostWasPaid;
                  (topStackItem as any).card.blitzCostWasPaid = (topStackItem as any).blitzCostWasPaid;
                  (topStackItem as any).card.sneakCostWasPaid = (topStackItem as any).sneakCostWasPaid;
                }
              }

              // Intervening-if support: "if mana from a Treasure was spent to cast it".
              if (manaFromTreasureSpent === true) {
                (topStackItem as any).manaFromTreasureSpent = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.manaFromTreasureSpent = true;
                }
              }

              // Intervening-if support: "if its additional cost was paid".
              // Deterministic when we know the spell had an additional cost.
              if (additionalCost && typeof additionalCostPaid === 'boolean') {
                (topStackItem as any).additionalCostPaidKnown = true;
                (topStackItem as any).additionalCostPaid = additionalCostPaid === true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostPaidKnown = true;
                  (topStackItem as any).card.additionalCostPaid = additionalCostPaid === true;
                }
                if (additionalCostPaid === true) {
                  (topStackItem as any).additionalCostWasPaid = true;
                  (topStackItem as any).paidAdditionalCost = true;
                  if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                    (topStackItem as any).card.additionalCostWasPaid = true;
                    (topStackItem as any).card.paidAdditionalCost = true;
                  }
                }
              } else if (additionalCostPaid === true) {
                // Legacy positive-only evidence.
                (topStackItem as any).additionalCostWasPaid = true;
                (topStackItem as any).paidAdditionalCost = true;
                (topStackItem as any).additionalCostPaid = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.additionalCostWasPaid = true;
                  (topStackItem as any).card.paidAdditionalCost = true;
                  (topStackItem as any).card.additionalCostPaid = true;
                }
              }

              // Intervening-if support: "if it was bargained".
              if (bargainResolved === true && typeof wasBargained === 'boolean') {
                (topStackItem as any).bargainResolved = true;
                (topStackItem as any).wasBargained = wasBargained;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.bargainResolved = true;
                  (topStackItem as any).card.wasBargained = wasBargained;
                }
              }

              if (teamworkResolved === true && typeof teamworkWasPaid === 'boolean') {
                (topStackItem as any).teamworkResolved = true;
                (topStackItem as any).teamworkWasPaid = teamworkWasPaid;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.teamworkResolved = true;
                  (topStackItem as any).card.teamworkWasPaid = teamworkWasPaid;
                }
              }

              // Intervening-if support: "if evidence was collected" (Collect evidence additional cost).
              // Be conservative: only set `true` on positive evidence.
              if (evidenceCollected === true) {
                (topStackItem as any).evidenceCollected = true;
                (topStackItem as any).evidenceWasCollected = true;
                (topStackItem as any).collectedEvidence = true;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.evidenceCollected = true;
                  (topStackItem as any).card.evidenceWasCollected = true;
                  (topStackItem as any).card.collectedEvidence = true;
                }
              }

              const castChosenCreatureTypeFallback = String(
                (cardInHand as any)?.chosenCreatureType ||
                (targets as any)?.chosenCreatureType ||
                '',
              ).trim();
              if (castChosenCreatureTypeFallback) {
                (topStackItem as any).chosenCreatureType = castChosenCreatureTypeFallback;
                if ((topStackItem as any).card && typeof (topStackItem as any).card === 'object') {
                  (topStackItem as any).card.chosenCreatureType = castChosenCreatureTypeFallback;
                }
              }
            }

            const stampedStackItem = game.state.stack?.[game.state.stack.length - 1] as any;
            if (stampedStackItem) {
              stampReplayedGraveyardCastStackFlags(stampedStackItem, cardInHand);
              if (String((cardInHand as any)?.leaveBattlefieldReplacementDestination || '').trim().toLowerCase() === 'exile') {
                stampedStackItem.leaveBattlefieldReplacementDestination = 'exile';
                if (stampedStackItem.card && typeof stampedStackItem.card === 'object') {
                  stampedStackItem.card.leaveBattlefieldReplacementDestination = 'exile';
                }
              }
              const replacementSourceName = String((cardInHand as any)?.leaveBattlefieldReplacementSourceName || '').trim();
              if (replacementSourceName) {
                stampedStackItem.leaveBattlefieldReplacementSourceName = replacementSourceName;
                if (stampedStackItem.card && typeof stampedStackItem.card === 'object') {
                  stampedStackItem.card.leaveBattlefieldReplacementSourceName = replacementSourceName;
                }
              }
              const replacementLifeGain = Number((cardInHand as any)?.leaveBattlefieldReplacementLifeGain || 0);
              if (replacementLifeGain > 0) {
                stampedStackItem.leaveBattlefieldReplacementLifeGain = replacementLifeGain;
                if (stampedStackItem.card && typeof stampedStackItem.card === 'object') {
                  stampedStackItem.card.leaveBattlefieldReplacementLifeGain = replacementLifeGain;
                }
              }
            }

            // Track per-turn "cast from hand" (best-effort)
            if (castSourceZone === 'hand') {
              game.state.spellsCastFromHandThisTurn = game.state.spellsCastFromHandThisTurn || {};
              game.state.spellsCastFromHandThisTurn[playerId] = (game.state.spellsCastFromHandThisTurn[playerId] || 0) + 1;
            }

            try {
              delete (cardInHand as any).pendingAdditionalCostSacrificeIds;
              const topStackItemAfterCast = game.state.stack?.[game.state.stack.length - 1] as any;
              if (topStackItemAfterCast?.card && typeof topStackItemAfterCast.card === 'object') {
                delete topStackItemAfterCast.card.pendingAdditionalCostSacrificeIds;
              }
            } catch { /* ignore */ }
            debug(2, `[castSpell] Player ${playerId} cast ${cardInHand.name} (${cardId}) from ${castSourceZone} via applyEvent`);

}
