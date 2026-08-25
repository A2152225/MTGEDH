/**
 * socket/resolution-handlers/manaPaymentChoiceActivationHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse, MANA_PAYMENT_CHOICE case).
 * Cluster moved: the `activationPaymentChoice` branch - pay an activated ability's mana cost from
 * a prompt, then continue into the ability's activationPaymentContext (battlefield_counter_target,
 * battlefield_targeted, mana_ability, battlefield_group_draw).
 * Public entry symbols: tryHandleManaPaymentChoiceActivation.
 *
 * Returns true when the original switch case would have hit `break` here, false when the
 * remaining MANA_PAYMENT_CHOICE branches in resolution.ts still need to run.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  detectManaModifiers,
  getCreatureCountManaAmount,
  getDevotionManaAmount,
  getExtraManaProduction,
  getManaMultiplier,
  parseManaSpendRestrictionFromOracle,
} from "../../state/modules/mana-abilities.js";
import {
  buildAnyCombinationManaSelectionFields,
  buildManaProductionColorSelectionFields,
  isCombinationOrAnyColorManaField,
  resolveAllowedColorsForCombinationMana,
} from "../../state/modules/manaColorSelectionStepUtils.js";
import { maybeMarkPowerUpAbilityUsedFromActivationContext } from "../../state/modules/marvelMechanicsHelpers.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import {
  queueCounterTargetStepForBattlefieldAbility,
  resolveManaAbilityActivationShape,
} from "../interaction.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import {
  broadcastGame,
  broadcastManaPoolUpdate,
  buildActivatedAbilityRestrictedManaPurpose,
  emitToPlayer,
  getPlayerName,
  type RestrictedManaSpendPurpose,
} from "../util.js";
import {
  applySelectedManaPaymentForResolutionCost,
  extractResolutionPaymentItems,
} from "./resolutionManaPaymentApplication.js";

/** MANA_PAYMENT_CHOICE: activated-ability payment prompt plus its post-payment continuation. */
export async function tryHandleManaPaymentChoiceActivation(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<boolean> {
  const pid = response.playerId;
  const stepData = step as any;

  if (stepData.activationPaymentChoice !== true) return false;

  if (response.cancelled) {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} cancelled ${String(stepData.cardName || step.sourceName || 'the activation')}.`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  const payment = extractResolutionPaymentItems(response.selections as any);
  const manaCost = String(stepData.manaCost || '').trim();
  const activatingPermanentId = String(stepData?.permanentId || step.sourceId || '').trim();
  if (
    activatingPermanentId &&
    Array.isArray(payment) &&
    payment.some((item) => String(item?.permanentId || '').trim() === activatingPermanentId)
  ) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_PAYMENT_SOURCE',
      message: `Cannot use ${String(stepData.cardName || step.sourceName || 'this permanent')} to pay for its own activation cost.`,
    });
    return true;
  }
  const activatingPermanent = (Array.isArray(game.state?.battlefield) ? game.state.battlefield : [])
    .find((perm: any) => perm && String(perm.id) === activatingPermanentId);
  const activationManaPurpose = activatingPermanent
    ? buildActivatedAbilityRestrictedManaPurpose(activatingPermanent)
    : ({ isActivatedAbility: true } as RestrictedManaSpendPurpose);
  const applied = applySelectedManaPaymentForResolutionCost(
    game,
    pid,
    manaCost,
    payment,
    activationManaPurpose,
  );
  if (!applied.ok) {
    const appliedError = applied as { ok: false; code: string; message: string };
    emitToPlayer(io, pid as any, 'error', {
      code: appliedError.code,
      message: appliedError.message,
    });
    return true;
  }

  const tappedPaymentPermanents = applied.tappedPermanents;
  const sacrificedPaymentPermanents = applied.sacrificedPermanents;
  const paymentManaDelta = applied.paymentManaDelta;

  if (stepData.activationPaymentContext === 'battlefield_counter_target') {
    const controllerId = String(step.playerId || pid);
    const permanentId = String(stepData?.permanentId || step.sourceId || '').trim();
    const abilityId = String(stepData?.abilityId || '').trim();
    const cardName = String(stepData?.cardName || step.sourceName || 'Ability');
    const scopedAbilityFullText = String(stepData?.scopedAbilityFullText || stepData?.activatedAbilityText || step.description || '').trim();
    const counterType = String(stepData?.counterType || '').toLowerCase();
    const targetController = (stepData?.targetController || 'any') as 'opponent' | 'any' | 'you';
    const targetType = String(stepData?.targetType || 'creature');
    const scalingText = stepData?.scalingText ? String(stepData.scalingText) : null;
    const requiresTap = stepData.requiresTap === true;
    const tappedPaymentPermanents = applied.tappedPermanents;

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const sourcePerm = battlefield.find((perm: any) => perm && String(perm.id) === permanentId);
    if (!sourcePerm) {
      emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
      return true;
    }

    if (requiresTap && !(sourcePerm as any).tapped) {
      (sourcePerm as any).tapped = true;
    }

    const counterStep = queueCounterTargetStepForBattlefieldAbility({
      gameId,
      game,
      pid: controllerId,
      permanentId,
      abilityId,
      card: (sourcePerm as any).card,
      cardName,
      scopedAbilityFullText,
      counterType,
      targetController,
      scalingText,
      targetType,
      requiresTap,
      tappedPermanentIds: tappedPaymentPermanents,
    });

    if (!counterStep) {
      if (requiresTap) {
        (sourcePerm as any).tapped = false;
      }
      emitToPlayer(io, controllerId, 'error', {
        code: 'NO_VALID_TARGETS',
        message: targetController === 'opponent'
          ? `No valid opponent ${targetType} targets for ${cardName}.`
          : `No valid ${targetType} targets for ${cardName}.`,
      });
      return true;
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, controllerId)} paid for ${cardName}'s ability. Choose a target.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData.activationPaymentContext === 'battlefield_targeted') {
    const controllerId = String(step.playerId || pid);
    const permanentId = String(stepData?.permanentId || step.sourceId || '').trim();
    const abilityId = String(stepData?.abilityId || '').trim();
    const cardName = String(stepData?.cardName || step.sourceName || 'Ability');
    const abilityText = String(stepData?.abilityText || step.description || '').trim();
    const activatedAbilityText = String(stepData?.activatedAbilityText || '').trim();
    const selectedTargetIds = Array.isArray(stepData?.targetIds) ? stepData.targetIds.map((value: any) => String(value)) : [];
    const validTargets = Array.isArray(stepData?.validTargets) ? stepData.validTargets : [];
    const targetTypes = Array.isArray(stepData?.targetTypes) ? stepData.targetTypes : [];
    const minTargets = Number(stepData?.minTargets ?? 1);
    const maxTargets = Number(stepData?.maxTargets ?? 1);
    const targetDescription = String(stepData?.targetDescription || 'target');
    const battlefieldAbilityType = String(stepData?.abilityType || abilityId || '');
    const tappedPermanentsForCost = Array.isArray(stepData?.tappedPermanentsForCost)
      ? stepData.tappedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
      : [];
    const sacrificedPermanentsForCost = Array.isArray(stepData?.sacrificedPermanentsForCost)
      ? stepData.sacrificedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
      : [];
    // Payment-source taps/mana are persisted by applySelectedManaPaymentForResolutionCost.
    const allTappedPermanentsForCost = Array.from(new Set([...tappedPermanentsForCost]));
    const allSacrificedPermanentsForCost = Array.from(new Set([...sacrificedPermanentsForCost, ...sacrificedPaymentPermanents]));

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const sourcePerm = battlefield.find((perm: any) => perm && String(perm.id) === permanentId);
    if (!sourcePerm) {
      emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
      return true;
    }

    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: controllerId,
      source: permanentId,
      sourceName: cardName,
      description: abilityText,
      activatedAbilityText: activatedAbilityText || undefined,
      targets: selectedTargetIds,
      copyRetargetValidTargets: validTargets.map((target: any) => ({ ...target })),
      copyRetargetTargetTypes: [...targetTypes],
      copyRetargetMinTargets: minTargets,
      copyRetargetMaxTargets: maxTargets,
      copyRetargetTargetDescription: targetDescription,
    } as any;

    if (battlefieldAbilityType === 'equip') {
      const targetCreatureId = String(selectedTargetIds[0] || '');
      const targetCreature = battlefield.find((perm: any) => perm && String(perm.id) === targetCreatureId);
      stackItem.abilityType = 'equip';
      stackItem.equipParams = {
        equipmentId: permanentId,
        targetCreatureId,
        equipmentName: cardName,
        targetCreatureName: String(targetCreature?.card?.name || 'Creature'),
      };
    } else if (battlefieldAbilityType === 'fortify') {
      const targetLandId = String(selectedTargetIds[0] || '');
      const targetLand = battlefield.find((perm: any) => perm && String(perm.id) === targetLandId);
      stackItem.abilityType = 'fortify';
      stackItem.fortifyParams = {
        fortificationId: permanentId,
        targetLandId,
        fortificationName: cardName,
        targetLandName: String(targetLand?.card?.name || 'Land'),
      };
    } else if (battlefieldAbilityType === 'reconfigure_attach') {
      const targetCreatureId = String(selectedTargetIds[0] || '');
      const targetCreature = battlefield.find((perm: any) => perm && String(perm.id) === targetCreatureId);
      stackItem.abilityType = 'reconfigure_attach';
      stackItem.reconfigureParams = {
        reconfigureId: permanentId,
        targetCreatureId,
        reconfigureName: cardName,
        targetCreatureName: String(targetCreature?.card?.name || 'Creature'),
      };
    }

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    maybeMarkPowerUpAbilityUsedFromActivationContext(game, controllerId, permanentId, {
      activatedAbilityText: activatedAbilityText || undefined,
      abilityId,
    });
    fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          ...battlefieldAbilityStackReplayEvidence(stackItem.id),
          playerId: controllerId,
          permanentId,
          abilityId: abilityId || undefined,
          cardName,
          abilityText,
          targets: selectedTargetIds,
          tappedPermanents: allTappedPermanentsForCost.length > 0 ? allTappedPermanentsForCost : undefined,
          sacrificedPermanents: allSacrificedPermanentsForCost.length > 0 ? allSacrificedPermanentsForCost : undefined,
          activatedAbilityText: activatedAbilityText || undefined,
          abilityType: battlefieldAbilityType || undefined,
          paymentMutationsPersistedSeparately: true,
          ...(battlefieldAbilityType === 'equip'
            ? { equipParams: stackItem.equipParams }
            : battlefieldAbilityType === 'fortify'
              ? { fortifyParams: stackItem.fortifyParams }
              : battlefieldAbilityType === 'reconfigure_attach'
                ? { reconfigureParams: stackItem.reconfigureParams }
                : {}),
        });
      } catch {
        // ignore persistence failures
      }
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}. Ability on the stack.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();

    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData.activationPaymentContext === 'mana_ability') {
    const permanentId = String(stepData.permanentId || step.sourceId || '').trim();
    const cardName = String(stepData.cardName || step.sourceName || 'Ability');
    const abilityId = String(stepData.abilityId || '').trim();
    const abilityText = String(stepData.abilityText || step.description || '').trim();
    const activatedAbilityText = String(stepData.activatedAbilityText || '').trim();
    const requiresTap = stepData.requiresTap === true;
    const sacrificedPermanentsForCost = Array.isArray(stepData?.sacrificedPermanentsForCost)
      ? stepData.sacrificedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
      : [];
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const permanent = battlefield.find((entry: any) => entry && String(entry.id) === permanentId);
    if (!permanent) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'PERMANENT_NOT_FOUND',
        message: 'Permanent no longer on battlefield',
      });
      return true;
    }

    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
    }

    game.state.manaPool = game.state.manaPool || {};
    game.state.manaPool[pid] = game.state.manaPool[pid] || {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };

    const colorToPoolKey: Record<string, string> = {
      W: 'white',
      U: 'blue',
      B: 'black',
      R: 'red',
      G: 'green',
      C: 'colorless',
    };
    const recordedAddedMana: Record<string, number> = {};
    const recordAddedMana = (poolKey: string, amount: number) => {
      if (!poolKey) return;
      const numericAmount = Number(amount || 0);
      if (!Number.isFinite(numericAmount) || numericAmount === 0) return;
      recordedAddedMana[poolKey] = Number(recordedAddedMana[poolKey] || 0) + numericAmount;
    };

    const typeLine = String(permanent.card?.type_line || '').toLowerCase();
    const isLand = typeLine.includes('land');
    const isBasic = typeLine.includes('basic');
    const devotionMana = getDevotionManaAmount(game.state, permanent, pid);
    const creatureCountMana = getCreatureCountManaAmount(game.state, permanent, pid);
    const manaMultiplier = getManaMultiplier(game.state, permanent, pid);
    let effectiveMultiplier = manaMultiplier;
    if (manaMultiplier > 1 && !isBasic && isLand) {
      const modifiers = detectManaModifiers(game.state, pid);
      const virtueModifier = modifiers.find(m =>
        m.cardName.toLowerCase().includes('virtue of strength') &&
        m.type === 'mana_multiplier'
      );
      if (virtueModifier) {
        const otherMultiplier = modifiers
          .filter(m => m.type === 'mana_multiplier' && m.cardName !== virtueModifier.cardName)
          .reduce((acc, m) => acc * (m.multiplier || 1), 1);
        effectiveMultiplier = otherMultiplier;
      }
    }

    if (devotionMana && devotionMana.amount > 0) {
      const totalAmount = devotionMana.amount * effectiveMultiplier;
      const poolKey = colorToPoolKey[devotionMana.color] || 'green';
      (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
      recordAddedMana(poolKey, totalAmount);
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Activated ${cardName}`, game);
    } else if (creatureCountMana && (
      creatureCountMana.amount > 0
      || (creatureCountMana as any).requiresColorChoice === true
      || Boolean((creatureCountMana as any).activationCost)
    )) {
      const totalAmount = creatureCountMana.amount * effectiveMultiplier;

      if (isCombinationOrAnyColorManaField(creatureCountMana.color)) {
        const isDevotion = (creatureCountMana as any).dynamicAmountSource === 'devotion';
        const combinationFields = isDevotion
          ? buildAnyCombinationManaSelectionFields({
              totalAmount: Math.max(1, totalAmount),
              cardName,
              allowedColors: resolveAllowedColorsForCombinationMana(creatureCountMana.color),
            })
          : buildManaProductionColorSelectionFields({
              totalAmount,
              cardName,
              colorMode: creatureCountMana.color,
            });

        if (!combinationFields) {
          broadcastGame(io, game, gameId);
          return true;
        }

        const oracleSpendRestriction = parseManaSpendRestrictionFromOracle(
          String(permanent?.card?.oracle_text || ''),
        );
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: combinationFields.description,
          mandatory: true,
          selectionKind: combinationFields.selectionKind,
          permanentId,
          abilityId,
          cardName,
          ...(combinationFields.amount != null ? { amount: combinationFields.amount } : null),
          ...(combinationFields.totalAmount != null ? { totalAmount: combinationFields.totalAmount } : null),
          ...(combinationFields.availableColors ? { availableColors: combinationFields.availableColors } : null),
          allowedColors: combinationFields.allowedColors,
          singleColor: combinationFields.selectionKind === 'any_color',
          dynamicAmountSource: (creatureCountMana as any).dynamicAmountSource,
          manaMultiplier: effectiveMultiplier,
          tappedPermanentsForCost: requiresTap ? [permanentId] : [],
          ...(oracleSpendRestriction
            ? {
                manaRestriction: oracleSpendRestriction.restriction,
                manaRestrictedTo: oracleSpendRestriction.restrictedTo,
              }
            : null),
        } as any);
        broadcastGame(io, game, gameId);
        return true;
      }

      const poolKey = colorToPoolKey[creatureCountMana.color] || 'green';
      const fixedSpendRestriction = parseManaSpendRestrictionFromOracle(
        String(permanent?.card?.oracle_text || ''),
      );
      if (fixedSpendRestriction) {
        const { addRestrictedManaToPool } = await import('../util.js');
        addRestrictedManaToPool(
          game.state,
          pid,
          poolKey as any,
          totalAmount,
          fixedSpendRestriction.restriction,
          fixedSpendRestriction.restrictedTo,
          permanentId,
          cardName,
        );
        recordAddedMana(poolKey, totalAmount);
      } else {
        (game.state.manaPool[pid] as any)[poolKey] += totalAmount;
        recordAddedMana(poolKey, totalAmount);
      }
      broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Activated ${cardName}`, game);
    } else {
      const {
        produces,
        baseAmount,
        producesAllAtOnce,
      } = resolveManaAbilityActivationShape(
        game.state,
        permanent,
        pid,
        String(abilityId || ''),
        String(activatedAbilityText || ''),
        String(abilityText || ''),
        '',
      );

      if (producesAllAtOnce && produces.length > 1) {
        const amountPerColor = produces.length > 0
          ? Math.max(1, Math.floor(baseAmount / produces.length))
          : 1;
        for (const manaColor of produces) {
          const poolKey = colorToPoolKey[manaColor] || 'colorless';
          (game.state.manaPool[pid] as any)[poolKey] += amountPerColor * effectiveMultiplier;
          recordAddedMana(poolKey, amountPerColor * effectiveMultiplier);
        }
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Activated ${cardName}`, game);
      } else if (produces.length > 1) {
        const extraMana = getExtraManaProduction(game.state, permanent, pid, produces[0]);
        const totalExtra = extraMana.reduce((acc, entry) => acc + Number(entry.amount || 0), 0);
        const finalTotal = (baseAmount * effectiveMultiplier) + totalExtra;
        ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid as PlayerID,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: `Choose a color for ${cardName}'s mana.`,
          mandatory: true,
          selectionKind: 'any_color',
          permanentId,
          abilityId,
          cardName,
          amount: finalTotal,
          tappedPermanentsForCost: requiresTap ? [permanentId] : [],
        } as any);
        broadcastGame(io, game, gameId);
        return true;
      } else if (produces.length === 1) {
        const manaColor = produces[0];
        const poolKey = colorToPoolKey[manaColor] || 'colorless';
        const extraMana = getExtraManaProduction(game.state, permanent, pid, manaColor);
        for (const extra of extraMana) {
          const extraPoolKey = colorToPoolKey[extra.color] || poolKey;
          (game.state.manaPool[pid] as any)[extraPoolKey] += extra.amount;
          recordAddedMana(extraPoolKey, extra.amount);
        }
        (game.state.manaPool[pid] as any)[poolKey] += baseAmount * effectiveMultiplier;
        recordAddedMana(poolKey, baseAmount * effectiveMultiplier);
        broadcastManaPoolUpdate(io, gameId, pid, game.state.manaPool[pid] as any, `Activated ${cardName}`, game);
      }
    }

    try {
      const stateAny = game.state as any;
      stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
      stateAny.addedManaWithThisAbilityThisTurn[String(pid)] = stateAny.addedManaWithThisAbilityThisTurn[String(pid)] || {};
      const permKey = String(permanentId);
      const k = abilityId ? `${permKey}:${abilityId}` : permKey;
      (stateAny.addedManaWithThisAbilityThisTurn[String(pid)] as any)[k] = true;
    } catch {}

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId: abilityId || undefined,
        cardName,
        abilityText,
        activatedAbilityText: activatedAbilityText || undefined,
        tappedPermanents: requiresTap ? [permanentId] : undefined,
        sacrificedPermanents: Array.from(new Set([...sacrificedPermanentsForCost, ...sacrificedPaymentPermanents])),
        paymentMutationsPersistedSeparately: true,
        ...(paymentManaDelta && Object.keys(paymentManaDelta).length > 0 ? { paymentManaDelta } : {}),
      });
    } catch {
      // ignore persistence failures
    }

    try {
      const manaColorEntries = Object.entries(recordedAddedMana).filter(([, amount]) => Number(amount || 0) > 0);
      if (manaColorEntries.length > 0) {
        const poolKeyToManaColor: Record<string, string> = {
          white: 'W',
          blue: 'U',
          black: 'B',
          red: 'R',
          green: 'G',
          colorless: 'C',
        };
        const manaColor = manaColorEntries.length === 1
          ? (poolKeyToManaColor[String(manaColorEntries[0][0])] || String(manaColorEntries[0][0]).toUpperCase())
          : 'MULTI';
        appendEvent(gameId, (game as any).seq ?? 0, 'activateManaAbility', {
          playerId: pid,
          permanentId,
          abilityId: abilityId || undefined,
          manaColor,
          addedMana: { ...recordedAddedMana },
        });
      }
    } catch {
      // ignore persistence failures
    }

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  if (stepData.activationPaymentContext === 'battlefield_group_draw') {
    const controllerId = String(step.playerId || pid);
    const permanentId = String(stepData.permanentId || step.sourceId || '').trim();
    const abilityId = String(stepData.abilityId || '').trim();
    const cardName = String(stepData.cardName || step.sourceName || 'Ability');
    const abilityText = String(stepData.abilityText || step.description || '').trim();
    const activatedAbilityText = String(stepData.activatedAbilityText || '').trim();
    const requiresTap = stepData.requiresTap === true;
    const sacrificedPermanentsForCost = Array.isArray(stepData?.sacrificedPermanentsForCost)
      ? stepData.sacrificedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
      : [];
    const xValue = typeof stepData?.xValue === 'number' ? stepData.xValue : undefined;
    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const permanent = battlefield.find((entry: any) => entry && String(entry.id) === permanentId);
    if (!permanent) {
      emitToPlayer(io, pid as any, 'error', {
        code: 'PERMANENT_NOT_FOUND',
        message: 'Permanent no longer on battlefield',
      });
      return true;
    }

    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
    }

    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: controllerId,
      source: permanentId,
      sourceName: cardName,
      description: abilityText,
      activatedAbilityText: activatedAbilityText || undefined,
      xValue,
    } as any;

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    maybeMarkPowerUpAbilityUsedFromActivationContext(game, controllerId, permanentId, {
      activatedAbilityText: activatedAbilityText || undefined,
      abilityId,
    });
    fireBattlefieldAbilityActivatedTriggers(game, controllerId, permanentId, abilityText, gameId, stackItem.id, () => {
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          ...battlefieldAbilityStackReplayEvidence(stackItem.id),
          playerId: controllerId,
          permanentId,
          abilityId: abilityId || undefined,
          cardName,
          abilityText,
          activatedAbilityText: activatedAbilityText || undefined,
          xValue,
          tappedPermanents: Array.from(new Set([
            ...(requiresTap ? [permanentId] : []),
            ...tappedPaymentPermanents,
          ])),
          sacrificedPermanents: Array.from(new Set([...sacrificedPermanentsForCost, ...sacrificedPaymentPermanents])),
          paymentMutationsPersistedSeparately: true,
          ...(paymentManaDelta && Object.keys(paymentManaDelta).length > 0 ? { paymentManaDelta } : {}),
        });
      } catch {
        // ignore persistence failures
      }
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}. Ability on the stack.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return true;
  }

  return false;
}
