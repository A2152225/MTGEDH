/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: handleCastSpellFromHand cost assembly (alternate costs, X,
 * reductions) plus Harmonize/Convoke/sneak/web-slinging payment setup
 * (CR 601.2f-h) before tapping mana sources.
 *
 * Public entry symbols: tryAssembleCastSpellCostAndConvokeFromHand.
 */
import type { Server, Socket } from "socket.io";
import type { PaymentItem, PlayerID } from "../../../../shared/src/index.js";
import {
  canUseFreeAlternateCost,
  getSelfRatherThanPayAlternateManaCost,
  parseKeywordAlternateManaCost,
  parseMadnessCost,
  parseMutateCost,
  parseWarpCost,
} from "../../state/modules/alternate-costs.js";
import { spellHasConvokeForCast } from "../../state/modules/casting-modifiers.js";
import {
  applyWebSlingingReturnedCreatureCost,
  parseWebSlingingCost,
  validateWebSlingingReturnedCreature,
} from "../../state/modules/keywordCastMechanics.js";
import {
  expandManaCostWithMultikicker,
  parseMultikickerManaCost,
} from "../../state/modules/multikickerCastUtils.js";
import {
  applySneakReturnedCreatureCost,
  canCastWithSneakAtCurrentTiming,
  parseSneakCost,
  validateSneakReturnedCreature,
} from "../../state/modules/sneakCastUtils.js";
import {
  addUnselectedFloatingPoolRemainder,
  castSpellPaymentHasExplicitFloatingRefs,
  reserveCastSpellPaymentPermanentId,
} from "../castSpellPaymentSelectionUtils.js";
import {
  buildManaTotalsIncludingEligibleRestricted,
  calculateManaProduction,
  getEffectivePower,
  getOrInitManaPool,
  getPlayerName,
  MANA_COLOR_NAMES,
  parseFloatingPaymentPermanentId,
  parseManaCost,
  resolvePaymentManaAbilitySpendRestriction,
  restrictedManaSpendRestrictionAllowsPurpose,
  validateManaPayment,
  validateSelectedFloatingPoolMana,
  type RestrictedManaSpendPurpose,
} from "../util";
import { debug } from "../../utils/debug.js";
import {
  getRecordedSquadTimesPaid,
  getSquadAdditionalManaCost,
} from "./gameActionsAdditionalCastCosts.js";
import {
  checkMiracle,
  getSuspendCastInfo,
} from "./gameActionsCastFaceAndMiracleSelection.js";
import {
  applyCostAdjustment,
  buildPendingCastCostMetadata,
  expandManaCostWithChosenX,
} from "./gameActionsCastCostFormatting.js";
import type { SpellCastSourceZone } from "./gameActionsCastCostReduction.js";
import {
  CAST_SPELL_PAYMENT_MANA_KEYS,
  addCastSpellManaTotals,
  cardCanSpendManaAsAnyType,
  getFloatingPaymentPoolKey,
  getPaymentActivationCostInfo,
  getPaymentItemProducedManaTotals,
  normalizeParsedSpellCostForAnyTypeManaSpending,
  resolvePaymentManaAbilityActivationCost,
  resolveSpellPaymentPermanentId,
  restorePlayerCastSpellPaymentCheckpoint,
  snapshotCastSpellManaPool,
} from "./gameActionsCastSpellPaymentSources.js";
import { appendManaCost } from "./gameActionsModalCastModeCosts.js";

export type CastSpellCostConvokeFromHandArgs = {
  io: Server;
  socket: Socket;
  game: any;
  gameId: string;
  playerId: string;
  cardInHand: any;
  alternateCostId: string | undefined;
  isForceAltCostRequested: boolean;
  overloadRequested: boolean;
  commandZoneManaCost: string | undefined;
  spellModeAdditionalCost: any;
  resolvedTimesKicked: number | undefined;
  xValue: number | undefined;
  payment: PaymentItem[] | undefined;
  castSourceZone: SpellCastSourceZone;
  harmonizeTappedCreatureId: string | undefined;
  sneakReturnedCreatureId: string | undefined;
  webSlingingReturnedCreatureId: string | undefined;
  convokeTappedCreatures: string[] | undefined;
};

export type CastSpellPaymentCheckpoint = {
  pool: any;
  tappedPermanentIds: Set<string>;
  harmonizePermanentId: string | undefined;
  removedCounters: Array<{ permanentId: string; counterType: string; previousAmount: number }>;
};

export type CastSpellCostConvokeFromHandContinue = {
  kind: "continue";
  isForceAltCostPaid: boolean;
  abortCastSpellPayment: (payload: { code: string; message: string }) => void;
  existingPool: any;
  castSpellPaymentCheckpoint: CastSpellPaymentCheckpoint;
  restrictedManaPurpose: RestrictedManaSpendPurpose;
  explicitPaymentSelected: boolean;
  totalColored: Record<string, number>;
  totalGeneric: number;
  castingCreatureSpell: boolean;
  poolBeforePayment: any;
  suspendInfo: ReturnType<typeof getSuspendCastInfo>;
  resolvedSuspendCost: string;
};

export function tryAssembleCastSpellCostAndConvokeFromHand(
  args: CastSpellCostConvokeFromHandArgs,
): CastSpellCostConvokeFromHandContinue | void {
  const {
    io,
    socket,
    game,
    gameId,
    playerId,
    cardInHand,
    alternateCostId,
    isForceAltCostRequested,
    overloadRequested,
    commandZoneManaCost,
    spellModeAdditionalCost,
    resolvedTimesKicked,
    xValue,
    payment,
    castSourceZone,
    harmonizeTappedCreatureId,
    sneakReturnedCreatureId,
    webSlingingReturnedCreatureId,
    convokeTappedCreatures,
  } = args;

      // If Force-style alternate cost was chosen and paid, the mana cost is treated as {0}.
      // We must not tap mana or consume floating mana.
      const isForceAltCostPaid = isForceAltCostRequested && (cardInHand as any).forceAltCostPaid === true;
      const isFreeCast = alternateCostId === 'free' || (cardInHand as any).castWithoutPayingManaCost === true;
      if (isFreeCast && !canUseFreeAlternateCost(game as any, playerId, cardInHand)) {
        socket.emit('error', {
          code: 'INVALID_ALTERNATE_COST',
          message: `${String(cardInHand?.name || 'That spell')} cannot be cast without paying its mana cost.`,
        });
        return;
      }
      const usesWubrgAlternateCost = alternateCostId === 'wubrg_self' || alternateCostId === 'wubrg_external';
      const resolvedMiracleCost = alternateCostId === 'miracle'
        ? (checkMiracle(cardInHand).miracleCost || '')
        : '';
      const resolvedMadnessCost = alternateCostId === 'madness'
        ? (parseMadnessCost(String(cardInHand.oracle_text || '')) || '')
        : '';
      const resolvedMutateCost = alternateCostId === 'mutate'
        ? (String((cardInHand as any).mutateCost || '') || parseMutateCost(String(cardInHand.oracle_text || '')) || '')
        : '';
      const resolvedWarpCost = alternateCostId === 'warp'
        ? (parseWarpCost(String(cardInHand.oracle_text || '')) || '')
        : '';
      const resolvedKeywordAlternateCost = (!resolvedWarpCost && alternateCostId && alternateCostId !== 'normal' && alternateCostId !== 'alternate')
        ? (parseKeywordAlternateManaCost(String(cardInHand.oracle_text || ''), alternateCostId) || '')
        : '';
      const resolvedRatherThanPayCost = alternateCostId === 'alternate'
        ? (getSelfRatherThanPayAlternateManaCost(game as any, playerId, cardInHand) || '')
        : '';
      if (alternateCostId === 'alternate' && !resolvedRatherThanPayCost) {
        socket.emit('error', {
          code: 'INVALID_ALTERNATE_COST',
          message: `${String(cardInHand?.name || 'That spell')} alternate cost is not available.`,
        });
        return;
      }
      const resolvedOverloadCost = overloadRequested
        ? String((cardInHand as any).overloadCost || '') || (() => {
            const match = String((cardInHand as any).oracle_text || '').match(/overload\s*\{([^}]+)\}/i);
            return match ? `{${match[1]}}` : '';
          })()
        : '';
      const suspendInfo = alternateCostId === 'suspend'
        ? getSuspendCastInfo(cardInHand)
        : { hasSuspend: false, suspendCost: '', timeCounters: 0 };
      const resolvedSuspendCost = alternateCostId === 'suspend'
        ? String(suspendInfo.suspendCost || '')
        : '';

      const battlefieldPermanents = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      let selectedHarmonizeCreature: any | undefined;
      let harmonizeGenericReduction = 0;
      if (String((cardInHand as any).castWithAbility || '').trim().toLowerCase() === 'harmonize' && harmonizeTappedCreatureId) {
        selectedHarmonizeCreature = battlefieldPermanents.find((permanent: any) =>
          permanent
          && String(permanent.id || '') === String(harmonizeTappedCreatureId)
          && String(permanent.controller || '') === String(playerId)
        );

        if (!selectedHarmonizeCreature) {
          socket.emit('error', {
            code: 'HARMONIZE_CREATURE_NOT_FOUND',
            message: 'Selected Harmonize creature not found on the battlefield.',
          });
          return;
        }

        if ((selectedHarmonizeCreature as any).tapped === true) {
          socket.emit('error', {
            code: 'HARMONIZE_CREATURE_TAPPED',
            message: `${String(selectedHarmonizeCreature?.card?.name || 'Creature')} is already tapped.`,
          });
          return;
        }

        if (!String(selectedHarmonizeCreature?.card?.type_line || '').toLowerCase().includes('creature')) {
          socket.emit('error', {
            code: 'HARMONIZE_NOT_CREATURE',
            message: `${String(selectedHarmonizeCreature?.card?.name || 'Permanent')} is not a creature.`,
          });
          return;
        }

        harmonizeGenericReduction = Math.max(0, Number(getEffectivePower(selectedHarmonizeCreature) || 0));
        (cardInHand as any).harmonizeTappedCreatureId = String(harmonizeTappedCreatureId);
        (cardInHand as any).harmonizeTappedCreatureName = String(selectedHarmonizeCreature?.card?.name || 'Creature');
        (cardInHand as any).harmonizeGenericReduction = harmonizeGenericReduction;
      }

      if (alternateCostId === 'sneak') {
        if (!parseSneakCost(String(cardInHand.oracle_text || ''))) {
          socket.emit('error', { code: 'NO_SNEAK', message: 'This card does not have sneak.' });
          return;
        }
        if (!canCastWithSneakAtCurrentTiming(game, playerId, cardInHand)) {
          socket.emit('error', {
            code: 'SNEAK_TIMING',
            message: 'Sneak can only be used during your declare blockers step with an unblocked attacking creature you control.',
          });
          return;
        }
        const sneakValidation = validateSneakReturnedCreature(game.state, playerId as PlayerID, String(sneakReturnedCreatureId || ''));
        if (sneakValidation.ok === false) {
          socket.emit('error', { code: sneakValidation.code, message: sneakValidation.message });
          return;
        }
        (cardInHand as any).sneakReturnedCreatureId = String(sneakReturnedCreatureId || '');
        (cardInHand as any).sneakAttackTarget = sneakValidation.attackTarget;
        (cardInHand as any).sneakCostWasPaid = true;
      }

      if (alternateCostId === 'web_slinging') {
        if (!parseWebSlingingCost(String(cardInHand.oracle_text || ''))) {
          socket.emit('error', { code: 'NO_WEB_SLINGING', message: 'This card does not have web-slinging.' });
          return;
        }
        const webSlingingValidation = validateWebSlingingReturnedCreature(
          game.state,
          playerId as PlayerID,
          String(webSlingingReturnedCreatureId || ''),
        );
        if (webSlingingValidation.ok === false) {
          socket.emit('error', { code: webSlingingValidation.code, message: webSlingingValidation.message });
          return;
        }
        (cardInHand as any).webSlingingReturnedCreatureId = String(webSlingingReturnedCreatureId);
        (cardInHand as any).webSlingingCostWasPaid = true;
      }

      if (alternateCostId === 'miracle' && !resolvedMiracleCost) {
        socket.emit('error', { code: 'NO_MIRACLE', message: 'This card does not have miracle.' });
        return;
      }
      if (alternateCostId === 'madness' && !resolvedMadnessCost) {
        socket.emit('error', { code: 'NO_MADNESS', message: 'This card does not have madness.' });
        return;
      }
      if (alternateCostId === 'mutate' && !resolvedMutateCost) {
        socket.emit('error', { code: 'NO_MUTATE', message: 'This card does not have mutate.' });
        return;
      }
      if (alternateCostId === 'warp' && !resolvedWarpCost) {
        socket.emit('error', { code: 'NO_WARP', message: 'This card does not have warp.' });
        return;
      }
      if (alternateCostId === 'suspend') {
        if (castSourceZone !== 'hand') {
          socket.emit('error', { code: 'INVALID_SUSPEND_ZONE', message: 'You can only suspend a card from your hand.' });
          return;
        }
        if (!suspendInfo.hasSuspend || !resolvedSuspendCost || suspendInfo.timeCounters <= 0) {
          socket.emit('error', { code: 'NO_SUSPEND', message: 'This card does not have a valid suspend cost.' });
          return;
        }
      }

      // Parse the mana cost to validate payment
      const graveyardCastManaCost = castSourceZone === 'graveyard'
        ? String((cardInHand as any).graveyardCastManaCost || '')
        : '';
      const rawManaCost = appendManaCost(
        (isForceAltCostPaid || isFreeCast)
          ? ''
          : resolvedSuspendCost
            ? resolvedSuspendCost
          : usesWubrgAlternateCost
            ? '{W}{U}{B}{R}{G}'
            : resolvedMiracleCost
              ? resolvedMiracleCost
              : resolvedMadnessCost
                ? resolvedMadnessCost
                : resolvedMutateCost
                  ? resolvedMutateCost
                  : resolvedWarpCost
                    ? resolvedWarpCost
                    : resolvedRatherThanPayCost
                      ? resolvedRatherThanPayCost
                    : resolvedKeywordAlternateCost
                      ? resolvedKeywordAlternateCost
                  : resolvedOverloadCost
                    ? resolvedOverloadCost
                    : (castSourceZone === 'command' ? (commandZoneManaCost || '') : (graveyardCastManaCost || cardInHand.mana_cost || "")),
        spellModeAdditionalCost,
      );
      const manaCost = appendManaCost(
        expandManaCostWithMultikicker(
          expandManaCostWithChosenX(rawManaCost, xValue),
          parseMultikickerManaCost(String(cardInHand?.oracle_text || '')),
          resolvedTimesKicked ?? 0,
        ),
        getSquadAdditionalManaCost(String(cardInHand?.oracle_text || ''), getRecordedSquadTimesPaid(cardInHand)),
      );
      const parsedCost = parseManaCost(manaCost);
      
      // Calculate cost reduction from battlefield effects
      const paymentMetadata = buildPendingCastCostMetadata(game, playerId, cardInHand, castSourceZone);
      const costReduction = paymentMetadata.costReduction;
      const genericCostTax = paymentMetadata.genericCostTax;
      if (harmonizeGenericReduction > 0) {
        costReduction.generic += harmonizeGenericReduction;
        costReduction.messages.push(`Harmonize: -{${harmonizeGenericReduction}} (${String((cardInHand as any).harmonizeTappedCreatureName || 'selected creature')})`);
      }
      
      // Apply cost reduction
      const reducedCost = castSourceZone === 'command'
        ? parsedCost
        : applyCostAdjustment(parsedCost, costReduction, genericCostTax);
      const payableCost = cardCanSpendManaAsAnyType(cardInHand)
        ? normalizeParsedSpellCostForAnyTypeManaSpending(reducedCost)
        : reducedCost;
      
      // Log cost reduction if any
      if (costReduction.messages.length > 0) {
        debug(1, `[castSpellFromHand] Cost reduction for ${cardInHand.name}: ${costReduction.messages.join(", ")}`);
        debug(2, `[castSpellFromHand] Original cost: ${rawManaCost}, Concrete cost: ${manaCost}, Reduced generic: ${parsedCost.generic} -> ${reducedCost.generic}`);
      }
      
      // Calculate total mana cost for spell from hand (using reduced cost)
      const totalGeneric = payableCost.generic;
      const totalColored = payableCost.colors;
      const castingTypeLine = String(cardInHand?.type_line || '').toLowerCase();
      const castingCreatureSpell = castingTypeLine.includes('creature');
      const castingArtifactSpell = castingTypeLine.includes('artifact');
      const restrictedManaPurpose: RestrictedManaSpendPurpose = {
        spellCard: cardInHand,
        ...(castingCreatureSpell ? { isCreature: true } : {}),
        ...(castingArtifactSpell ? { isArtifact: true } : {}),
        ...(castSourceZone === 'command' ? { isCommander: true } : {}),
      };
      
      // Get existing mana pool (floating mana from previous spells)
      const existingPool = getOrInitManaPool(game.state, playerId);
      
      // Calculate total available mana using calculateManaProduction to account for 
      // mana-increasing effects (Wild Growth, Mana Reflection, Caged Sun, etc.)
      const globalBattlefield = game.state?.battlefield || [];
      const explicitPaymentSelected = Boolean(payment && payment.length > 0);
      const totalAvailable: Record<string, number> = explicitPaymentSelected
        ? { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 }
        : {
            white: existingPool.white || 0,
            blue: existingPool.blue || 0,
            black: existingPool.black || 0,
            red: existingPool.red || 0,
            green: existingPool.green || 0,
            colorless: existingPool.colorless || 0,
          };
      const selectedFloatingMana: Record<string, number> = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
      const selectedFloatingRestricted: Record<number, number> = {};
      
      // Add mana from payment sources, using calculateManaProduction for accurate amounts
      if (payment && payment.length > 0) {
        const projectedTapPermanentIds = new Set<string>();
        const usedPaymentPermanentIds = new Set<string>();
        for (const { permanentId, mana, count, abilityId, producedColors } of payment) {
          const floatingRef = parseFloatingPaymentPermanentId(String(permanentId || ''));
          const floatingPoolKey = getFloatingPaymentPoolKey(String(permanentId || ''), String(mana || ''), existingPool);
          if (floatingRef && floatingPoolKey) {
            const amount = Math.max(1, Number(count || 1));
            if (floatingRef.kind === 'restricted') {
              selectedFloatingRestricted[floatingRef.index] = (selectedFloatingRestricted[floatingRef.index] || 0) + amount;
            }
            selectedFloatingMana[floatingPoolKey] = (selectedFloatingMana[floatingPoolKey] || 0) + amount;
            totalAvailable[floatingPoolKey] = (totalAvailable[floatingPoolKey] || 0) + amount;
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
            continue;
          }

          const permanent = globalBattlefield.find((p: any) => p?.id === resolvedPermanentId && p?.controller === playerId);
          if (permanent) {
            const activationCostInfo = getPaymentActivationCostInfo(
              permanent,
              resolvePaymentManaAbilityActivationCost(permanent, String(mana || ''), abilityId)
            );
            reserveCastSpellPaymentPermanentId(usedPaymentPermanentIds, resolvedPermanentId, activationCostInfo.taps);
            if (activationCostInfo.taps) {
              const tapPermanentId = String(resolvedPermanentId || '');
              if (projectedTapPermanentIds.has(tapPermanentId)) {
                socket.emit('error', {
                  code: 'DUPLICATE_PAYMENT_SOURCE',
                  message: `${(permanent as any).card?.name || 'Permanent'} cannot be tapped more than once to pay for this spell.`,
                });
                return;
              }
              projectedTapPermanentIds.add(tapPermanentId);
            }
            if ((permanent as any).tapped && activationCostInfo.taps) {
              socket.emit('error', {
                code: 'PAYMENT_SOURCE_TAPPED',
                message: `${(permanent as any).card?.name || 'Permanent'} is already tapped.`,
              });
              return;
            }

            // Calculate actual mana production with effects
            let manaAmount: number;
            if (count !== undefined && count !== null) {
              // Client provided explicit count, but we should still check for effects
              const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana, abilityId);
              // Use the larger of client count or calculated production (effects may increase)
              manaAmount = Math.max(count, manaInfo.totalAmount);
            } else {
              const manaInfo = calculateManaProduction(game.state, permanent, playerId, mana, abilityId);
              manaAmount = manaInfo.totalAmount;
            }

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
              continue;
            }

            if (Array.isArray(producedColors) && producedColors.length > 0) {
              addCastSpellManaTotals(
                totalAvailable,
                getPaymentItemProducedManaTotals(mana, manaAmount, producedColors),
              );
              continue;
            }
            
            const colorKey = MANA_COLOR_NAMES[mana];
            if (colorKey && manaAmount > 0) {
              totalAvailable[colorKey] = (totalAvailable[colorKey] || 0) + manaAmount;
            }
          }
        }

        const floatingPoolValidationError = validateSelectedFloatingPoolMana(
          existingPool as any,
          selectedFloatingMana,
          selectedFloatingRestricted,
          restrictedManaPurpose,
        );
        if (floatingPoolValidationError) {
          socket.emit('error', {
            code: 'INSUFFICIENT_MANA',
            message: floatingPoolValidationError,
          });
          return;
        }

        // Implicit leftover pool can still pay remainder (tap a Swamp for {B}, spend {1} from pool).
        // Explicit __pool__:color picks are exclusive — do not pull in unselected floating colors.
        if (!castSpellPaymentHasExplicitFloatingRefs(payment)) {
          addUnselectedFloatingPoolRemainder(totalAvailable, existingPool, selectedFloatingMana);
        }
      }
      
      // Log floating mana if any
      const floatingMana = Object.entries(existingPool).filter(([_, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
      if (floatingMana) {
        debug(2, `[castSpellFromHand] Floating mana available in pool: ${floatingMana}`);
      }
      
      // Calculate total required cost
      const coloredCostTotal = Object.values(totalColored).reduce((a: number, b: number) => a + b, 0);
      const totalCost = coloredCostTotal + totalGeneric;
      const manaTotalsForValidation = buildManaTotalsIncludingEligibleRestricted(
        { ...totalAvailable, restricted: existingPool.restricted } as any,
        restrictedManaPurpose,
      );
      
      // Validate if total available mana can pay the cost
      if (totalCost > 0) {
        const validationError = validateManaPayment(manaTotalsForValidation, totalColored, totalGeneric);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Insufficient mana to cast this spell. ${validationError}`,
          });
          return;
        }

        if (explicitPaymentSelected) {
          const projectedPaymentTotals = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
          for (const key of CAST_SPELL_PAYMENT_MANA_KEYS) {
            projectedPaymentTotals[key] = Number(totalAvailable[key] || 0);
          }
          const preTapValidationError = validateManaPayment(
            snapshotCastSpellManaPool(projectedPaymentTotals),
            totalColored,
            totalGeneric,
          );
          if (preTapValidationError) {
            socket.emit('error', {
              code: 'INSUFFICIENT_MANA',
              message: `Insufficient mana to cast this spell. ${preTapValidationError}`,
            });
            return;
          }
        }
      }

      const poolBeforePayment = { ...getOrInitManaPool(game.state, playerId) } as any;
      const castSpellPaymentCheckpoint = {
        pool: poolBeforePayment,
        tappedPermanentIds: new Set<string>(),
        harmonizePermanentId: undefined as string | undefined,
        removedCounters: [] as Array<{ permanentId: string; counterType: string; previousAmount: number }>,
      };
      const abortCastSpellPayment = (payload: { code: string; message: string }): void => {
        restorePlayerCastSpellPaymentCheckpoint(game, playerId, {
          pool: castSpellPaymentCheckpoint.pool,
          tappedPermanentIds: castSpellPaymentCheckpoint.tappedPermanentIds,
          harmonizePermanentId: castSpellPaymentCheckpoint.harmonizePermanentId,
          removedCounters: castSpellPaymentCheckpoint.removedCounters,
        });
        socket.emit('error', payload);
      };

      // ======================================================================
      // HARMONIZE: Tap one creature to reduce only the generic portion of the cost
      // ======================================================================
      if (selectedHarmonizeCreature) {
        (selectedHarmonizeCreature as any).tapped = true;
        const harmonizePermanentId = String((selectedHarmonizeCreature as any).id || '');
        if (harmonizePermanentId) {
          castSpellPaymentCheckpoint.harmonizePermanentId = harmonizePermanentId;
          castSpellPaymentCheckpoint.tappedPermanentIds.add(harmonizePermanentId);
        }
      }

      if (alternateCostId === 'sneak' && (cardInHand as any).sneakReturnedCreatureId) {
        const sneakResult = applySneakReturnedCreatureCost({
          state: game.state,
          bumpSeq: () => { if (typeof game.bumpSeq === 'function') game.bumpSeq(); },
          gameId,
        } as any, String((cardInHand as any).sneakReturnedCreatureId));
        if (!sneakResult) {
          abortCastSpellPayment({
            code: 'SNEAK_RETURN_FAILED',
            message: 'Failed to return the unblocked attacker to your hand for sneak.',
          });
          return;
        }
        (cardInHand as any).sneakAttackTarget = sneakResult.attackTarget;
        (cardInHand as any).sneakCostWasPaid = true;
      }

      if (alternateCostId === 'web_slinging' && (cardInHand as any).webSlingingReturnedCreatureId) {
        const moved = applyWebSlingingReturnedCreatureCost({
          state: game.state,
          bumpSeq: () => { if (typeof game.bumpSeq === 'function') game.bumpSeq(); },
          gameId,
        } as any, String((cardInHand as any).webSlingingReturnedCreatureId));
        if (!moved) {
          abortCastSpellPayment({
            code: 'WEB_SLINGING_RETURN_FAILED',
            message: 'Failed to return the tapped creature for web-slinging.',
          });
          return;
        }
        (cardInHand as any).webSlingingCostWasPaid = true;
      }

      // ======================================================================
      // CONVOKE: Tap creatures to help pay for spell
      // ======================================================================
      if (!isForceAltCostPaid && convokeTappedCreatures && convokeTappedCreatures.length > 0) {
        if (!spellHasConvokeForCast(game.state, playerId as PlayerID, cardInHand, castSourceZone)) {
          socket.emit("error", {
            code: "NO_CONVOKE",
            message: "This spell does not have convoke",
          });
          return;
        }

        debug(2, `[castSpellFromHand] Processing convoke: tapping ${convokeTappedCreatures.length} creature(s)`);
        
        const globalBattlefield = game.state?.battlefield || [];
        
        for (const creatureId of convokeTappedCreatures) {
          const creature = globalBattlefield.find((p: any) => p?.id === creatureId && p?.controller === playerId);
          
          if (!creature) {
            socket.emit("error", {
              code: "CONVOKE_CREATURE_NOT_FOUND",
              message: `Creature ${creatureId} not found on battlefield`,
            });
            return;
          }
          
          if ((creature as any).tapped) {
            socket.emit("error", {
              code: "CONVOKE_CREATURE_TAPPED",
              message: `${(creature as any).card?.name || 'Creature'} is already tapped`,
            });
            return;
          }
          
          const creatureCard = (creature as any).card || {};
          const creatureTypeLine = (creatureCard.type_line || "").toLowerCase();
          
          if (!creatureTypeLine.includes("creature")) {
            socket.emit("error", {
              code: "CONVOKE_NOT_CREATURE",
              message: `${creatureCard.name || 'Permanent'} is not a creature`,
            });
            return;
          }
          
          // Tap the creature
          (creature as any).tapped = true;
          castSpellPaymentCheckpoint.tappedPermanentIds.add(String(creatureId));
          
          // Add mana to pool based on creature's colors
          // Each creature pays for {1} or one mana of its color
          const creatureColors = creatureCard.colors || [];
          
          // Initialize mana pool if needed
          if (!game.state.manaPool) game.state.manaPool = {};
          if (!game.state.manaPool[playerId]) {
            game.state.manaPool[playerId] = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
          }
          
          // Use creature's first color if it has one, otherwise colorless
          // This is a simple heuristic - in a full implementation, players would choose
          let manaAdded = 'colorless';
          if (creatureColors.length > 0) {
            const colorMap: Record<string, 'white' | 'blue' | 'black' | 'red' | 'green'> = {
              'W': 'white',
              'U': 'blue', 
              'B': 'black',
              'R': 'red',
              'G': 'green',
            };
            const firstColor = creatureColors[0];
            if (firstColor in colorMap) {
              const manaColor = colorMap[firstColor];
              game.state.manaPool[playerId][manaColor] += 1;
              manaAdded = manaColor;
            } else {
              game.state.manaPool[playerId].colorless += 1;
            }
          } else {
            game.state.manaPool[playerId].colorless += 1;
          }
          
          debug(1, `[castSpellFromHand] Convoke: tapped ${creatureCard.name} (colors: ${creatureColors.join(',') || 'none'}), added {1} ${manaAdded}`);
        }
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} tapped ${convokeTappedCreatures.length} creature(s) for convoke`,
          ts: Date.now(),
        });
      }


  return {
    kind: "continue",
    isForceAltCostPaid,
    abortCastSpellPayment,
    existingPool,
    castSpellPaymentCheckpoint,
    restrictedManaPurpose,
    explicitPaymentSelected,
    totalColored,
    totalGeneric,
    castingCreatureSpell,
    poolBeforePayment,
    suspendInfo,
    resolvedSuspendCost,
  };
}
