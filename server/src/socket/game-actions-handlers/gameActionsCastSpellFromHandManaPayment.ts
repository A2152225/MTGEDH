/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand mana-source payment (tap/sacrifice
 * permanents, floating-pool picks, haste lower-bound snapshots) from CR 601.2h
 * after Harmonize/Convoke and before consuming the pool.
 *
 * Public entry symbols: tryApplyCastSpellManaPaymentFromHand.
 */
import type { Socket } from "socket.io";
import type { PaymentItem } from "../../../../shared/src/index.js";
import { buildPersistedSacrificedPermanentFields } from "../../state/modules/castIntent.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import {
  addUnselectedFloatingPoolRemainder,
  castSpellPaymentHasExplicitFloatingRefs,
  reserveCastSpellPaymentPermanentId,
  subtractConsumedManaFromSelectedPaymentTotals,
} from "../castSpellPaymentSelectionUtils.js";
import {
  addCastSpellPaymentProducedMana,
  calculateManaProduction,
  consumeManaFromPool,
  getOrInitManaPool,
  parseFloatingPaymentPermanentId,
  parseRemoveCounterActivationCost,
  paymentActivationCostHasUnsupportedAdditionalCosts,
  recordCreatureSpellHasteManaProduced,
  recordManaProducedByPermanentSource,
  resolveActivatedAbilityLineById,
  resolveLegacyManaAbilityById,
  resolvePaymentManaAbilitySpendRestriction,
  resolvePermanentCounterKey,
  restrictedManaSpendRestrictionAllowsPurpose,
  snapshotCreatureSpellHasteManaLowerBound,
  snapshotManaProducedByPermanentLowerBound,
  validateManaPayment,
  type RestrictedManaSpendPurpose,
} from "../util";
import { applyManaAbilityLifeEffectToState, resolveManaAbilityLifeEffect } from "../../state/modules/mana-abilities-handlers/manaAbilitySelfDamage.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { creatureHasHaste } from "./gameActionsPermanentKeywordGrants.js";
import { canCompleteSpellCastAtCurrentTiming } from "./gameActionsSpellCastLock.js";
import {
  getFloatingPaymentPoolKey,
  getPaymentActivationCostInfo,
  getPaymentItemProducedManaTotals,
  getSupportedPaymentActivationManaCost,
  paymentManaAbilityGrantsCreatureSpellHasteUntilEndOfTurn,
  paymentSacrificeCandidateMatches,
  resolvePaymentManaAbilityActivationCost,
  resolveSpellPaymentPermanentId,
  restorePlayerCastSpellPaymentCheckpoint,
  snapshotCastSpellManaPool,
  validateCastSpellPaymentPermanentUsage,
} from "./gameActionsCastSpellPaymentSources.js";
import type { CastSpellPaymentCheckpoint } from "./gameActionsCastSpellFromHandCostConvoke.js";

export type CastSpellManaPaymentFromHandArgs = {
  socket: Socket;
  game: any;
  playerId: string;
  cardId: string;
  cardInHand: any;
  payment: PaymentItem[] | undefined;
  isForceAltCostPaid: boolean;
  existingPool: any;
  abortCastSpellPayment: (payload: { code: string; message: string }) => void;
  castSpellPaymentCheckpoint: CastSpellPaymentCheckpoint;
  restrictedManaPurpose: RestrictedManaSpendPurpose;
  explicitPaymentSelected: boolean;
  skipPriorityCheck: boolean;
  skipInteractivePrompts: boolean;
};

export type CastSpellManaPaymentFromHandContinue = {
  kind: "continue";
  creatureSpellHasteLowerBoundBeforePayment: ReturnType<typeof snapshotCreatureSpellHasteManaLowerBound>;
  producedNonSnowByColor: Record<string, number>;
  producedSnowByColor: Record<string, number>;
  producedTreasureByColor: Record<string, number>;
  producedNonTreasureByColor: Record<string, number>;
  selectedPaymentAvailableTotals: Record<string, number>;
  tappedPaymentPermanents: Set<string>;
  sacrificedPaymentPermanents: Set<string>;
  persistedSacrificedPermanentFields: ReturnType<typeof buildPersistedSacrificedPermanentFields>;
  poolBeforeSpellPayment: any;
  creatureSpellHasteLowerBoundBeforeSpellPayment: ReturnType<typeof snapshotCreatureSpellHasteManaLowerBound>;
  manaProducedByPermanentBeforeSpellPayment: ReturnType<typeof snapshotManaProducedByPermanentLowerBound>;
  allowResolutionModeCompletion: boolean;
};

export function tryApplyCastSpellManaPaymentFromHand(
  args: CastSpellManaPaymentFromHandArgs,
): CastSpellManaPaymentFromHandContinue | void {
  const {
    socket,
    game,
    playerId,
    cardId,
    cardInHand,
    payment,
    isForceAltCostPaid,
    existingPool,
    abortCastSpellPayment,
    castSpellPaymentCheckpoint,
    restrictedManaPurpose,
    explicitPaymentSelected,
    skipPriorityCheck,
    skipInteractivePrompts,
  } = args;


      // ======================================================================
      // Handle mana payment: tap permanents to generate mana (adds to pool)
      // ======================================================================
      const creatureSpellHasteLowerBoundBeforePayment = snapshotCreatureSpellHasteManaLowerBound(game.state, playerId);
      const producedNonSnowByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const producedSnowByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const producedTreasureByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const producedNonTreasureByColor: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };

      const selectedPaymentAvailableTotals: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const tappedPaymentPermanents = new Set<string>();
      const sacrificedPaymentPermanents = new Set<string>();
      let persistedSacrificedPermanentFields: ReturnType<typeof buildPersistedSacrificedPermanentFields> = {};

      if (!isForceAltCostPaid && payment && payment.length > 0) {
        debug(2, `[castSpellFromHand] Processing payment for ${cardInHand.name}:`, payment);

        const duplicatePaymentError = validateCastSpellPaymentPermanentUsage(game, playerId, payment);
        if (duplicatePaymentError) {
          abortCastSpellPayment({ code: 'DUPLICATE_PAYMENT_SOURCE', message: duplicatePaymentError });
          return;
        }
        
        // Get global battlefield (not zones.battlefield which may not exist)
        const globalBattlefield = game.state?.battlefield || [];
        if (!(game as any).zones && game.state?.zones) {
          (game as any).zones = game.state.zones;
        }

        const usedPaymentPermanentIds = new Set<string>();
        const consumePaymentActivationMana = (
          permName: string,
          cost: ReturnType<typeof getSupportedPaymentActivationManaCost>,
        ): boolean => {
          if (!cost) return true;
          const activationPool = getOrInitManaPool(game.state, playerId) as any;
          const activationValidationError = validateManaPayment(
            snapshotCastSpellManaPool(activationPool),
            cost.colors,
            cost.generic,
          );
          if (activationValidationError) {
            abortCastSpellPayment({
              code: 'INSUFFICIENT_MANA',
              message: `${permName} requires additional mana to activate. ${activationValidationError}`,
            });
            return false;
          }

          const activationConsumption = consumeManaFromPool(
            activationPool,
            cost.colors,
            cost.generic,
            `[castSpellFromHand][paymentActivationCost:${permName}]`,
          );
          subtractConsumedManaFromSelectedPaymentTotals(
            selectedPaymentAvailableTotals,
            activationConsumption.consumed,
          );
          return true;
        };

        // Process each payment item: apply the mana ability cost, then add mana to pool
        for (let paymentIdx = 0; paymentIdx < payment.length; paymentIdx++) {
          let { permanentId, mana, count, abilityId, sacrificedPermanentIds, producedColors } = payment[paymentIdx];
          const floatingPoolKey = getFloatingPaymentPoolKey(String(permanentId || ''), String(mana || ''), existingPool);
          if (floatingPoolKey && parseFloatingPaymentPermanentId(String(permanentId || ''))) {
            const amount = Math.max(1, Number(count || 1));
            selectedPaymentAvailableTotals[floatingPoolKey] = (selectedPaymentAvailableTotals[floatingPoolKey] || 0) + amount;
            continue;
          }

          const resolvedPermanentId = resolveSpellPaymentPermanentId(
            game,
            playerId,
            String(permanentId || ''),
            usedPaymentPermanentIds,
            {
              requireUntappedForTapAbility: true,
              mana: String(mana || ''),
              abilityId,
            },
          );
          if (!resolvedPermanentId || parseFloatingPaymentPermanentId(resolvedPermanentId)) {
            abortCastSpellPayment({
              code: 'PAYMENT_SOURCE_NOT_FOUND',
              message: `Permanent ${permanentId} not found on battlefield`,
            });
            return;
          }
          permanentId = resolvedPermanentId;
          payment[paymentIdx].permanentId = resolvedPermanentId;

          const permanent = globalBattlefield.find((p: any) => p?.id === permanentId && p?.controller === playerId);
          
          if (!permanent) {
            abortCastSpellPayment({
              code: 'PAYMENT_SOURCE_NOT_FOUND',
              message: `Permanent ${permanentId} not found on battlefield`,
            });
            return;
          }
          
          const permCard = (permanent as any).card || {};
          const permTypeLine = (permCard.type_line || "").toLowerCase();
          const permIsCreature = /\bcreature\b/.test(permTypeLine);
          const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana, abilityId);
          const activationCostText = String(
            manaInfo.activationCost || resolvePaymentManaAbilityActivationCost(permanent, String(mana || ''), abilityId)
          ).trim();
          const activationCostInfo = getPaymentActivationCostInfo(
            permanent,
            activationCostText
          );
          reserveCastSpellPaymentPermanentId(usedPaymentPermanentIds, resolvedPermanentId, activationCostInfo.taps);
          const activationManaCost = getSupportedPaymentActivationManaCost(activationCostText);
          const manaGrantsCreatureSpellHasteUntilEndOfTurn = paymentManaAbilityGrantsCreatureSpellHasteUntilEndOfTurn(permanent, abilityId);

          if (paymentActivationCostHasUnsupportedAdditionalCosts(activationCostText, String(permCard.name || ''))) {
            abortCastSpellPayment({
              code: 'UNSUPPORTED_PAYMENT_SOURCE_COST',
              message: `${permCard.name || 'Permanent'} requires an unsupported additional activation cost for spell payment.`,
            });
            return;
          }

          const removeCounterCost = parseRemoveCounterActivationCost(
            activationCostText,
            String(permCard.name || ''),
          );
          if (removeCounterCost) {
            if (!removeCounterCost.refersToSource) {
              abortCastSpellPayment({
                code: 'UNSUPPORTED_PAYMENT_SOURCE_COST',
                message: `${permCard.name || 'Permanent'} requires removing counters from another permanent for mana payment.`,
              });
              return;
            }

            const counterKey = resolvePermanentCounterKey(permanent, removeCounterCost.counterType, removeCounterCost.count);
            const available = counterKey ? Number((permanent as any).counters?.[counterKey] || 0) : 0;
            if (!counterKey || available < removeCounterCost.count) {
              abortCastSpellPayment({
                code: 'INSUFFICIENT_COUNTERS',
                message: `${permCard.name || 'Permanent'} doesn't have enough ${removeCounterCost.counterType} counter(s) for mana payment.`,
              });
              return;
            }

            castSpellPaymentCheckpoint.removedCounters.push({
              permanentId: String(permanentId),
              counterType: counterKey,
              previousAmount: available,
            });
            (permanent as any).counters = (permanent as any).counters || {};
            const next = available - removeCounterCost.count;
            if (next > 0) (permanent as any).counters[counterKey] = next;
            else delete (permanent as any).counters[counterKey];
          }

          if (activationCostInfo.taps) {
            const tapPermanentId = String(permanentId || '');
            if (tappedPaymentPermanents.has(tapPermanentId)) {
              abortCastSpellPayment({
                code: 'DUPLICATE_PAYMENT_SOURCE',
                message: `${permCard.name || 'Permanent'} cannot be tapped more than once to pay for this spell.`,
              });
              return;
            }
          }

          if (activationCostInfo.taps && (permanent as any).tapped) {
            abortCastSpellPayment({
              code: 'PAYMENT_SOURCE_TAPPED',
              message: `${(permanent as any).card?.name || 'Permanent'} is already tapped`,
            });
            return;
          }
          
          if (activationCostInfo.taps) {
            const hasHaste = creatureHasHaste(permanent, globalBattlefield, playerId);
            if (permIsCreature && (permanent as any).summoningSickness && !hasHaste) {
              abortCastSpellPayment({
                code: 'SUMMONING_SICKNESS',
                message: `${permCard.name || 'Creature'} has summoning sickness and cannot use tap abilities this turn`,
              });
              return;
            }
          }

          const selectedSacrifices = activationCostInfo.sacrificeRequirement && activationCostInfo.selfSacrifices !== true
            ? Array.from(new Set((Array.isArray(sacrificedPermanentIds) ? sacrificedPermanentIds : []).map((id) => String(id || '').trim()).filter(Boolean)))
            : [];

          if (activationCostInfo.sacrificeRequirement && activationCostInfo.selfSacrifices !== true) {
            const requiredCount = Math.max(1, Number(activationCostInfo.sacrificeRequirement.sacrificeCount || 1));
            if (selectedSacrifices.length !== requiredCount) {
              abortCastSpellPayment({
                code: 'INVALID_PAYMENT_SACRIFICE_SELECTION',
                message: `${permCard.name || 'Permanent'} requires sacrificing ${requiredCount} permanent(s) to produce mana.`,
              });
              return;
            }

            for (const sacrificedId of selectedSacrifices) {
              const sacrificeCandidate = globalBattlefield.find((entry: any) => entry?.id === sacrificedId && entry?.controller === playerId);
              if (!sacrificeCandidate || !paymentSacrificeCandidateMatches(sacrificeCandidate, String(permanentId), playerId, activationCostInfo.sacrificeRequirement)) {
                abortCastSpellPayment({
                  code: 'INVALID_PAYMENT_SACRIFICE_TARGET',
                  message: `${permCard.name || 'Permanent'} cannot sacrifice the selected permanent for mana.`,
                });
                return;
              }
              if (sacrificedPaymentPermanents.has(String(sacrificedId))) {
                abortCastSpellPayment({
                  code: 'DUPLICATE_PAYMENT_SACRIFICE',
                  message: 'A permanent cannot be sacrificed more than once to pay for this spell.',
                });
                return;
              }
            }

            if (!consumePaymentActivationMana(String(permCard.name || permanentId), activationManaCost)) {
              return;
            }

            if (activationCostInfo.taps) {
              (permanent as any).tapped = true;
              tappedPaymentPermanents.add(String(permanentId));
              castSpellPaymentCheckpoint.tappedPermanentIds.add(String(permanentId));
            }

            for (const sacrificedId of selectedSacrifices) {
              const sacrificedName = sacrificePermanent(game as any, sacrificedId, playerId);
              if (!sacrificedName) {
                abortCastSpellPayment({
                  code: 'PAYMENT_SACRIFICE_FAILED',
                  message: 'Failed to sacrifice a selected permanent for mana payment.',
                });
                return;
              }
              sacrificedPaymentPermanents.add(String(sacrificedId));
            }
          } else {
            if (!consumePaymentActivationMana(String(permCard.name || permanentId), activationManaCost)) {
              return;
            }

            if (activationCostInfo.taps) {
              (permanent as any).tapped = true;
              tappedPaymentPermanents.add(String(permanentId));
              castSpellPaymentCheckpoint.tappedPermanentIds.add(String(permanentId));
            }
          }

          if (activationCostInfo.selfSacrifices) {
            const sacrificedName = sacrificePermanent(game as any, String(permanentId), playerId);
            if (!sacrificedName) {
              abortCastSpellPayment({
                code: 'PAYMENT_SOURCE_SACRIFICE_FAILED',
                message: `Failed to sacrifice ${(permanent as any).card?.name || 'payment source'} for mana payment.`,
              });
              return;
            }
            sacrificedPaymentPermanents.add(String(permanentId));
          }

          const typeLineLower = String(((permanent as any).card || {})?.type_line || '').toLowerCase();
          const isSnowSource = /\bsnow\b/.test(typeLineLower);
          const isTreasureSource = /\btreasure\b/.test(typeLineLower);
          
          // Add mana to player's mana pool (already initialized via getOrInitManaPool above)
          const manaColorMap: Record<string, string> = {
            'W': 'white',
            'U': 'blue',
            'B': 'black',
            'R': 'red',
            'G': 'green',
            'C': 'colorless',
          };
          
          // Calculate actual mana production considering:
          // - Fixed multi-mana (Sol Ring: {C}{C})
          // - Dynamic mana (Gaea's Cradle, Wirewood Channeler)
          // - Land enchantments (Wild Growth, Overgrowth)
          // - Global effects (Caged Sun, Mana Reflection, Mirari's Wake)
          const producedAmount = count !== undefined && count !== null
            ? Math.max(Number(count) || 0, Number(manaInfo.totalAmount || 0))
            : Number(manaInfo.totalAmount || 0);
          const explicitProducedManaTotals = Array.isArray(producedColors) && producedColors.length > 0
            ? getPaymentItemProducedManaTotals(mana, producedAmount, producedColors)
            : undefined;
          const spendRestriction = resolvePaymentManaAbilitySpendRestriction(
            game.state,
            permanent,
            playerId,
            abilityId,
          );
          if (
            spendRestriction &&
            !restrictedManaSpendRestrictionAllowsPurpose(spendRestriction, restrictedManaPurpose)
          ) {
            abortCastSpellPayment({
              code: 'INVALID_RESTRICTED_MANA',
              message: `${permCard.name || 'Permanent'} produces mana that cannot be spent to cast ${cardInHand.name}.`,
            });
            return;
          }
          
          const poolKey = manaColorMap[mana];
          if (explicitProducedManaTotals) {
            const explicitProducedAmount = Object.values(explicitProducedManaTotals).reduce(
              (sum: number, value) => sum + (typeof value === 'number' ? value : 0),
              0,
            );

            if (explicitProducedAmount <= 0) {
              abortCastSpellPayment({
                code: 'INVALID_PAYMENT_SOURCE_OUTPUT',
                message: `${permCard.name || 'Permanent'} did not produce any usable mana for spell payment.`,
              });
              return;
            }

            addCastSpellPaymentProducedMana(
              game.state,
              playerId,
              game.state.manaPool[playerId],
              selectedPaymentAvailableTotals,
              explicitProducedManaTotals,
              spendRestriction,
              { id: String(permanentId || ''), name: String(permCard.name || '') },
            );

            for (const [explicitPoolKey, amount] of Object.entries(explicitProducedManaTotals)) {
              if (amount <= 0) continue;
              if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
                recordCreatureSpellHasteManaProduced(game.state, String(playerId), String(explicitPoolKey) as any, amount);
              }
              recordManaProducedByPermanentSource(game.state, String(playerId), String(permanentId || ''), String(explicitPoolKey) as any, amount);
              if (isSnowSource) {
                producedSnowByColor[explicitPoolKey] = (producedSnowByColor[explicitPoolKey] || 0) + amount;
              } else {
                producedNonSnowByColor[explicitPoolKey] = (producedNonSnowByColor[explicitPoolKey] || 0) + amount;
              }
              if (isTreasureSource) {
                producedTreasureByColor[explicitPoolKey] = (producedTreasureByColor[explicitPoolKey] || 0) + amount;
              } else {
                producedNonTreasureByColor[explicitPoolKey] = (producedNonTreasureByColor[explicitPoolKey] || 0) + amount;
              }
              debug(2, `[castSpellFromHand] Added ${amount} ${explicitPoolKey} mana to ${playerId}'s pool from ${(permanent as any).card?.name || permanentId}`);
            }
          } else if (poolKey && producedAmount > 0) {
            addCastSpellPaymentProducedMana(
              game.state,
              playerId,
              game.state.manaPool[playerId],
              selectedPaymentAvailableTotals,
              { [poolKey]: producedAmount },
              spendRestriction,
              { id: String(permanentId || ''), name: String(permCard.name || '') },
            );
            if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
              recordCreatureSpellHasteManaProduced(game.state, String(playerId), String(poolKey) as any, producedAmount);
            }
            recordManaProducedByPermanentSource(game.state, String(playerId), String(permanentId || ''), String(poolKey) as any, producedAmount);
            if (isSnowSource) {
              producedSnowByColor[poolKey] = (producedSnowByColor[poolKey] || 0) + producedAmount;
            } else {
              producedNonSnowByColor[poolKey] = (producedNonSnowByColor[poolKey] || 0) + producedAmount;
            }
            if (isTreasureSource) {
              producedTreasureByColor[poolKey] = (producedTreasureByColor[poolKey] || 0) + producedAmount;
            } else {
              producedNonTreasureByColor[poolKey] = (producedNonTreasureByColor[poolKey] || 0) + producedAmount;
            }
            debug(2, `[castSpellFromHand] Added ${producedAmount} ${mana} mana to ${playerId}'s pool from ${(permanent as any).card?.name || permanentId}`);
          }

          for (const bonus of Array.isArray(manaInfo.bonusMana) ? manaInfo.bonusMana : []) {
            if (explicitProducedManaTotals) {
              continue;
            }

            const bonusPoolKey = manaColorMap[bonus.color];
            if (!bonusPoolKey || bonus.amount <= 0 || String(bonus.color || '').toUpperCase() === 'ANY' || ((count !== undefined && count !== null) && bonusPoolKey === poolKey)) {
              continue;
            }

            addCastSpellPaymentProducedMana(
              game.state,
              playerId,
              game.state.manaPool[playerId],
              selectedPaymentAvailableTotals,
              { [bonusPoolKey]: bonus.amount },
              spendRestriction,
              { id: String(permanentId || ''), name: String(permCard.name || '') },
            );
            if (manaGrantsCreatureSpellHasteUntilEndOfTurn) {
              recordCreatureSpellHasteManaProduced(game.state, String(playerId), String(bonusPoolKey) as any, bonus.amount);
            }
            recordManaProducedByPermanentSource(game.state, String(playerId), String(permanentId || ''), String(bonusPoolKey) as any, bonus.amount);
            if (isSnowSource) {
              producedSnowByColor[bonusPoolKey] = (producedSnowByColor[bonusPoolKey] || 0) + bonus.amount;
            } else {
              producedNonSnowByColor[bonusPoolKey] = (producedNonSnowByColor[bonusPoolKey] || 0) + bonus.amount;
            }
            if (isTreasureSource) {
              producedTreasureByColor[bonusPoolKey] = (producedTreasureByColor[bonusPoolKey] || 0) + bonus.amount;
            } else {
              producedNonTreasureByColor[bonusPoolKey] = (producedNonTreasureByColor[bonusPoolKey] || 0) + bonus.amount;
            }
            debug(2, `[castSpellFromHand] Added ${bonus.amount} ${bonus.color} bonus mana from enchantments/effects`);
          }

          const manaLifeEffect = resolveManaAbilityLifeEffect({
            card: permCard,
            ability: resolveLegacyManaAbilityById(game.state, permanent, playerId, abilityId),
            abilityText: resolveActivatedAbilityLineById(permanent, abilityId)?.lineText,
            producesColoredMana: String(mana || '').toUpperCase() !== 'C',
          });
          applyManaAbilityLifeEffectToState(game.state, playerId, manaLifeEffect);
        }
      }

      if (explicitPaymentSelected && !castSpellPaymentHasExplicitFloatingRefs(payment)) {
        addUnselectedFloatingPoolRemainder(
          selectedPaymentAvailableTotals,
          snapshotCastSpellManaPool(getOrInitManaPool(game.state, playerId)),
          selectedPaymentAvailableTotals,
        );
      }

      const poolBeforeSpellPayment = { ...getOrInitManaPool(game.state, playerId) } as any;
      const creatureSpellHasteLowerBoundBeforeSpellPayment = snapshotCreatureSpellHasteManaLowerBound(game.state, playerId);
      const manaProducedByPermanentBeforeSpellPayment = snapshotManaProducedByPermanentLowerBound(game.state, playerId);

      const allowResolutionModeCompletion = skipPriorityCheck === true && skipInteractivePrompts === true;
      if (!canCompleteSpellCastAtCurrentTiming(game, playerId, allowResolutionModeCompletion)) {
        restorePlayerCastSpellPaymentCheckpoint(game, playerId, {
          pool: castSpellPaymentCheckpoint.pool,
          tappedPermanentIds: castSpellPaymentCheckpoint.tappedPermanentIds,
          harmonizePermanentId: castSpellPaymentCheckpoint.harmonizePermanentId,
          removedCounters: castSpellPaymentCheckpoint.removedCounters,
        });
        debugWarn(
          1,
          `[castSpellFromHand] Aborting cast of ${cardInHand.name} (${cardId}) � cast timing lost (priority=${String(game.state.priority)}, player=${playerId})`,
        );
        socket.emit('error', {
          code: 'CAST_TIMING_LOST',
          message: 'Cannot finish casting this spell because priority was lost.',
        });
        return;
      }

  return {
    kind: "continue",
    creatureSpellHasteLowerBoundBeforePayment,
    producedNonSnowByColor,
    producedSnowByColor,
    producedTreasureByColor,
    producedNonTreasureByColor,
    selectedPaymentAvailableTotals,
    tappedPaymentPermanents,
    sacrificedPaymentPermanents,
    persistedSacrificedPermanentFields,
    poolBeforeSpellPayment,
    creatureSpellHasteLowerBoundBeforeSpellPayment,
    manaProducedByPermanentBeforeSpellPayment,
    allowResolutionModeCompletion,
  };
}
