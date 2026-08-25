/**
 * socket/resolution-handlers/manaPaymentChoicePhyrexianHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse, MANA_PAYMENT_CHOICE case).
 * Cluster moved: the terminal branch of that case - Phyrexian mana payment for activated abilities
 * (`phyrexianManaChoice`), including the sacrifice-as-cost follow-up prompt and putting the ability
 * on the stack - plus the `UNSUPPORTED_STEP` fallback for any unrecognized payment shape.
 * Public entry symbols: handleManaPaymentChoicePhyrexianActivation.
 *
 * Runs last in the case: everything before it either handled the response or fell through, so this
 * always terminates the case (the original `break` becomes `return`).
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { maybeMarkPowerUpAbilityUsedFromActivationContext } from "../../state/modules/marvelMechanicsHelpers.js";
import { queueLifePaymentTriggers } from "../../state/modules/triggers/pay-life.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debugWarn } from "../../utils/debug.js";
import {
  battlefieldAbilityStackReplayEvidence,
  fireBattlefieldAbilityActivatedTriggers,
} from "../resolutionActivatedAbilityTargetingUtils.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/** MANA_PAYMENT_CHOICE tail: Phyrexian mana payment for an activated ability. */
export async function handleManaPaymentChoicePhyrexianActivation(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const stepData = step as any;

  // Phyrexian mana payment choice (activated abilities)
  if (stepData.phyrexianManaChoice !== true) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'UNSUPPORTED_STEP',
      message: 'Unsupported mana payment choice step',
    });
    return;
  }

  if (response.cancelled) {
    const cardName = String(stepData.cardName || stepData.sourceName || step.sourceName || 'ability');
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} cancelled activating ${cardName}.`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const choices = response.selections as any;
  if (!Array.isArray(choices)) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_SELECTION',
      message: 'Invalid Phyrexian payment selection',
    });
    return;
  }

  const permanentId = String(stepData.permanentId || step.sourceId || '');
  const cardName = String(stepData.cardName || step.sourceName || '');
  const abilityText = String(stepData.abilityText || step.description || '');
  const activationCostText = String(stepData.totalManaCost || stepData.manaCost || '').trim();
  const activatedAbilityText = String(stepData.activatedAbilityText || '').trim() || (activationCostText ? `${activationCostText}: ${abilityText}` : abilityText);
  const requiresTap = Boolean(stepData.requiresTap);

  const battlefield = game.state?.battlefield || [];
  const perm = battlefield.find((p: any) => p && p.id === permanentId);
  if (!perm) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'PERMANENT_NOT_FOUND',
      message: 'Permanent no longer on battlefield',
    });
    return;
  }

  const {
    getOrInitManaPool,
    calculateTotalAvailableMana,
    validateManaPayment,
    consumeManaFromPool,
    deriveManaFromTreasureSpent,
    snapshotTreasureManaLowerBound,
  } = await import('../util.js');
  const pool = getOrInitManaPool(game.state, pid) as any;

  const poolBeforePayment = { ...pool };
  const treasureLowerBoundBeforePayment = snapshotTreasureManaLowerBound(game.state, String(pid));

  const parsedCost = stepData.parsedCost;
  const phyrexianCosts: any[] = Array.isArray(stepData.phyrexianCosts) ? stepData.phyrexianCosts : [];
  if (!parsedCost) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'MISSING_COST',
      message: 'Missing cost data for Phyrexian payment',
    });
    return;
  }

  let totalLifeToPay = 0;
  const manaToConsume = { colors: { ...(parsedCost.colors || {}) }, generic: Number(parsedCost.generic || 0) };

  for (const choice of choices) {
    const idx = Number(choice?.index);
    const payWithLife = Boolean(choice?.payWithLife);
    const options = phyrexianCosts[idx];
    if (!Array.isArray(options)) continue;

    if (payWithLife) {
      const lifeOption = options.find((o: any) => typeof o === 'string' && String(o).startsWith('LIFE:'));
      if (lifeOption) {
        totalLifeToPay += Number(String(lifeOption).split(':')[1] || 2);
      } else {
        totalLifeToPay += 2;
      }
    } else {
      const colorOption = options.find((o: any) => typeof o === 'string' && !String(o).startsWith('LIFE:') && !String(o).startsWith('GENERIC:'));
      if (typeof colorOption === 'string' && colorOption.length > 0) {
        manaToConsume.colors[colorOption] = Number(manaToConsume.colors[colorOption] || 0) + 1;
      }
    }
  }

  const playerLife = Number(game.state.life?.[pid] ?? 40);
  if (totalLifeToPay > 0 && playerLife <= totalLifeToPay) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INSUFFICIENT_LIFE',
      message: `Cannot pay ${totalLifeToPay} life (you have ${playerLife} life - payment would be lethal)`,
    });
    return;
  }

  const totalAvailable = calculateTotalAvailableMana(pool, undefined);
  const validationError = validateManaPayment(totalAvailable, manaToConsume.colors, manaToConsume.generic);
  if (validationError) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INSUFFICIENT_MANA',
      message: validationError,
    });
    return;
  }

  // Pay costs
  if (totalLifeToPay > 0) {
    game.state.life = game.state.life || {};
    const startingLife = game.state.startingLife || 40;
    const currentLife = game.state.life?.[pid] ?? startingLife;
    game.state.life[pid] -= totalLifeToPay;

    // Track life lost this turn.
    try {
      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[String(pid)] =
        ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + Number(totalLifeToPay || 0);
    } catch {}
    queueLifePaymentTriggers(game as any, String(pid), Number(totalLifeToPay || 0), { sourceName: 'Phyrexian mana' });

    // Keep player object in sync.
    try {
      const playerObj = ((game.state as any).players || []).find((p: any) => p?.id === pid);
      if (playerObj) playerObj.life = game.state.life[pid];
    } catch {}

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `${getPlayerName(game, pid)} paid ${totalLifeToPay} life for Phyrexian mana. (${currentLife} → ${game.state.life[pid]})`,
      ts: Date.now(),
    });
  }

  const manaConsumption = consumeManaFromPool(pool, manaToConsume.colors, manaToConsume.generic);
  const treasureMeta = deriveManaFromTreasureSpent(game.state, String(pid), {
    poolBeforePayment,
    consumed: (manaConsumption as any)?.consumed,
    treasureLowerBoundBeforePayment,
  });

  // Tap as part of cost (if not already tapped).
  if (requiresTap && !(perm as any).tapped) {
    (perm as any).tapped = true;
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} paid ${String(stepData.manaCost || stepData.totalManaCost || '')} to activate ${cardName}.`,
    ts: Date.now(),
  });

  const sacrificeType = String(stepData.sacrificeType || '').trim();
  if (sacrificeType) {
    const sacrificeCount = Math.max(1, Number(stepData.sacrificeCount || 1));
    const mustBeOther = Boolean(stepData.mustBeOther);
    const sacrificeSubtype = stepData.sacrificeSubtype ? String(stepData.sacrificeSubtype) : undefined;
    const eligiblePermanents = (game.state.battlefield || []).filter((entry: any) => {
      if (!entry || String(entry.controller || '') !== String(pid)) return false;
      if (mustBeOther && String(entry.id) === permanentId) return false;
      const typeLine = String(entry.card?.type_line || '').toLowerCase();
      let matchesType = false;
      switch (sacrificeType) {
        case 'creature':
          matchesType = typeLine.includes('creature');
          break;
        case 'artifact':
          matchesType = typeLine.includes('artifact');
          break;
        case 'enchantment':
          matchesType = typeLine.includes('enchantment');
          break;
        case 'land':
          matchesType = typeLine.includes('land');
          break;
        case 'permanent':
          matchesType = true;
          break;
        case 'artifact_or_creature':
          matchesType = typeLine.includes('artifact') || typeLine.includes('creature');
          break;
        default:
          matchesType = false;
      }
      if (!matchesType) return false;
      if (!sacrificeSubtype) return true;
      return typeLine.includes(String(sacrificeSubtype).toLowerCase());
    });

    let sacrificeLabel = sacrificeSubtype ? sacrificeSubtype : sacrificeType;
    let sacrificeLabelPlural = `${sacrificeLabel}s`;
    if (sacrificeType === 'artifact_or_creature') {
      sacrificeLabel = 'artifact or creature';
      sacrificeLabelPlural = 'artifacts and/or creatures';
    }

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: pid as PlayerID,
      sourceId: permanentId,
      sourceName: cardName,
      sourceImage: (perm.card as any)?.image_uris?.small || (perm.card as any)?.image_uris?.normal,
      description: `${cardName}: Sacrifice ${sacrificeCount} ${sacrificeLabelPlural} to activate: ${abilityText}`,
      mandatory: true,
      validTargets: eligiblePermanents.map((entry: any) => ({
        id: entry.id,
        label: entry.card?.name || 'Unknown',
        name: entry.card?.name || 'Unknown',
        description: entry.card?.type_line || 'Permanent',
        imageUrl: entry.card?.image_uris?.small || entry.card?.image_uris?.normal,
        typeLine: entry.card?.type_line || '',
        tapped: entry?.tapped === true,
        isToken: entry?.isToken === true || entry?.card?.isToken === true,
        isCommander: entry?.isCommander === true || entry?.card?.isCommander === true,
        controller: entry?.controller,
      })),
      minTargets: sacrificeCount,
      maxTargets: sacrificeCount,
      targetType: 'permanent',
      sacrificeAbilityAsCost: true,
      permanentId,
      abilityId: stepData.abilityId,
      cardName,
      abilityText,
      activatedAbilityText,
      manaCost: '',
      requiresTap: false,
      sacrificeType,
      sacrificeSubtype,
      sacrificeCount,
      mustBeOther,
      prePaidLifeForCost: totalLifeToPay > 0 ? totalLifeToPay : 0,
      prePaidTappedPermanentsForCost: requiresTap ? [String(permanentId)] : [],
      ...(treasureMeta.manaFromTreasureSpentKnown === true && typeof treasureMeta.manaFromTreasureSpent === 'boolean'
        ? {
            manaFromTreasureSpentKnown: true,
            manaFromTreasureSpent: treasureMeta.manaFromTreasureSpent,
          }
        : {}),
    } as any);

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // Put the ability on the stack unless it's a mana ability.
  const isManaAbility =
    /add\s+(\{[wubrgc]\}|\{[wubrgc]\}\{[wubrgc]\}|one mana|two mana|three mana|mana of any|any color|[xX] mana|an amount of|mana in any combination)/i.test(abilityText) &&
    !/target/i.test(abilityText);
  let stackItemId: string | undefined;

  const persistActivateBattlefieldAbilityEvent = () => {
    try {
      const tappedPermanentsForCost: string[] = [];
      if (requiresTap) tappedPermanentsForCost.push(String(permanentId));
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        ...(stackItemId ? battlefieldAbilityStackReplayEvidence(stackItemId) : {}),
        playerId: pid,
        permanentId,
        abilityId: stepData.abilityId,
        cardName,
        abilityText,
        activatedAbilityText: activatedAbilityText || undefined,
        tappedPermanents: tappedPermanentsForCost,
        sacrificedPermanents: [],
        removedCountersForCost: [],
        lifePaidForCost: totalLifeToPay > 0 ? totalLifeToPay : undefined,
        ...(treasureMeta.manaFromTreasureSpentKnown === true && typeof treasureMeta.manaFromTreasureSpent === 'boolean'
          ? {
              manaFromTreasureSpentKnown: true,
              manaFromTreasureSpent: treasureMeta.manaFromTreasureSpent,
            }
          : {}),
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(activateBattlefieldAbility) failed:', e);
    }
  };

  if (!isManaAbility) {
    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: abilityText,
      activatedAbilityText,
    } as any;

    if (treasureMeta.manaFromTreasureSpentKnown === true && typeof treasureMeta.manaFromTreasureSpent === 'boolean') {
      stackItem.manaFromTreasureSpentKnown = true;
      stackItem.manaFromTreasureSpent = treasureMeta.manaFromTreasureSpent;
    }

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    stackItemId = String(stackItem.id || '').trim() || undefined;
    maybeMarkPowerUpAbilityUsedFromActivationContext(game, String(pid), permanentId, {
      activatedAbilityText,
      abilityId: stepData.abilityId,
    });
    fireBattlefieldAbilityActivatedTriggers(game, pid, permanentId, abilityText, gameId, stackItem.id, persistActivateBattlefieldAbilityEvent);

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability: ${abilityText}`,
      ts: Date.now(),
    });

    if (typeof game.bumpSeq === 'function') game.bumpSeq();
  } else {
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    persistActivateBattlefieldAbilityEvent();
  }

  broadcastGame(io, game, gameId);
}
