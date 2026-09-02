/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility generic non-mana if-body
 * (self-exile/sacrifice costs, targeting, stack, tutors).
 *
 * Public entry symbols: tryHandleActivateGenericNonMana.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { movePermanentToGraveyard } from "../../state/modules/counters_tokens.js";
import { markExhaustAbilityActivated } from "../../state/modules/keywordActivationState.js";
import { markPowerUpAbilityUsed } from "../../state/modules/marvelMechanicsHelpers.js";
import { isOnceDuringEachOfYourTurnActivatedEffect } from "../../../../rules-engine/src/stationPermanentUtils.js";
import { triggerAbilityActivatedTriggers } from "../../state/modules/triggers/ability-activated.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { cardManaValue, parsePT, parseWordNumber } from "../../state/utils";
import {
  canPermanentBeTargetedByPlayer,
  canPlayerBeTargetedByPlayer,
  normalizeRequirementTargetType,
  parseAbilityTargeting,
  parseTargetRequirements,
  selectionRequiresSharedCardType,
} from "../../rules-engine/targeting.js";
import { filterLibraryCardsForSearch } from "../library-search.js";
import { broadcastGame, getPlayerName } from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import { persistAbilityActivatedTriggerPushes } from "./interactionActivateBattlefieldAbilityHelpers.js";
import { notifySpellOrAbilityPutOnStack } from "../../state/modules/stackPutNotify.js";
import {
  matchesParsedGraveyardCardTargetType,
  persistQueuedBattlefieldAbilityStepActivation,
} from "./interactionActivationEventPersistence.js";
import type {
  ActivateGenericAbilityExtras,
  ActivateGenericAbilityMutationState,
} from "./interactionActivateGenericAbilityState.js";
import { detectTutorEffect, parseSearchCriteria } from "./interactionTutorSearchCriteriaParsing.js";

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
      const selfExileMatch = costStr.match(/\bexile\s+(?:~|this)\b[^,]*/i);

      if (selfExileMatch) {
        const remainingNonManaCostText = costStr
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/\bexile\s+(?:~|this)\b[^,]*/gi, ' ')
          .replace(/[\s,]+/g, ' ')
          .trim();

        if (remainingNonManaCostText.length > 0) {
          socket.emit('error', {
            code: 'UNSUPPORTED_COST',
            message: `Cannot activate ${cardName}: exile-self cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
          });
          return true;
        }

        try {
          const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
          const sourcePermanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === String(permanentId)) as any;
          if (!sourcePermanent) {
            socket.emit('error', {
              code: 'PERMANENT_NOT_FOUND',
              message: 'Permanent no longer on battlefield',
            });
            return true;
          }

          sourcePermanent.leaveBattlefieldReplacementDestination = 'exile';
          if (sourcePermanent.card && typeof sourcePermanent.card === 'object') {
            sourcePermanent.card.leaveBattlefieldReplacementDestination = 'exile';
          }

          const ctx = {
            state: game.state,
            libraries: (game as any).libraries,
            bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
            rng: (game as any).rng,
            gameId,
          } as any;
          const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
          const moved = movePermanentToGraveyard(ctx, String(permanentId), true);
          if (!moved) {
            socket.emit('error', {
              code: 'PERMANENT_NOT_FOUND',
              message: 'Permanent no longer on battlefield',
            });
            return true;
          }
        } catch {
          socket.emit('error', {
            code: 'EXILE_FAILED',
            message: `Failed to exile ${cardName} as part of the activation cost.`,
          });
          return true;
        }
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
        .replace(/\bsacrifice\s+(?:~|this)\b[^,]*/gi, ' ')
        .replace(/[\s,]+/g, ' ')
        .trim();

      if (remainingNonManaCostText.length > 0) {
        socket.emit('error', {
          code: 'UNSUPPORTED_COST',
          message: `Cannot activate ${cardName}: sacrifice-self cost with additional non-mana components is not supported yet (${remainingNonManaCostText}).`,
        });
        return true;
      }

      try {
        const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
        const sacrificedSourcePermanent = battlefield.find((entry: any) => entry && String((entry as any).id || '') === String(permanentId)) as any;
        const tokenGraveyardSnapshot = sacrificedSourcePermanent?.isToken && sacrificedSourcePermanent?.card
          ? { ...(sacrificedSourcePermanent.card || {}), zone: 'graveyard' }
          : null;
        const graveyardOwnerId = String(sacrificedSourcePermanent?.owner || sacrificedSourcePermanent?.controller || pid || '').trim();
        const ctx = {
          state: game.state,
          libraries: (game as any).libraries,
          bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
          rng: (game as any).rng,
          gameId,
        } as any;
        const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
        const moved = movePermanentToGraveyard(ctx, String(permanentId), true);
        if (!moved) {
          socket.emit('error', {
            code: 'PERMANENT_NOT_FOUND',
            message: 'Permanent no longer on battlefield',
          });
          return true;
        }
        if (tokenGraveyardSnapshot && graveyardOwnerId) {
          const zones = ((game.state as any).zones = (game.state as any).zones || {});
          const playerZones = (zones[graveyardOwnerId] = zones[graveyardOwnerId] || {
            hand: [],
            handCount: 0,
            libraryCount: 0,
            graveyard: [],
            graveyardCount: 0,
            exile: [],
            exileCount: 0,
          });
          playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];

          const alreadyPresent = (playerZones.graveyard as any[]).some((card: any) => {
            if (!card) return false;
            const cardId = String((card as any).id || '').trim();
            const snapshotId = String((tokenGraveyardSnapshot as any).id || '').trim();
            if (cardId && snapshotId) return cardId === snapshotId;
            return String((card as any).name || '').trim() === String((tokenGraveyardSnapshot as any).name || '').trim();
          });

          if (!alreadyPresent) {
            (playerZones.graveyard as any[]).push(tokenGraveyardSnapshot);
            playerZones.graveyardCount = (playerZones.graveyard as any[]).length;
          }
        }
        sacrificedPermanentsForCost.push(String(permanentId));
      } catch {
        socket.emit('error', {
          code: 'SACRIFICE_FAILED',
          message: `Failed to sacrifice ${cardName} as part of the activation cost.`,
        });
        return true;
      }
    }

    // Check if this is a tutor effect (searches library)
    const tutorInfo = detectTutorEffect(abilityText);

    const activatedAbilityTextForStack = resolvedActivatedAbilityText;
    let autoSelectedPlayerTargetIds: string[] | undefined;

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
    const hasParsedMultiTargetSelection = parsedGraveyardTargetReqs.needsTargets
      && parsedTargetTypes.length > 0
      && !hasParsedGraveyardTargets
      && (
        Number(parsedGraveyardTargetReqs.maxTargets ?? parsedGraveyardTargetReqs.minTargets ?? 0) > 1
        || selectionRequiresSharedCardType(parsedGraveyardTargetReqs.targetDescription, resolvedAbilityText)
        || parsedTargetTypesArePlayersOnly
      );

    if (hasParsedMultiTargetSelection) {
      const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
      const players = Array.isArray(game.state?.players) ? game.state.players : [];
      const targetControllerConstraint = String(parsedGraveyardTargetReqs.targetControllerConstraint || 'any').toLowerCase();
      const validTargets: Array<Record<string, any>> = [];

      for (const rawTargetType of parsedGraveyardTargetReqs.targetTypes) {
        const targetType = normalizeRequirementTargetType(String(rawTargetType || ''));

        if (
          targetType === 'creature'
          || targetType === 'permanent'
          || targetType === 'artifact'
          || targetType === 'enchantment'
          || targetType === 'land'
          || targetType === 'planeswalker'
          || targetType.includes('nonland')
          || targetType.includes('noncreature')
        ) {
          validTargets.push(...battlefield
            .filter((target: any) => {
              if (!target?.id || !target?.card) return false;

              const typeLine = String(target.card?.type_line || '').toLowerCase();
              if (targetControllerConstraint === 'you' && String(target.controller || '') !== String(pid)) return false;
              if (targetControllerConstraint === 'opponent' && String(target.controller || '') === String(pid)) return false;
              if (targetType === 'permanent' && !canPermanentBeTargetedByPlayer(target as any, game.state as any, pid as any)) return false;
              if (targetType.includes('nonland') && typeLine.includes('land')) return false;
              if (targetType.includes('noncreature') && typeLine.includes('creature')) return false;
              if (!targetType.includes('nonland') && !targetType.includes('noncreature') && targetType !== 'permanent' && !typeLine.includes(targetType)) return false;

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
            })));
          continue;
        }

        if (targetType === 'player' || targetType === 'opponent' || targetType === 'any') {
          const lifeDict = game.state?.life || {};
          const startingLife = game.state?.startingLife || 40;

          validTargets.push(...players
            .filter((player: any) => {
              if (!player?.id) return false;
              if (targetType === 'opponent' && String(player.id) === String(pid)) return false;
              if (targetControllerConstraint === 'opponent' && String(player.id) === String(pid)) return false;
              if (!canPlayerBeTargetedByPlayer(player.id, game.state, pid as PlayerID)) return false;
              return true;
            })
            .map((player: any) => ({
              id: String(player.id),
              label: player.name || String(player.id),
              description: 'Player',
              type: 'player',
              isOpponent: String(player.id) !== String(pid),
              life: lifeDict[player.id] ?? player.life ?? startingLife,
            })));

          if (targetType === 'any') {
            validTargets.push(...battlefield
              .filter((target: any) => {
                if (!target?.id || !target?.card) return false;
                const typeLine = String(target.card?.type_line || '').toLowerCase();
                if (!typeLine.includes('creature') && !typeLine.includes('planeswalker')) return false;
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
              })));
          }
        }
      }

      const uniqueTargets = validTargets.filter((target, index, all) => all.findIndex((candidate) => String(candidate.id) === String(target.id)) === index);
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
      const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
      
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
      });
      
      // Queue library search via Resolution Queue
      const isSplit = tutorInfo.splitDestination === true;
      const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
        : (tutorInfo.destination === 'exile') ? 'exile'
        : 'hand';
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: pid as PlayerID,
        sourceName: `${cardName}`,
        description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
        searchCriteria: tutorInfo.searchCriteria || 'any card',
        minSelections: 0,
        maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
        mandatory: false,
        destination,
        reveal: false,
        shuffleAfter: true,
        availableCards: filterLibraryCardsForSearch(library, filter, game.state, pid),
        filter,
        splitDestination: isSplit,
        toBattlefield: tutorInfo.toBattlefield || 1,
        toHand: tutorInfo.toHand || 1,
        entersTapped: tutorInfo.entersTapped || false,
      } as any);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `⚡ ${getPlayerName(game, pid)} activated ${cardName}'s ability. Ability on the stack.`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
      return true; // Early return - library search will handle the rest
    }
    
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
      ...(autoSelectedPlayerTargetIds?.length ? { targets: autoSelectedPlayerTargetIds } : {}),
      ...(isOnceDuringEachOfYourTurnActivatedEffect(oncePerTurnActivatedEffect)
        ? { oncePerTurnActivated: true }
        : null),
      ...(isExhaustActivation ? { exhaustAbility: true } : null),
    } as any;
    
    game.state.stack = game.state.stack || [];
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
