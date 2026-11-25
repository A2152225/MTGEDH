/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility generic non-mana if-body
 * (self-exile/sacrifice costs, targeting, stack, tutors).
 *
 * Public entry symbols: tryHandleActivateGenericNonMana.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { graveyardCardsAreUntargetable } from '../../state/modules/graveyardTargetingRestriction.js';
import { appendEvent } from "../../db";
import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import { markExhaustAbilityActivated } from "../../state/modules/keywordActivationState.js";
import { markPowerUpAbilityUsed } from "../../state/modules/marvelMechanicsHelpers.js";
import { isOnceDuringEachOfYourTurnActivatedEffect } from "../../../../rules-engine/src/stationPermanentUtils.js";
import { abilityTextIsOnceEachTurn, stampEquipOnceEachTurnOnStackItem } from "../../state/modules/equipOnceEachTurn.js";
import { triggerAbilityActivatedTriggers } from "../../state/modules/triggers/ability-activated.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { cardManaValue, parsePT, parseWordNumber } from "../../state/utils";
import {
  canPermanentBeTargetedByPlayer,
  parseAbilityTargeting,
  parseTargetRequirements,
} from "../../rules-engine/targeting.js";
import { isPermanentCurrentlyAttacking } from "../../state/modules/triggeredAbilityBattlefieldTargetMatch.js";
import { broadcastGame, getPlayerName } from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import { persistAbilityActivatedTriggerPushes } from "./interactionActivateBattlefieldAbilityHelpers.js";
import { notifySpellOrAbilityPutOnStack } from "../../state/modules/stackPutNotify.js";
import { payCommittedActivationEnergy } from "./activationEnergyCost.js";
import {
  matchesParsedGraveyardCardTargetType,
  persistQueuedBattlefieldAbilityStepActivation,
} from "./interactionActivationEventPersistence.js";
import type {
  ActivateGenericAbilityExtras,
  ActivateGenericAbilityMutationState,
} from "./interactionActivateGenericAbilityState.js";
import { detectTutorEffect, parseSearchCriteria } from "./interactionTutorSearchCriteriaParsing.js";
import { reviewActivatedAbilityTargets } from "../../../../rules-engine/src/aiActivatedAbilityTargets.js";
import { buildActivatedAbilityValidTargets } from "../resolutionActivatedAbilityTargetingUtils.js";
import { paySelfSourceActivationCost, type SelfSourceCostKind } from "./activationSelfSourceCost.js";

export async function tryHandleActivateGenericNonMana(
  ctx: ActivateBattlefieldAbilityContext,
  mut: ActivateGenericAbilityMutationState,
  extras: ActivateGenericAbilityExtras,
): Promise<boolean> {
  const {
    abilityText,
    requiresTap,
    requiresUntap,
    manaCost,
    requiresSelfExert,
    sacrificeType,
    isPowerUpActivation,
    powerUpAbilityIndex,
    selectedAbilityIndex,
    isExhaustActivation,
    isBoastAbility,
    oncePerTurnActivatedEffect,
    resolvedAbilityText,
    resolvedActivatedAbilityText,
  } = extras;
  let pendingLifePaymentForCost = mut.pendingLifePaymentForCost;
  let sacrificeSelfRemovalTargetId: string | undefined;
  // CR 602.2b: targets are chosen before costs are paid, so "Sacrifice/Exile this" waits.
  let deferredSelfSourceCost: SelfSourceCostKind | undefined;
  let selfSourceLastKnown: Record<string, any> | undefined;
  let persistedStackItemId = mut.persistedStackItemId;
  const tappedPermanentsForCost = mut.tappedPermanentsForCost;
  const sacrificedPermanentsForCost = mut.sacrificedPermanentsForCost;
  const pendingCounterRemovals = mut.pendingCounterRemovals;
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    selectedXValue,
    splitSecondLockActive,
    battlefield,
    permanent,
    card,
    cardName,
  } = ctx;

    // Split Second: can't activate non-mana abilities.
    if (splitSecondLockActive) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't activate abilities while a spell with split second is on the stack.",
      });
      return true;
    }

    // Any targeted activated ability needs a legal permanent before costs are paid.
    // Removal will not spend that cost on your own permanents.
    {
      const removalText = String(resolvedAbilityText || abilityText || '');
      const board = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const review = reviewActivatedAbilityTargets(
        game.state as any,
        pid as PlayerID,
        removalText,
        board,
        String(permanentId || ''),
      );
      if (review.requiresTarget && review.legal.length === 0) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `${cardName}'s ability has no legal target.`,
        });
        return true;
      }
      const actor = (game.state?.players || []).find((player: any) => String(player?.id || '') === String(pid));
      if (actor?.isAI && review.removal && !review.bestThreat) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `${cardName} has no opposing permanent worth removing.`,
        });
        return true;
      }
      if (actor?.isAI && review.bestThreat) {
        sacrificeSelfRemovalTargetId = String(review.bestThreat.permanent.id || '');
      }
    }

    // Pay tap cost only after all other costs validate and any interactive prompts
    // (e.g., Phyrexian/hybrid payment choice) have been handled.
    if (requiresTap && !(permanent as any).tapped) {
      (permanent as any).tapped = true;
      tappedPermanentsForCost.push(String(permanentId));
    }

    // Pay {Q} untap cost: the source must be tapped and is untapped as part of paying.
    if (requiresUntap && (permanent as any).tapped) {
      (permanent as any).tapped = false;
    }

    // Exile the source as part of the activation cost (e.g., "Exile this creature").
    // Conservative: only support self-exile costs that don't include additional non-mana components.
    {
      const costStr = String(manaCost || '');
      const selfExileMatch = costStr.match(/\bexile\s+(?:~|this\b)[^,]*/i);

      if (selfExileMatch) {
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bexile\s+(?:~|this\b)[^,]*/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: exile-self cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        deferredSelfSourceCost = 'exile';
      }
    }

    // Sacrifice the source as part of the activation cost (e.g., "Sacrifice this artifact").
    // Conservative: only support self-sacrifice costs that don't include additional non-mana components.
    if (sacrificeType === 'self') {
      const costStr = String(manaCost || '');

      // Optional supported additional clause: "Pay N life" (non-interactive).
      // Use the deferred payment slot so we only pay life after the activation successfully completes.
      // (This avoids charging life if later validation fails.)
      {
        const costLower = costStr.toLowerCase();
        const payLifeMatch = costStr.match(/\bpay\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/i);
        if (payLifeMatch) {
          const multiple = (costLower.match(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi) || []).length;
          if (multiple > 1 || /\bor\b/i.test(costStr)) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: pay-life costs with choices ("or") are not supported yet.`,
            });
            return true;
          }

          const raw = String(payLifeMatch[1] || '').trim();
          const n = parseWordNumber(raw, 1);
          if (!Number.isFinite(n) || n <= 0) {
            socket.emit('error', {
              code: 'UNSUPPORTED_COST',
              message: `Cannot activate ${cardName}: invalid life payment amount.`,
            });
            return true;
          }

          const currentLife = Number((game.state as any)?.life?.[pid] ?? 40);
          if (!Number.isFinite(currentLife) || currentLife < n) {
            socket.emit('error', {
              code: 'INSUFFICIENT_LIFE',
              message: `Cannot activate ${cardName}: need to pay ${n} life, but you only have ${Number.isFinite(currentLife) ? currentLife : 0}.`,
            });
            return true;
          }

          pendingLifePaymentForCost = n;
        }
      }

      const remainingNonManaCostText = costStr
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/\bpay\s+(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life\b/gi, ' ')
        // Strip "Sacrifice ~" and "Sacrifice this ..." clauses.
        .replace(/\bsacrifice\s+(?:~|this\b)[^,]*/gi, ' ')
        // The discard prompt queues a non-empty hand; discarding an empty hand costs nothing.
        .replace(/\bdiscard\s+your\s+hand\b/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();

      if (remainingNonManaCostText.length > 0) {
        socket.emit('error', {
          code: 'UNSUPPORTED_COST',
          message: `Cannot activate ${cardName}: sacrifice-self cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
        });
        return true;
      }

      deferredSelfSourceCost = 'sacrifice';
    }

    // Check if this is a tutor effect (searches library)
    const tutorInfo = detectTutorEffect(abilityText);

    const activatedAbilityTextForStack = resolvedActivatedAbilityText;
    let autoSelectedPlayerTargetIds: string[] | undefined;
    // Target prompts carry the self-source cost and life payment; the continuation pays them.
    const deferredCostStepFields = {
      ...(deferredSelfSourceCost ? { deferredSelfSourceCost } : null),
      ...(pendingLifePaymentForCost > 0 ? { deferredLifePaymentForCost: pendingLifePaymentForCost } : null),
      ...(Number(mut.pendingEnergyPaymentForCost || 0) > 0 ? { deferredEnergyPaymentForCost: Number(mut.pendingEnergyPaymentForCost) } : null),
    };
    const payDeferredSelfSourceCostNow = (): boolean => {
      if (!deferredSelfSourceCost) return true;
      const paid = paySelfSourceActivationCost(game, gameId, String(pid), String(permanentId), deferredSelfSourceCost, cardName);
      if (!paid.ok) {
        socket.emit('error', { code: paid.code, message: paid.message });
        return false;
      }
      if (deferredSelfSourceCost === 'sacrifice') sacrificedPermanentsForCost.push(String(permanentId));
      else mut.exiledSelfForCost = String(permanentId);
      selfSourceLastKnown = paid.snapshot;
      deferredSelfSourceCost = undefined;
      return true;
    };

    const parsedGraveyardTargetReqs = parseTargetRequirements(resolvedAbilityText, {
      gameState: game.state,
      controllerId: String(pid),
      sourceName: cardName,
      sourcePermanent: permanent,
    });
    const hasParsedGraveyardTargets = parsedGraveyardTargetReqs.needsTargets
      && Array.isArray(parsedGraveyardTargetReqs.targetTypes)
      && parsedGraveyardTargetReqs.targetTypes.length > 0
      && parsedGraveyardTargetReqs.targetTypes.every((targetType) => String(targetType || '').toLowerCase().startsWith('graveyard_'));

    if (hasParsedGraveyardTargets) {
      const players = Array.isArray(game.state?.players) ? game.state.players : [];
      const graveyardOwnerIds = (parsedGraveyardTargetReqs.graveyardScope === 'any'
        ? players.filter((player: any) => player?.id).map((player: any) => String(player.id))
        : [String(pid)]) as string[];
      const maxManaValue = typeof parsedGraveyardTargetReqs.targetFilterMaxManaValue === 'number'
        ? Number(parsedGraveyardTargetReqs.targetFilterMaxManaValue)
        : undefined;
      const exactManaValue = typeof (parsedGraveyardTargetReqs as any).targetFilterExactManaValue === 'number'
        ? Number((parsedGraveyardTargetReqs as any).targetFilterExactManaValue)
        : undefined;
      const minManaValue = typeof (parsedGraveyardTargetReqs as any).targetFilterMinManaValue === 'number'
        ? Number((parsedGraveyardTargetReqs as any).targetFilterMinManaValue)
        : undefined;
      const totalPowerLimit = typeof parsedGraveyardTargetReqs.targetTotalPowerLimit === 'number'
        ? Number(parsedGraveyardTargetReqs.targetTotalPowerLimit)
        : undefined;
      const validTargets = graveyardOwnerIds.flatMap((ownerId) => {
        const graveyard = Array.isArray((game.state as any)?.zones?.[ownerId]?.graveyard)
          ? (game.state as any).zones[ownerId].graveyard
          : [];
        if (graveyardCardsAreUntargetable(game.state, String(pid), String(ownerId))) return [];
        return graveyard
          .filter((card: any) => {
            if (!parsedGraveyardTargetReqs.targetTypes.some((targetType) => matchesParsedGraveyardCardTargetType(card, String(targetType)))) {
              return false;
            }
            if (typeof exactManaValue === 'number' && Number.isFinite(exactManaValue) && cardManaValue(card) !== exactManaValue) {
              return false;
            }
            if (typeof minManaValue === 'number' && Number.isFinite(minManaValue) && cardManaValue(card) < minManaValue) {
              return false;
            }
            if (typeof maxManaValue === 'number' && Number.isFinite(maxManaValue) && cardManaValue(card) > maxManaValue) {
              return false;
            }
            if (typeof totalPowerLimit === 'number' && Number.isFinite(totalPowerLimit) && totalPowerLimit > 0) {
              const typeLine = String(card?.type_line || '').toLowerCase();
              const cardPower = typeLine.includes('creature') ? parsePT(card?.power) : 0;
              if (cardPower > totalPowerLimit) {
                return false;
              }
            }
            return true;
          })
          .map((card: any) => ({
            id: String(card.id),
            name: card.name || 'Card',
            type: 'graveyard_card',
            controller: ownerId,
            zoneOwnerId: ownerId,
            imageUrl: card.image_uris?.small || card.image_uris?.normal,
          }));
      });

      if (validTargets.length < parsedGraveyardTargetReqs.minTargets) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `${cardName}'s ability requires at least ${parsedGraveyardTargetReqs.minTargets} graveyard target(s) but only ${validTargets.length} are available.`,
        });
        return true;
      }

      const useGraveyardSelection = typeof totalPowerLimit === 'number' && Number.isFinite(totalPowerLimit) && totalPowerLimit > 0;
      const zoneOwnerIds = Array.from(new Set(validTargets.map((target: any) => String(target?.zoneOwnerId || target?.controller || '')).filter(Boolean)));
      const queuedStep = useGraveyardSelection
        ? {
            type: ResolutionStepType.GRAVEYARD_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent as any).card?.image_uris?.small || (permanent as any).card?.image_uris?.normal,
            title: cardName,
            description: `Choose ${parsedGraveyardTargetReqs.targetDescription} for ${cardName}`,
            mandatory: parsedGraveyardTargetReqs.minTargets > 0,
            validTargets,
            targetTypes: parsedGraveyardTargetReqs.targetTypes,
            minTargets: parsedGraveyardTargetReqs.minTargets,
            maxTargets: parsedGraveyardTargetReqs.maxTargets,
            targetDescription: parsedGraveyardTargetReqs.targetDescription,
            targetPlayerId: zoneOwnerIds.length === 1 ? zoneOwnerIds[0] : undefined,
            destination: 'battlefield',
            totalPowerLimit,
            battlefieldAbilityTargetSelection: true,
            permanentId,
            abilityId,
            cardName,
            abilityText: resolvedAbilityText,
            activatedAbilityText: activatedAbilityTextForStack,
            tappedPermanentsForCost,
            ...(requiresSelfExert ? { requiresSelfExertForCost: true } : null),
            ...deferredCostStepFields,
          }
        : {
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: pid as PlayerID,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent as any).card?.image_uris?.small || (permanent as any).card?.image_uris?.normal,
            description: `Choose ${parsedGraveyardTargetReqs.targetDescription} for ${cardName}`,
            mandatory: parsedGraveyardTargetReqs.minTargets > 0,
            validTargets,
            targetTypes: parsedGraveyardTargetReqs.targetTypes,
            minTargets: parsedGraveyardTargetReqs.minTargets,
            maxTargets: parsedGraveyardTargetReqs.maxTargets,
            targetDescription: parsedGraveyardTargetReqs.targetDescription,
            battlefieldAbilityTargetSelection: true,
            permanentId,
            abilityId,
            cardName,
            abilityText: resolvedAbilityText,
            activatedAbilityText: activatedAbilityTextForStack,
            tappedPermanentsForCost,
            ...(requiresSelfExert ? { requiresSelfExertForCost: true } : null),
            ...deferredCostStepFields,
          };
      const targetStep = ResolutionQueueManager.addStep(gameId, queuedStep as any);

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        abilityText: resolvedAbilityText,
        activatedAbilityText: activatedAbilityTextForStack,
        tappedPermanents: tappedPermanentsForCost,
        queuedStep: {
          ...queuedStep,
          id: String((targetStep as any).id || ''),
        },
      });

      broadcastGame(io, game, gameId);
      return true;
    }

    const parsedTargetTypes = Array.isArray(parsedGraveyardTargetReqs.targetTypes)
      ? parsedGraveyardTargetReqs.targetTypes
      : [];
    const parsedTargetTypesArePlayersOnly = parsedTargetTypes.length > 0
      && parsedTargetTypes.every((targetType) => {
        const normalized = String(targetType || '').toLowerCase();
        return normalized === 'player' || normalized === 'opponent';
      });
    // Queue TARGET_SELECTION for any parsed non-graveyard target reqs (any target,
    // creature subtypes / subtype unions, multi-target lists, players). Previously
    // only multi-target / players-only fired here, so Triskelion / Swarmyard /
    // Villainous Hideout stacked with empty targets and IR all-or-nothing failed.
    const hasParsedEffectTargetSelection = parsedGraveyardTargetReqs.needsTargets
      && parsedTargetTypes.length > 0
      && !hasParsedGraveyardTargets;

    if (hasParsedEffectTargetSelection) {
      const uniqueTargets = buildActivatedAbilityValidTargets(
        game,
        String(pid),
        parsedGraveyardTargetReqs,
        { sourcePermanentId: String(permanentId), abilityText: resolvedAbilityText },
      ).map((target) => ({
        id: String(target.id),
        label: target.name || String(target.id),
        name: target.name || String(target.id),
        description: target.type === 'player' ? 'Player' : (target as any).typeLine || target.type || 'Permanent',
        imageUrl: target.imageUrl,
        type: target.type,
        controller: target.controller,
        zoneOwnerId: target.zoneOwnerId,
        life: target.life,
        isOpponent: target.isOpponent,
        tapped: (target as any).tapped === true,
        typeLine: (target as any).typeLine,
      }));

      if (uniqueTargets.length < parsedGraveyardTargetReqs.minTargets) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `${cardName}'s ability requires at least ${parsedGraveyardTargetReqs.minTargets} target(s) but only ${uniqueTargets.length} are available.`,
        });
        return true;
      }

      const autoSelectSinglePlayerTarget = parsedTargetTypesArePlayersOnly
        && uniqueTargets.length === 1
        && Number(parsedGraveyardTargetReqs.minTargets || 0) <= 1
        && Number(parsedGraveyardTargetReqs.maxTargets ?? 1) <= 1;
      if (autoSelectSinglePlayerTarget) {
        autoSelectedPlayerTargetIds = uniqueTargets.map((target) => String(target.id || '').trim()).filter(Boolean);
      } else {
      const queuedStep = {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: (permanent as any).card?.image_uris?.small || (permanent as any).card?.image_uris?.normal,
        description: `Choose ${parsedGraveyardTargetReqs.targetDescription} for ${cardName}`,
        mandatory: parsedGraveyardTargetReqs.minTargets > 0,
        validTargets: uniqueTargets,
        targetTypes: parsedGraveyardTargetReqs.targetTypes,
        minTargets: parsedGraveyardTargetReqs.minTargets,
        maxTargets: parsedGraveyardTargetReqs.maxTargets,
        targetDescription: parsedGraveyardTargetReqs.targetDescription,
        battlefieldAbilityTargetSelection: true,
        permanentId,
        abilityId,
        cardName,
        abilityText: resolvedAbilityText,
        activatedAbilityText: activatedAbilityTextForStack,
        tappedPermanentsForCost,
        ...(requiresSelfExert ? { requiresSelfExertForCost: true } : null),
        ...deferredCostStepFields,
      };
      const targetStep = ResolutionQueueManager.addStep(gameId, queuedStep as any);

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        abilityText: resolvedAbilityText,
        activatedAbilityText: activatedAbilityTextForStack,
        tappedPermanents: tappedPermanentsForCost,
        queuedStep: {
          ...queuedStep,
          id: String((targetStep as any).id || ''),
        },
      });

      broadcastGame(io, game, gameId);
      return true;
      }
    }

    const parsedBattlefieldAbilityTargeting = parseAbilityTargeting(resolvedAbilityText);
    if (parsedBattlefieldAbilityTargeting) {
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const validTargets = battlefield
        .filter((target: any) => {
          if (!target?.id || !target?.card) {
            return false;
          }

          const typeLine = String(target.card?.type_line || '').toLowerCase();
          if (parsedBattlefieldAbilityTargeting.targetType === 'creature' && !typeLine.includes('creature')) {
            return false;
          }

          if (parsedBattlefieldAbilityTargeting.controllerOnly && String(target.controller || '') !== String(pid)) {
            return false;
          }

          if (parsedBattlefieldAbilityTargeting.opponentOnly && String(target.controller || '') === String(pid)) {
            return false;
          }

          if (parsedBattlefieldAbilityTargeting.excludeSource && String(target.id || '') === String(permanentId)) {
            return false;
          }

          // Mystifying Maze / similar: "target attacking creature …"
          if (parsedBattlefieldAbilityTargeting.attackingOnly && !isPermanentCurrentlyAttacking(target)) {
            return false;
          }

          return canPermanentBeTargetedByPlayer(target as any, game.state as any, pid as any);
        })
        .map((target: any) => ({
          id: String(target.id),
          label: target.card?.name || 'Permanent',
          description: target.card?.type_line || 'Permanent',
          imageUrl: target.card?.image_uris?.small || target.card?.image_uris?.normal,
          type: 'permanent',
          controller: target.controller,
          tapped: target.tapped === true,
          typeLine: target.card?.type_line,
          oracleText: target.card?.oracle_text,
          cmc: Number(target.card?.cmc ?? 0),
          isToken: target.isToken === true,
          isOpponent: String(target.controller || '') !== String(pid),
        }));

      if (validTargets.length === 0) {
        socket.emit('error', {
          code: 'NO_VALID_TARGETS',
          message: `${cardName}'s ability has no legal ${parsedBattlefieldAbilityTargeting.description} targets.`,
        });
        return true;
      }

      const queuedStep = {
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: (permanent as any).card?.image_uris?.small || (permanent as any).card?.image_uris?.normal,
        description: `Choose ${parsedBattlefieldAbilityTargeting.description} for ${cardName}`,
        mandatory: true,
        validTargets,
        targetTypes: [parsedBattlefieldAbilityTargeting.targetType],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: parsedBattlefieldAbilityTargeting.description,
        battlefieldAbilityTargetSelection: true,
        permanentId,
        abilityId,
        cardName,
        abilityText: resolvedAbilityText,
        activatedAbilityText: activatedAbilityTextForStack,
        tappedPermanentsForCost,
        ...(requiresSelfExert ? { requiresSelfExertForCost: true } : null),
        ...deferredCostStepFields,
      };
      const targetStep = ResolutionQueueManager.addStep(gameId, queuedStep as any);

      if (typeof game.bumpSeq === 'function') {
        game.bumpSeq();
      }

      persistQueuedBattlefieldAbilityStepActivation({
        gameId,
        game,
        playerId: String(pid),
        permanentId: String(permanentId),
        abilityId: String(abilityId),
        cardName,
        abilityText: resolvedAbilityText,
        activatedAbilityText: activatedAbilityTextForStack,
        tappedPermanents: tappedPermanentsForCost,
        queuedStep: {
          ...queuedStep,
          id: String((targetStep as any).id || ''),
        },
      });

      broadcastGame(io, game, gameId);
      return true;
    }

    if (isBoastAbility) {
      (permanent as any).activatedThisTurn = true;
    }
    
    if (tutorInfo.isTutor) {
      // This is a tutor effect - handle library search
      const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
      
      if (!payDeferredSelfSourceCostNow()) return true;
      const tutorEnergyPaidForCost = payCommittedActivationEnergy(game.state, String(pid), mut.pendingEnergyPaymentForCost);
      mut.pendingEnergyPaymentForCost = 0;
      // Put the ability on the stack first
      const stackItem = {
        id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'ability' as const,
        controller: pid,
        source: permanentId,
        sourceName: cardName,
        description: resolvedAbilityText,
        activatedAbilityText: activatedAbilityTextForStack,
        abilityType: 'tutor',
        // CR 602.2 / 608.2: the search happens when the ability resolves (stackResolveDeferredTutorSearch).
        searchOnResolution: true,
        ...(autoSelectedPlayerTargetIds?.length ? { targets: autoSelectedPlayerTargetIds } : {}),
        searchParams: {
          filter,
          searchCriteria: tutorInfo.searchCriteria,
          maxSelections: tutorInfo.maxSelections || 1,
          destination: tutorInfo.destination || 'hand',
          entersTapped: tutorInfo.entersTapped,
          splitDestination: tutorInfo.splitDestination,
          toBattlefield: tutorInfo.toBattlefield,
          toHand: tutorInfo.toHand,
        },
      } as any;
      
      game.state.stack = game.state.stack || [];
      game.state.stack.push(stackItem);
      notifySpellOrAbilityPutOnStack(game as any, stackItem.id);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateTutorAbility", { 
        playerId: pid, 
        permanentId, 
        abilityId,
        cardName,
        stackId: stackItem.id,
        searchOnResolution: true,
        ...(tutorEnergyPaidForCost > 0 ? { energyPaidForCost: tutorEnergyPaidForCost } : null),
      });
      
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability. Ability on the stack.`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return true; // Early return - the library search is queued when the ability resolves
    }
    
    if (!payDeferredSelfSourceCostNow()) return true;
    // Not a tutor - put the ability on the stack normally
    if (isPowerUpActivation && powerUpAbilityIndex >= 0) {
      markPowerUpAbilityUsed(permanent, powerUpAbilityIndex);
    }

    const stackItem = {
      id: `ability_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'ability' as const,
      controller: pid,
      source: permanentId,
      sourceName: cardName,
      description: resolvedAbilityText,
      activatedAbilityText: activatedAbilityTextForStack,
      xValue: selectedXValue,
      activatedAbilityIndex: selectedAbilityIndex,
      ...(selfSourceLastKnown ? { sourceLastKnown: selfSourceLastKnown } : null),
      ...(selfSourceLastKnown && sacrificedPermanentsForCost.includes(String(permanentId)) ? { lastSacrificedPermanents: [selfSourceLastKnown] } : null),
      ...(sacrificeSelfRemovalTargetId
        ? { targets: [sacrificeSelfRemovalTargetId] }
        : autoSelectedPlayerTargetIds?.length
          ? { targets: autoSelectedPlayerTargetIds }
          : {}),
      ...(isOnceDuringEachOfYourTurnActivatedEffect(oncePerTurnActivatedEffect) || abilityTextIsOnceEachTurn(oncePerTurnActivatedEffect)
        ? { oncePerTurnActivated: true }
        : null),
      ...(isExhaustActivation ? { exhaustAbility: true } : null),
    } as any;
    
    game.state.stack = game.state.stack || [];
    if (abilityTextIsOnceEachTurn(oncePerTurnActivatedEffect) || isOnceDuringEachOfYourTurnActivatedEffect(oncePerTurnActivatedEffect)) {
      stampEquipOnceEachTurnOnStackItem(stackItem, permanent, selectedAbilityIndex, true);
    }
    game.state.stack.push(stackItem);
    persistedStackItemId = String(stackItem.id || '').trim() || undefined;
    if (isExhaustActivation) {
      markExhaustAbilityActivated(game.state, permanentId, selectedAbilityIndex);
    }

    try {
      const triggeredAbilities = triggerAbilityActivatedTriggers(game as any, {
        activatedBy: pid as any,
        sourcePermanentId: permanentId as any,
        isManaAbility: false,
        abilityText: activatedAbilityTextForStack,
        stackItemId: stackItem.id,
        isExhaustAbility: isExhaustActivation,
      });
      persistAbilityActivatedTriggerPushes(gameId, game, triggeredAbilities);
    } catch {}
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability: ${resolvedAbilityText}`,
      ts: Date.now(),
    });
  mut.pendingLifePaymentForCost = pendingLifePaymentForCost;
  mut.persistedStackItemId = persistedStackItemId;
  return false;
}
