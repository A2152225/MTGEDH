/**
 * socket/resolutionGraveyardSelectionApplyHandlers.ts
 *
 * GRAVEYARD_SELECTION response: cancel / validate / move cards out of graveyard.
 * Post-move tracking, reflexive followups, and as-cost activation resumes live in
 * resolutionGraveyardSelectionResumeHandlers.ts.
 */

import type { Server } from "socket.io";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { appendEvent } from "../db/index.js";
import { parseTargetRequirements } from "../rules-engine/targeting";
import { cardManaValue, parsePT, uid } from "../state/utils.js";
import { recordCardLeftGraveyardThisTurn } from "../state/modules/turn-tracking.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "./util.js";
import { continueCastFromGraveyardAbility } from "./interaction.js";
import { requestCastSpellForSocket } from "./game-actions.js";
import { pushExertTriggeredAbilityOntoStack } from "./resolutionKeywordChoiceHandlers.js";
import {
  battlefieldAbilityStackReplayEvidence,
  buildActivatedAbilityValidTargets,
  fireBattlefieldAbilityActivatedTriggers,
  getSelectedGraveyardCardsForStep,
} from "./resolutionActivatedAbilityTargetingUtils.js";
import {
  finalizeBattlefieldAbilitySelfExertCost,
  getNextEndStepFireTurnNumberForResolution,
  getNextUpkeepNotBeforeTurnNumberForResolution,
  markPermanentEnteredFromZone,
  triggeredSourceExilesSpellCastThisWay,
} from "./resolutionGraveyardSelectionHelperUtils.js";
import { resumePlayerCastSpellFromHand } from "./resolutionSyntheticCastSocketUtils.js";
import {
  finishGraveyardSelectionAfterApply,
  type GraveyardSelectionApplyResult,
} from "./resolutionGraveyardSelectionResumeHandlers.js";
import { tryApplyTriggeredAbilityGraveyardSelectionViaExecute } from "./resolutionGraveyardSelectionTriggerExecute.js";
import {
  resolveGraveyardExileSourcePermanentId,
  stampCardExiledWithSource,
} from "../state/modules/exileWithSourceStamp.js";
import { stampPermanentEntryTimestamp } from '../../../rules-engine/src/permanentTimestamps.js';

export async function handleGraveyardSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId as any;
  const stepData = step as any;

  const effectId = String(stepData.effectId || step.sourceId || '').trim();
  const cardName = String(stepData.cardName || step.sourceName || 'Effect');
  const title = String(stepData.title || cardName || 'Select from Graveyard');
  const targetPlayerId = String(stepData.targetPlayerId || pid || '').trim();
  const destination = (stepData.destination || 'hand') as 'hand' | 'battlefield' | 'library_top' | 'library_bottom' | 'exile' | 'cast';

  const purpose = String(stepData.purpose || '').trim();
  const collectEvidenceMinManaValue = Number(stepData.collectEvidenceMinManaValue ?? 0);
  const totalPowerLimit = Number(stepData.totalPowerLimit ?? 0);

  if (!targetPlayerId && stepData.battlefieldAbilityTargetSelection !== true) {
    emitToPlayer(io, pid, 'error', { code: 'NO_TARGET_PLAYER', message: 'No graveyard specified for selection' });
    return;
  }

  if (response.cancelled) {
    // Optional steps may be cancelled; mandatory steps should generally not be.
    debug(2, `[Resolution] GRAVEYARD_SELECTION cancelled by ${pid} (${title})`);

    if ((step as any)?.graveyardExileAbilityAsCost === true) {
      const abilityName = String((step as any)?.cardName || step.sourceName || 'Ability');
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${abilityName}: ${getPlayerName(game, pid)} cancelled the activation.`,
        ts: Date.now(),
      });
    }

    if ((step as any)?.graveyardCastExileAsCost === true) {
      const spellName = String((step as any)?.cardName || step.sourceName || 'Spell');
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${spellName}: ${getPlayerName(game, pid)} cancelled the graveyard cast.`,
        ts: Date.now(),
      });
    }

     // For cast continuations (e.g., optional collect evidence), treat cancel as decline and continue.
     const castArgs = stepData.castSpellFromHandArgs as any;
     if (castArgs && typeof castArgs === 'object' && castArgs.cardId) {
       const basePayment = Array.isArray(castArgs?.payment) ? castArgs.payment : [];
       const alreadyMarked = basePayment.some((p: any) => p && p.collectEvidenceResolved === true);
       const paymentWithMarker = alreadyMarked
         ? basePayment
         : [...basePayment, { collectEvidenceResolved: true, collectEvidenceDeclined: true, evidenceCollected: false }];

       await resumePlayerCastSpellFromHand(io, gameId, String(pid), {
         cardId: String(castArgs.cardId),
         targets: castArgs.targets,
         payment: paymentWithMarker,
         xValue: castArgs.xValue,
         alternateCostId: castArgs.alternateCostId,
         convokeTappedCreatures: castArgs.convokeTappedCreatures,
       });
       return;
     }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  let selectedCardIds: string[] = [];
  if (Array.isArray(response.selections)) {
    selectedCardIds = (response.selections as any[]).map((s: any) => String(s)).filter(Boolean);
  } else if (typeof response.selections === 'object' && response.selections) {
    const obj = response.selections as any;
    if (Array.isArray(obj.selectedCardIds)) selectedCardIds = obj.selectedCardIds.map((s: any) => String(s)).filter(Boolean);
  }

  const minTargets = Math.max(0, Number(stepData.minTargets ?? 0));
  const maxTargets = Math.max(minTargets, Number(stepData.maxTargets ?? minTargets));
  if (selectedCardIds.length < minTargets || selectedCardIds.length > maxTargets) {
    emitToPlayer(io, pid, 'error', {
      code: 'INVALID_SELECTION_COUNT',
      message: `Select ${minTargets === maxTargets ? minTargets : `${minTargets}-${maxTargets}`} card(s).`,
    });
    return;
  }

  const validTargets: any[] = Array.isArray(stepData.validTargets) ? stepData.validTargets : [];
  const validIds = new Set(validTargets.map((t: any) => String(t?.id || '')));
  for (const id of selectedCardIds) {
    if (!validIds.has(String(id))) {
      emitToPlayer(io, pid, 'error', { code: 'INVALID_TARGET', message: 'Invalid graveyard card selection' });
      return;
    }
  }
  const validTargetById = new Map<string, any>(
    validTargets
      .map((target: any): [string, any] => [String(target?.id || ''), target])
      .filter(([id]) => Boolean(id))
  );

  const zones = (game.state as any).zones = (game.state as any).zones || {};
  const srcZones = targetPlayerId
    ? (zones[targetPlayerId] = zones[targetPlayerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 })
    : { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 };
  srcZones.graveyard = Array.isArray(srcZones.graveyard) ? srcZones.graveyard : [];
  srcZones.exile = Array.isArray(srcZones.exile) ? srcZones.exile : [];

  if (Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 && selectedCardIds.length > 0) {
    const selectedCards = getSelectedGraveyardCardsForStep(game, stepData, selectedCardIds);
    const selectedTotalPower = selectedCards.reduce((sum: number, entry: any) => {
      const card = entry?.card;
      const typeLine = String(card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) {
        return sum;
      }
      return sum + parsePT(card?.power);
    }, 0);

    if (selectedTotalPower > totalPowerLimit) {
      emitToPlayer(io, pid, 'error', {
        code: 'INVALID_TOTAL_POWER',
        message: `Selected cards have total power ${selectedTotalPower} (need ${totalPowerLimit} or less).`,
      });
      return;
    }
  }

  zones[pid] = zones[pid] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 };
  const dstZones = zones[pid] as any;
  dstZones.hand = Array.isArray(dstZones.hand) ? dstZones.hand : [];
  dstZones.exile = Array.isArray(dstZones.exile) ? dstZones.exile : [];

  const movedCards: string[] = [];
  const movedCardIds: string[] = [];
  const movedCardSnapshots: any[] = [];
  const createdPermanentIds: string[] = [];
  const createdBattlefieldEntries: Array<{ permanent: any; controllerId: string }> = [];
  const touchedZoneOwners = new Set<string>();

  const findSelectedCardSourceOwner = (cardId: string): string | null => {
    const targetInfo = validTargetById.get(String(cardId));
    const explicitOwnerId = String(targetInfo?.zoneOwnerId || '').trim();
    if (explicitOwnerId) {
      return explicitOwnerId;
    }

    const ownersToCheck = targetPlayerId
      ? [targetPlayerId, ...Object.keys(zones).filter((playerId) => playerId !== targetPlayerId)]
      : Object.keys(zones);
    for (const ownerId of ownersToCheck) {
      const graveyard = Array.isArray(zones[ownerId]?.graveyard) ? zones[ownerId].graveyard : [];
      if (graveyard.some((card: any) => String(card?.id || '') === String(cardId))) {
        return ownerId;
      }
    }

    return null;
  };

  if (stepData?.triggeredAbilityGraveyardChoice === true) {
    const triggerStackItemId = String(stepData?.triggerStackItemId || step.sourceId || '').trim();
    if (!triggerStackItemId) {
      emitToPlayer(io, pid, 'error', {
        code: 'INVALID_TRIGGER_TARGET',
        message: 'Triggered ability stack item missing for graveyard target selection.',
      });
      return;
    }
    const stack: any[] = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : [];
    const stackItem = stack.find((item: any) => item && String(item?.id || '') === triggerStackItemId)
      || stack.find((item: any) =>
        item
        && String(item?.type || '') === 'triggered_ability'
        && String(item?.controller || '') === String(pid)
        && String(item?.source || item?.permanentId || '') === String(step.sourceId || '')
      )
      || stack.find((item: any) =>
        item
        && String(item?.type || '') === 'triggered_ability'
        && String(item?.controller || '') === String(pid)
        && String(item?.sourceName || '') === String(step.sourceName || '')
      );
    if (stackItem) {
      stackItem.targets = selectedCardIds.slice();
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'assignTriggeredAbilityTargets', {
          triggerStackItemId,
          targets: selectedCardIds.slice(),
          ...(String((step as any).id || '').trim()
            ? { resolvedStepId: String((step as any).id).trim() }
            : {}),
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(assignTriggeredAbilityTargets) failed:', err);
      }
      debug(2, `[Resolution] Stamped graveyard target [${selectedCardIds.join(', ')}] onto trigger ${triggerStackItemId}`);
      if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
      broadcastGame(io, game, gameId);
      return;
    }
    // Trigger already left the stack (resolve-then-choose). Apply the destination move below.
  }

  if (tryApplyTriggeredAbilityGraveyardSelectionViaExecute(io, game, gameId, step, pid, selectedCardIds, effectId)) {
    return;
  }

  if (stepData?.exertGraveyardTargetChoice === true) {
    const selectedCardId = String(selectedCardIds[0] || '').trim();
    const boundGraveyardOwnerId = selectedCardId ? findSelectedCardSourceOwner(selectedCardId) : null;
    const attackerId = String(stepData?.exertAttackerId || step.sourceId || '').trim();
    const rewardDescription = String(stepData?.exertRewardDescription || '').trim();
    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const attacker = battlefield.find((permanent: any) => String(permanent?.id || '') === attackerId)
      || (stepData?.sourcePermanentSnapshot ? { ...(stepData.sourcePermanentSnapshot as any) } : null);

    if (!selectedCardId || !boundGraveyardOwnerId || !rewardDescription || !attacker) {
      emitToPlayer(io, pid, 'error', {
        code: 'INVALID_EXERT_GRAVEYARD_TARGET',
        message: 'Choose a valid card from the graveyard for this Exert ability.',
      });
      return;
    }

    pushExertTriggeredAbilityOntoStack(
      game,
      gameId,
      attacker,
      String(pid),
      rewardDescription,
      [selectedCardId],
      {
        boundGraveyardCardId: selectedCardId,
        boundGraveyardOwnerId,
        preselectedTargetsPersisted: true,
      },
    );

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (stepData?.battlefieldAbilityTargetSelection === true) {
    const controllerId = String(step.playerId || pid);
    const permanentId = String(stepData?.permanentId || step.sourceId || '').trim();
    const abilityId = String(stepData?.abilityId || '').trim();
    const cardName = String(stepData?.cardName || step.sourceName || 'Ability');
    const abilityText = String(stepData?.abilityText || step.description || '').trim();
    const activatedAbilityText = String(stepData?.activatedAbilityText || '').trim();
    const tappedPermanentsForCost = Array.isArray(stepData?.tappedPermanentsForCost)
      ? stepData.tappedPermanentsForCost.map((id: any) => String(id)).filter(Boolean)
      : [];

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const sourcePerm = battlefield.find((perm: any) => perm && String(perm.id) === permanentId);
    if (!sourcePerm) {
      emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
      return;
    }
    if (String(sourcePerm.controller || '') !== controllerId) {
      emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
      return;
    }

    const selectedEntries = getSelectedGraveyardCardsForStep(game, stepData, selectedCardIds);
    if (selectedEntries.length !== selectedCardIds.length) {
      emitToPlayer(io, controllerId, 'error', { code: 'INVALID_TARGET', message: 'Selected card not found in graveyard' });
      return;
    }

    if (Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 && selectedCardIds.length > 0) {
      const selectedTotalPower = selectedEntries.reduce((sum: number, entry: any) => {
        const card = entry?.card;
        const typeLine = String(card?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) {
          return sum;
        }
        return sum + parsePT(card?.power);
      }, 0);

      if (selectedTotalPower > totalPowerLimit) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'INVALID_TOTAL_POWER',
          message: `Selected cards have total power ${selectedTotalPower} (need ${totalPowerLimit} or less).`,
        });
        return;
      }
    }

    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: controllerId,
      source: permanentId,
      sourceName: cardName,
      description: abilityText,
      activatedAbilityText: activatedAbilityText || undefined,
      targets: selectedCardIds,
      copyRetargetValidTargets: validTargets.map((target: any) => ({ ...target })),
      copyRetargetTargetTypes: Array.isArray(stepData.targetTypes) ? [...stepData.targetTypes] : [],
      copyRetargetMinTargets: minTargets,
      copyRetargetMaxTargets: maxTargets,
      copyRetargetTargetDescription: String(stepData.targetDescription || 'target'),
      ...(Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 ? { targetTotalPowerLimit: totalPowerLimit } : null),
    } as any;

    game.state.stack = game.state.stack || [];
    game.state.stack.push(stackItem);
    const exertedPermanentIdForCost = finalizeBattlefieldAbilitySelfExertCost(
      game,
      gameId,
      controllerId,
      permanentId,
      stepData?.requiresSelfExertForCost === true,
    );
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
          targets: selectedCardIds,
          copyRetargetValidTargets: validTargets.map((target: any) => ({ ...target })),
          copyRetargetTargetTypes: Array.isArray(stepData.targetTypes) ? [...stepData.targetTypes] : [],
          copyRetargetMinTargets: minTargets,
          copyRetargetMaxTargets: maxTargets,
          copyRetargetTargetDescription: String(stepData.targetDescription || 'target'),
          targetTotalPowerLimit: Number.isFinite(totalPowerLimit) && totalPowerLimit > 0 ? totalPowerLimit : undefined,
          tappedPermanents: tappedPermanentsForCost.length > 0 ? tappedPermanentsForCost : undefined,
          discardedCardIds: Array.isArray(stepData?.discardedCardIdsForCost) && stepData.discardedCardIdsForCost.length > 0
            ? stepData.discardedCardIdsForCost.map((id: any) => String(id))
            : undefined,
          lifePaidForCost: Number(stepData?.lifePaidForCost || 0) > 0 ? Number(stepData.lifePaidForCost) : undefined,
          exertedPermanentIdForCost,
        });
      } catch {
        // ignore persistence failures
      }
    });

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `⚡ ${getPlayerName(game, controllerId)} activated ${cardName}'s ability: ${abilityText}`,
      ts: Date.now(),
    });

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // Collect evidence validation: ensure the chosen cards meet the required total mana value.
  let evidenceCollected = false;
  if (purpose.toLowerCase() === 'collectevidence' && destination === 'exile' && collectEvidenceMinManaValue > 0 && selectedCardIds.length > 0) {
    try {
      const { cardManaValue } = await import("../state/utils.js");
      const chosen = selectedCardIds
        .map((id) => (srcZones.graveyard as any[]).find((c: any) => c && String(c.id) === String(id)))
        .filter(Boolean);

      const total = chosen.reduce((sum: number, c: any) => sum + (cardManaValue(c) || 0), 0);
      if (!(total >= collectEvidenceMinManaValue)) {
        emitToPlayer(io, pid as any, 'error', {
          code: 'CANNOT_COLLECT_EVIDENCE',
          message: `Collect evidence ${collectEvidenceMinManaValue}: selected cards total mana value ${total} (need ${collectEvidenceMinManaValue} or more).`,
        });
        return;
      }

      evidenceCollected = true;
    } catch {
      // If we can't validate, be conservative and reject instead of silently allowing.
      emitToPlayer(io, pid as any, 'error', {
        code: 'CANNOT_COLLECT_EVIDENCE',
        message: `Collect evidence validation failed; please try again.`,
      });
      return;
    }
  }

  // Activation-cost flows must validate remaining mana/life BEFORE performing irreversible zone changes.
  // Otherwise, we could exile cards and then discover mana can't be paid.
  if ((step as any)?.graveyardExileAbilityAsCost === true) {
    const stepAny = step as any;
    const controllerId = String(pid);
    const permanentId = String(stepAny?.permanentId || step.sourceId || '').trim();
    const manaCost = String(stepAny?.manaCost || '');
    const requiresTap = Boolean(stepAny?.requiresTap);
    const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);

    const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
    const sourcePerm = permanentId ? battlefield.find((p: any) => p && String(p.id) === String(permanentId)) : undefined;
    if (!sourcePerm) {
      emitToPlayer(io, controllerId, 'error', { code: 'PERMANENT_NOT_FOUND', message: 'Permanent no longer on battlefield' });
      return;
    }
    if (String(sourcePerm.controller || '') !== controllerId) {
      emitToPlayer(io, controllerId, 'error', { code: 'NOT_CONTROLLER', message: 'You no longer control that permanent' });
      return;
    }
    if (requiresTap && (sourcePerm as any).tapped) {
      emitToPlayer(io, controllerId, 'error', { code: 'ALREADY_TAPPED', message: 'Permanent is already tapped' });
      return;
    }

    const remainingNonManaCostText = manaCost
      .replace(/\{[^}]+\}/g, ' ')
      .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
      .replace(
        /\bexile\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(?:creature|artifact|enchantment|land|instant|sorcery|planeswalker|legendary|nonland|noncreature)\s+)?cards?\s+from\s+your\s+graveyard\b/gi,
        ' '
      )
      .replace(/[\s,]+/g, ' ')
      .trim();
    if (remainingNonManaCostText.length > 0) {
      emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${remainingNonManaCostText}).` });
      return;
    }

    // Validate mana portion of the activation cost (hybrid-aware; conservative: no Phyrexian and no X).
    const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
    const manaOnly = manaSymbols
      .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
      .join('');
    if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
      emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
      return;
    }
    if (manaOnly) {
      const { getOrInitManaPool, resolveManaCostForPoolPayment, calculateTotalAvailableMana, validateManaPayment } = await import('./util.js');
      const pool = getOrInitManaPool(game.state, controllerId) as any;
      const resolved = resolveManaCostForPoolPayment(pool, manaOnly);
      if (!resolved.ok) {
        emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: (resolved as any).error || 'Insufficient mana.' });
        return;
      }
      const totalAvailable = calculateTotalAvailableMana(pool, undefined);
      const validationError = validateManaPayment(totalAvailable, resolved.coloredCost, resolved.genericCost);
      if (validationError) {
        emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: validationError });
        return;
      }
    }

    if (Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0) {
      const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
      if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'INSUFFICIENT_LIFE',
          message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
        });
        return;
      }
    }

    // Ensure the chosen cards are still in the player's actual graveyard.
    const gyNow: any[] = Array.isArray(srcZones.graveyard) ? srcZones.graveyard : [];
    const gyNowIds = new Set(gyNow.map((c: any) => String(c?.id || '')).filter(Boolean));
    if (!selectedCardIds.every((id) => gyNowIds.has(String(id)))) {
      emitToPlayer(io, controllerId, 'error', { code: 'INVALID_TARGET', message: 'Selected card not found in graveyard' });
      return;
    }
  }

  if ((step as any)?.graveyardCastExileAsCost === true) {
    const stepAny = step as any;
    const controllerId = String(pid);
    const cardId = String(stepAny?.cardId || step.sourceId || '').trim();
    const manaCost = String(stepAny?.manaCost || '');
    const lifeToPayForCost = Number(stepAny?.lifeToPayForCost || 0);

    const sourceCard = cardId
      ? (srcZones.graveyard as any[]).find((entry: any) => entry && String(entry.id) === cardId)
      : undefined;
    if (!sourceCard) {
      emitToPlayer(io, controllerId, 'error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Card not found in graveyard' });
      return;
    }

    const manaSymbols = manaCost.match(/\{[WUBRGC0-9X\/P]+\}/gi) || [];
    const manaOnly = manaSymbols
      .filter((s) => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}')
      .join('');
    if (/\{[^}]*\/P\}/i.test(manaOnly) || /\{[^}]*X[^}]*\}/i.test(manaOnly)) {
      emitToPlayer(io, controllerId, 'error', { code: 'UNSUPPORTED_COST', message: `Unsupported activation cost (${manaOnly || 'complex cost'})` });
      return;
    }
    if (manaOnly) {
      const { getOrInitManaPool, resolveManaCostForPoolPayment, calculateTotalAvailableMana, validateManaPayment } = await import('./util.js');
      const pool = getOrInitManaPool(game.state, controllerId) as any;
      const resolved = resolveManaCostForPoolPayment(pool, manaOnly);
      if (!resolved.ok) {
        emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: (resolved as any).error || 'Insufficient mana.' });
        return;
      }
      const totalAvailable = calculateTotalAvailableMana(pool, undefined);
      const validationError = validateManaPayment(totalAvailable, resolved.coloredCost, resolved.genericCost);
      if (validationError) {
        emitToPlayer(io, controllerId, 'error', { code: 'INSUFFICIENT_MANA', message: validationError });
        return;
      }
    }

    if (Number.isFinite(lifeToPayForCost) && lifeToPayForCost > 0) {
      const currentLife = Number((game.state as any)?.life?.[controllerId] ?? 40);
      if (!Number.isFinite(currentLife) || currentLife < lifeToPayForCost) {
        emitToPlayer(io, controllerId, 'error', {
          code: 'INSUFFICIENT_LIFE',
          message: `Need to pay ${lifeToPayForCost} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
        });
        return;
      }
    }
  }

  if ((step as any)?.triggeredAbilityGraveyardSelection === true && (step as any)?.triggeredAbilityCastFromGraveyard === true) {
    const selectedCardId = String(selectedCardIds[0] || '').trim();
    const selectedCard = selectedCardId
      ? (srcZones.graveyard as any[]).find((entry: any) => entry && String(entry.id) === selectedCardId)
      : undefined;
    if (!selectedCard) {
      emitToPlayer(io, pid as any, 'error', { code: 'CARD_NOT_IN_GRAVEYARD', message: 'Selected card not found in graveyard' });
      return;
    }

    const sourceName = String(step.sourceName || cardName || 'Ability');
    const castWithoutPayingManaCost = (step as any)?.triggeredAbilityCastWithoutPayingManaCost === true;
    const mayCast = (step as any)?.triggeredAbilityMayCastFromGraveyard !== false;
    const exileAfterResolution = triggeredSourceExilesSpellCastThisWay(String((step as any)?.triggeredAbilityEffectText || ''));

    if (mayCast) {
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: pid as any,
        description: castWithoutPayingManaCost
          ? `${sourceName}: You may cast ${selectedCard?.name || 'that card'} from your graveyard without paying its mana cost.`
          : `${sourceName}: You may cast ${selectedCard?.name || 'that card'} from your graveyard.`,
        mandatory: false,
        sourceName,
        sourceId: (step as any).sourceId || effectId,
        sourceImage: (step as any).sourceImage,
        options: [
          { id: 'cast', label: `Cast ${selectedCard?.name || 'that card'}` },
          { id: 'decline', label: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        castFromGraveyardCardId: selectedCardId,
        castFromGraveyardCard: {
          ...(selectedCard as any),
          ...(exileAfterResolution ? { exileAfterResolution: true } : null),
        },
        castFromGraveyardWithoutPayingManaCost: castWithoutPayingManaCost,
        ...(exileAfterResolution ? { castFromGraveyardExileAfterResolution: true } : null),
      } as any);
    } else {
      const fakeSocket: any = {
        data: { playerId: pid, spectator: false },
        emit: (event: string, payload: unknown) => {
          emitToPlayer(io, pid as any, event as any, payload);
        },
      };

      await requestCastSpellForSocket(
        io,
        fakeSocket,
        { gameId, cardId: selectedCardId, fromZone: 'graveyard' },
        {
          skipPriorityCheck: true,
          forcedAlternateCostId: castWithoutPayingManaCost ? 'free' : undefined,
          castWithoutPayingManaCost: castWithoutPayingManaCost,
          exileAfterResolution,
          ignoreTimingRestrictions: true,
        }
      );
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const delayedReturnAt = String((step as any)?.delayedReturnAt || '').toLowerCase();
  if (delayedReturnAt === 'next_end_step' || delayedReturnAt === 'next_upkeep_selected_card_owner') {
    const scheduleEntries = selectedCardIds
      .map((cardId) => {
        const sourceOwnerId = findSelectedCardSourceOwner(cardId);
        if (!sourceOwnerId) return null;
        const fireAtStep = delayedReturnAt === 'next_upkeep_selected_card_owner' ? 'upkeep' : 'end_step';
        return {
          scheduleId: uid('delayed_graveyard_return'),
          cardId: String(cardId),
          zoneOwnerId: sourceOwnerId,
          fireAtTurnNumber: fireAtStep === 'upkeep'
            ? getNextUpkeepNotBeforeTurnNumberForResolution(game.state)
            : getNextEndStepFireTurnNumberForResolution(game.state),
          fireAtStep,
          fireAtPlayerId: fireAtStep === 'upkeep' ? sourceOwnerId : undefined,
          sourceName: String(step.sourceName || cardName || 'Delayed trigger'),
          createdBy: String(pid),
          destination,
          destinationUsesSelectedCardOwner: stepData.destinationUsesSelectedCardOwner === true,
          battlefieldControllerMode: String(stepData.battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
          battlefieldControllerId: String(stepData.battlefieldControllerId || '').trim() || undefined,
          battlefieldTapped: stepData.battlefieldTapped === true,
          battlefieldCounters: stepData.battlefieldCounters && typeof stepData.battlefieldCounters === 'object'
            ? { ...(stepData.battlefieldCounters as Record<string, number>) }
            : undefined,
          battlefieldFaceDown: stepData.battlefieldFaceDown === true,
          battlefieldSuspected: stepData.battlefieldSuspected === true,
        };
      })
      .filter(Boolean);

    (game.state as any).pendingDelayedGraveyardReturns = Array.isArray((game.state as any).pendingDelayedGraveyardReturns)
      ? (game.state as any).pendingDelayedGraveyardReturns
      : [];
    (game.state as any).pendingDelayedGraveyardReturns.push(...scheduleEntries);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'scheduleDelayedGraveyardReturn', {
        playerId: pid,
        sourceName: String(step.sourceName || cardName || 'Delayed trigger'),
        entries: scheduleEntries,
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(scheduleDelayedGraveyardReturn) failed:', e);
    }

    if (scheduleEntries.length > 0) {
      const scheduleLabel = delayedReturnAt === 'next_upkeep_selected_card_owner' ? 'the next upkeep' : 'the next end step';
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} schedules ${scheduleEntries.length} graveyard return(s) for ${scheduleLabel} (${cardName}).`,
        ts: Date.now(),
      });
    }

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  for (const cardId of selectedCardIds) {
    const sourceOwnerId = findSelectedCardSourceOwner(cardId);
    if (!sourceOwnerId) continue;

    zones[sourceOwnerId] = zones[sourceOwnerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 };
    const cardSourceZones = zones[sourceOwnerId] as any;
    cardSourceZones.graveyard = Array.isArray(cardSourceZones.graveyard) ? cardSourceZones.graveyard : [];
    cardSourceZones.exile = Array.isArray(cardSourceZones.exile) ? cardSourceZones.exile : [];

    const idx = (cardSourceZones.graveyard as any[]).findIndex((c: any) => c && String(c.id) === String(cardId));
    if (idx === -1) continue;
    const card = (cardSourceZones.graveyard as any[]).splice(idx, 1)[0];
    movedCardIds.push(String(cardId));
    movedCards.push(String(card?.name || cardId));
    movedCardSnapshots.push({
      id: String(card?.id || cardId),
      name: card?.name,
      type_line: card?.type_line,
      oracle_text: card?.oracle_text,
      mana_cost: card?.mana_cost,
      cmc: card?.cmc,
      zoneOwnerId: sourceOwnerId,
    });
    touchedZoneOwners.add(sourceOwnerId);
    recordCardLeftGraveyardThisTurn({ state: game.state } as any, sourceOwnerId, card);

    if (destination === 'hand') {
      const destinationPlayerId = stepData.destinationUsesSelectedCardOwner === true ? sourceOwnerId : pid;
      zones[destinationPlayerId] = zones[destinationPlayerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 };
      const destinationZones = zones[destinationPlayerId] as any;
      destinationZones.hand = Array.isArray(destinationZones.hand) ? destinationZones.hand : [];
      (destinationZones.hand as any[]).push({ ...(card as any), zone: 'hand' });
      touchedZoneOwners.add(destinationPlayerId);
    } else if (destination === 'battlefield') {
      const battlefield = (game.state as any).battlefield = (game.state as any).battlefield || [];
      const typeLine = String((card as any)?.type_line || '').toLowerCase();
      const isCreature = typeLine.includes('creature');
      const permanentId = uid('perm');
      const battlefieldControllerId = String(stepData.battlefieldControllerId || '').trim() || (String(stepData.battlefieldControllerMode || '').toLowerCase() === 'owner' ? sourceOwnerId : pid);
      const entersFaceDown = stepData.battlefieldFaceDown === true;
      const counters = stepData.battlefieldCounters && typeof stepData.battlefieldCounters === 'object'
        ? { ...(stepData.battlefieldCounters as Record<string, number>) }
        : {};
      const permanent: any = entersFaceDown
        ? {
            id: permanentId,
            controller: battlefieldControllerId,
            owner: sourceOwnerId,
            tapped: stepData.battlefieldTapped === true,
            counters,
            basePower: 2,
            baseToughness: 2,
            summoningSickness: true,
            card: {
              name: 'Face-down Creature',
              type_line: 'Creature',
              zone: 'battlefield',
              power: '2',
              toughness: '2',
            },
            isFaceDown: true,
            faceDownType: 'effect',
            faceUpCard: { ...(card as any), zone: 'battlefield' },
            canTurnFaceUp: isCreature,
          }
        : {
            id: permanentId,
            controller: battlefieldControllerId,
            owner: sourceOwnerId,
            tapped: stepData.battlefieldTapped === true,
            counters,
            basePower: isCreature ? parsePT((card as any).power) : undefined,
            baseToughness: isCreature ? parsePT((card as any).toughness) : undefined,
            summoningSickness: isCreature,
            card: { ...(card as any), zone: 'battlefield' },
          };
      if (stepData.battlefieldSuspected === true) {
        permanent.suspected = true;
        permanent.isSuspected = true;
        permanent.card = { ...(permanent.card || {}), suspected: true, isSuspected: true };
      }
      markPermanentEnteredFromZone(permanent, 'graveyard');
      battlefield.push(permanent);
      stampPermanentEntryTimestamp(game.state, battlefield[battlefield.length - 1]);
      createdPermanentIds.push(permanentId);
      createdBattlefieldEntries.push({ permanent, controllerId: battlefieldControllerId });
    } else if (destination === 'library_top' || destination === 'library_bottom') {
      const destinationPlayerId = stepData.destinationUsesSelectedCardOwner === true ? sourceOwnerId : pid;
      const lib = (game as any).libraries?.get(destinationPlayerId) || [];
      const libCard = { ...(card as any), zone: 'library' };
      if (destination === 'library_top') (lib as any[]).unshift(libCard);
      else (lib as any[]).push(libCard);
      (game as any).libraries?.set(destinationPlayerId, lib);
      zones[destinationPlayerId] = zones[destinationPlayerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 };
      const destinationZones = zones[destinationPlayerId] as any;
      destinationZones.library = lib;
      destinationZones.libraryCount = (lib as any[]).length;
      touchedZoneOwners.add(destinationPlayerId);
    } else if (destination === 'exile') {
      // Exile belongs to the zone owner, not the selecting player.
      (cardSourceZones.exile as any[]).push(
        stampCardExiledWithSource(card, resolveGraveyardExileSourcePermanentId(stepData)),
      );
    }
  }

  for (const ownerId of touchedZoneOwners) {
    const ownerZones = zones[ownerId] as any;
    ownerZones.graveyard = Array.isArray(ownerZones.graveyard) ? ownerZones.graveyard : [];
    ownerZones.hand = Array.isArray(ownerZones.hand) ? ownerZones.hand : [];
    ownerZones.exile = Array.isArray(ownerZones.exile) ? ownerZones.exile : [];
    ownerZones.library = Array.isArray(ownerZones.library) ? ownerZones.library : ((game as any).libraries?.get(ownerId) || []);
    ownerZones.graveyardCount = (ownerZones.graveyard as any[]).length;
    ownerZones.handCount = (ownerZones.hand as any[]).length;
    ownerZones.exileCount = (ownerZones.exile as any[]).length;
    ownerZones.libraryCount = (ownerZones.library as any[]).length;
  }


  const applyResult: GraveyardSelectionApplyResult = {
    io,
    game,
    gameId,
    step,
    pid,
    stepData,
    cardName,
    title,
    destination,
    purpose,
    collectEvidenceMinManaValue,
    effectId,
    targetPlayerId,
    minTargets,
    maxTargets,
    totalPowerLimit,
    validTargets,
    zones,
    selectedCardIds,
    movedCards,
    movedCardIds,
    movedCardSnapshots,
    createdBattlefieldEntries,
    createdPermanentIds,
    evidenceCollected,
  };

  await finishGraveyardSelectionAfterApply(applyResult);
}
