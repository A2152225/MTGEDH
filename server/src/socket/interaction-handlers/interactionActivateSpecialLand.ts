/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility special-land families
 * (hybrid mana production, storage counters, animate, hideaway play)
 * plus the shared chosen-name / timing guards that ran immediately before them.
 *
 * Public entry symbols: tryHandleActivateSpecialLand.
 */

import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { cardFromHideawayToHand, clearStoredHideawayCard } from "../../state/modules/hideawayExile.js";
import { isAbilityActivationProhibitedByChosenName } from "../../state/modules/chosen-name-restrictions.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateAndConsumeManaCostFromPool,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import {
  calculateInteractionManaPoolDelta,
  snapshotInteractionManaPool,
} from "./interactionActivationEventPersistence.js";
import { getBattlefieldActivationTimingRestrictionError } from "./interactionGraveyardCastCostAndTimingRules.js";
import {
  SPECIAL_LAND_ABILITIES,
  evaluateHideawayActivationCondition,
} from "./interactionSpecialLandAndHideaway.js";

export async function tryHandleActivateSpecialLand(
  ctx: ActivateBattlefieldAbilityContext,
): Promise<boolean> {
  const {
    io,
    socket,
    game,
    gameId,
    pid,
    permanentId,
    abilityId,
    splitSecondLockActive,
    permanent,
    card,
    cardName,
    oracleText,
    scopedAbilityFullText,
    isGenericActivatedAbilityId,
  } = ctx;

  // ========================================================================
  // Handle Special Land Activated Abilities
  // ========================================================================
  const specialLandConfig = SPECIAL_LAND_ABILITIES[cardName.toLowerCase()];
  const lowerScopedAbilityFullText = scopedAbilityFullText.toLowerCase();
  const storageCounterType = String(specialLandConfig?.counterType || '').toLowerCase();
  const isGenericHybridManaSpecialLandAbility = specialLandConfig?.type === 'hybrid_mana_production' &&
    isGenericActivatedAbilityId &&
    Boolean(specialLandConfig.cost) &&
    lowerScopedAbilityFullText.includes(String(specialLandConfig.cost || '').toLowerCase()) &&
    lowerScopedAbilityFullText.includes('add');
  const isGenericStorageAddCounterAbility = specialLandConfig?.type === 'storage_counter' &&
    isGenericActivatedAbilityId &&
    storageCounterType.length > 0 &&
    lowerScopedAbilityFullText.includes(`put a ${storageCounterType} counter on`);
  const isGenericStorageRemoveCountersAbility = specialLandConfig?.type === 'storage_counter' &&
    isGenericActivatedAbilityId &&
    storageCounterType.length > 0 &&
    lowerScopedAbilityFullText.includes('remove') &&
    lowerScopedAbilityFullText.includes(storageCounterType) &&
    lowerScopedAbilityFullText.includes('add');
  const isGenericAnimateSpecialLandAbility = specialLandConfig?.type === 'animate' &&
    isGenericActivatedAbilityId &&
    /\bbecomes\s+a\b/i.test(scopedAbilityFullText) &&
    /until end of turn/i.test(scopedAbilityFullText);
  const isGenericHideawayPlayAbility = specialLandConfig?.type === 'hideaway' &&
    isGenericActivatedAbilityId &&
    /you may play/i.test(scopedAbilityFullText) &&
    /exiled/i.test(scopedAbilityFullText);
  const hasLegacyAbilityToken = (token: string) => !abilityId.includes('-ability-') && abilityId.includes(token);
  const hasLegacyHybridManaSpecialLandAbilityId = hasLegacyAbilityToken('hybrid-mana');
  const hasLegacyStorageAddCounterAbilityId = hasLegacyAbilityToken('add-counter');
  const hasLegacyStorageRemoveCountersAbilityId = hasLegacyAbilityToken('remove-counters');
  const hasLegacyAnimateSpecialLandAbilityId = hasLegacyAbilityToken('animate');
  const hasLegacyHideawayPlayAbilityId = hasLegacyAbilityToken('play-hideaway');

  // If a special land ability will return early, we still need to enforce chosen-name activation lockouts.
  // Best-effort mapping for our special ability IDs.
  const isSpecialLandManaAbility =
    (specialLandConfig?.type === 'hybrid_mana_production' && (hasLegacyHybridManaSpecialLandAbilityId || isGenericHybridManaSpecialLandAbility)) ||
    (specialLandConfig?.type === 'storage_counter' && (hasLegacyStorageRemoveCountersAbilityId || isGenericStorageRemoveCountersAbility));

  const earlyRestriction = isAbilityActivationProhibitedByChosenName(game.state, pid as any, cardName, isSpecialLandManaAbility);
  if (earlyRestriction.prohibited) {
    const blocker = earlyRestriction.by?.sourceName || 'an effect';
    socket.emit('error', {
      code: 'CANNOT_ACTIVATE_CHOSEN_NAME',
      message: `Activated abilities of sources named "${cardName}" can't be activated (${blocker} chose that name).`,
    });
    return true;
  }

  const timingRestrictionError = getBattlefieldActivationTimingRestrictionError(
    game,
    String(pid),
    scopedAbilityFullText || oracleText,
    cardName,
  );
  if (timingRestrictionError) {
    socket.emit('error', timingRestrictionError);
    return true;
  }
  
  // 1. GRAVEN CAIRNS - Hybrid Mana Production Lands
  if (specialLandConfig?.type === 'hybrid_mana_production' && (hasLegacyHybridManaSpecialLandAbilityId || isGenericHybridManaSpecialLandAbility)) {
    // Validate: permanent must not be tapped
    if ((permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    // Parse and pay hybrid mana cost
    const hybridCost = specialLandConfig.cost!;
    const parsedCost = parseManaCost(hybridCost);
    const manaPool = getOrInitManaPool(game.state, pid);
    const manaPoolBeforePayment = snapshotInteractionManaPool(manaPool);
    
    // Check if player can pay the hybrid cost
    const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
    
    // For hybrid costs, we need special validation
    let canPay = true;
    if (parsedCost.hybrids && parsedCost.hybrids.length > 0) {
      // For each hybrid requirement, check if we can pay with one of the options
      for (const hybridOptions of parsedCost.hybrids) {
        let paidThisHybrid = false;
        for (const option of hybridOptions) {
          const colorMap: Record<string, string> = {
            'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
          };
          const colorName = colorMap[option];
          if (colorName && totalAvailable[colorName] >= 1) {
            paidThisHybrid = true;
            break;
          }
        }
        if (!paidThisHybrid) {
          canPay = false;
          break;
        }
      }
    }
    
    if (!canPay) {
      socket.emit("error", {
        code: "INSUFFICIENT_MANA",
        message: "Not enough mana to activate this ability",
      });
      return true;
    }
    
    // Consume the mana from the pool (hybrid mana)
    if (parsedCost.hybrids && parsedCost.hybrids.length > 0) {
      for (const hybridOptions of parsedCost.hybrids) {
        // Pay with the first available option
        const colorMap: Record<string, string> = {
          'W': 'white', 'U': 'blue', 'B': 'black', 'R': 'red', 'G': 'green'
        };
        for (const option of hybridOptions) {
          const colorName = colorMap[option];
          if (colorName && (manaPool as any)[colorName] >= 1) {
            (manaPool as any)[colorName] -= 1;
            break;
          }
        }
      }
    }
    
    // Tap the permanent (part of cost)
    (permanent as any).tapped = true;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated ${cardName}, paying ${hybridCost} and tapping it.`,
      ts: Date.now(),
    });
    
    // Resolution Queue: prompt player to choose how to distribute the mana
    const manaSelectionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MANA_COLOR_SELECTION,
      playerId: pid as PlayerID,
      sourceId: permanentId,
      sourceName: cardName,
      sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
      description: `Choose how to distribute ${specialLandConfig.totalMana} mana from ${cardName}.`,
      mandatory: true,
      selectionKind: 'distribution',
      permanentId,
      cardName,
      availableColors: specialLandConfig.colors!,
      totalAmount: specialLandConfig.totalMana!,
      message: `Choose how to distribute ${specialLandConfig.totalMana} mana from ${cardName}.`,
    } as any);
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        tappedPermanents: [String(permanentId)],
        paymentManaDelta: calculateInteractionManaPoolDelta(manaPoolBeforePayment, manaPool),
        queuedResolutionStep: {
          id: String((manaSelectionStep as any).id || ''),
          type: ResolutionStepType.MANA_COLOR_SELECTION,
          playerId: pid,
          sourceId: permanentId,
          sourceName: cardName,
          sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
          description: `Choose how to distribute ${specialLandConfig.totalMana} mana from ${cardName}.`,
          mandatory: true,
          selectionKind: 'distribution',
          permanentId,
          cardName,
          availableColors: [...(specialLandConfig.colors || [])],
          totalAmount: specialLandConfig.totalMana,
          message: `Choose how to distribute ${specialLandConfig.totalMana} mana from ${cardName}.`,
        },
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(activateBattlefieldAbility:hybrid-mana) failed:', e);
    }

    broadcastGame(io, game, gameId);
    return true;
  }
  
  // 2. CALCIFORM POOLS - Storage Counter Lands
  if (specialLandConfig?.type === 'storage_counter') {
    // Handle storage counter abilities
    if (hasLegacyStorageAddCounterAbilityId || isGenericStorageAddCounterAbility) {
      // {1}, {T}: Put a storage counter on ~
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return true;
      }
      
      // Pay {1} cost
      const manaPool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
      const totalMana = Object.values(totalAvailable).reduce((sum, val) => sum + val, 0);
      if (totalMana < 1) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: "Not enough mana to activate this ability",
        });
        return true;
      }
      
      const manaPoolBeforePayment = snapshotInteractionManaPool(manaPool);

      // Consume 1 generic mana
      consumeManaFromPool(manaPool, {}, 1);
      
      // Tap the permanent
      (permanent as any).tapped = true;
      
      // Add storage counter
      (permanent as any).counters = (permanent as any).counters || {};
      (permanent as any).counters[specialLandConfig.counterType!] = 
        ((permanent as any).counters[specialLandConfig.counterType!] || 0) + 1;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} put a ${specialLandConfig.counterType} counter on ${cardName}.`,
        ts: Date.now(),
      });
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          playerId: pid,
          permanentId,
          abilityId,
          cardName,
          tappedPermanents: [String(permanentId)],
          paymentManaDelta: calculateInteractionManaPoolDelta(manaPoolBeforePayment, manaPool),
          counterUpdates: [{
            permanentId: String(permanentId),
            deltas: { [specialLandConfig.counterType!]: 1 },
          }],
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(activateBattlefieldAbility:storage-add) failed:', e);
      }

      broadcastGame(io, game, gameId);
      return true;
    } else if (hasLegacyStorageRemoveCountersAbilityId || isGenericStorageRemoveCountersAbility) {
      // {T}, Remove X storage counters from ~: Add X mana in any combination of colors
      // This requires X selection UI - for now, we'll implement basic version
      // Future: Add X-cost selection modal
      
      // Validate: permanent must not be tapped
      if ((permanent as any).tapped) {
        socket.emit("error", {
          code: "ALREADY_TAPPED",
          message: `${cardName} is already tapped`,
        });
        return true;
      }
      
      const storageCounters = (permanent as any).counters?.[specialLandConfig.counterType!] || 0;
      if (storageCounters === 0) {
        socket.emit("error", {
          code: "NO_COUNTERS",
          message: `${cardName} has no ${specialLandConfig.counterType} counters`,
        });
        return true;
      }
      
      // For now, prompt with mana distribution modal for all available counters
      // Future: Add X selection first
      
      // Tap the permanent first
      (permanent as any).tapped = true;
      
      // Resolution Queue: prompt player to distribute mana (and consume counters)
      const manaSelectionStep = ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.MANA_COLOR_SELECTION,
        playerId: pid as PlayerID,
        sourceId: permanentId,
        sourceName: cardName,
        sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
        description: `Remove ${storageCounters} ${specialLandConfig.counterType} counter${storageCounters !== 1 ? 's' : ''} to add ${storageCounters} mana.`,
        mandatory: true,
        selectionKind: 'distribution',
        permanentId,
        cardName,
        availableColors: specialLandConfig.colors!,
        totalAmount: storageCounters,
        message: `Remove ${storageCounters} ${specialLandConfig.counterType} counter${storageCounters !== 1 ? 's' : ''} to add ${storageCounters} mana.`,
        isStorageCounter: true,
        counterType: specialLandConfig.counterType,
        removeCounterCount: storageCounters,
      } as any);
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }

      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
          playerId: pid,
          permanentId,
          abilityId,
          cardName,
          tappedPermanents: [String(permanentId)],
          queuedResolutionStep: {
            id: String((manaSelectionStep as any).id || ''),
            type: ResolutionStepType.MANA_COLOR_SELECTION,
            playerId: pid,
            sourceId: permanentId,
            sourceName: cardName,
            sourceImage: (permanent.card as any)?.image_uris?.small || (permanent.card as any)?.image_uris?.normal,
            description: `Remove ${storageCounters} ${specialLandConfig.counterType} counter${storageCounters !== 1 ? 's' : ''} to add ${storageCounters} mana.`,
            mandatory: true,
            selectionKind: 'distribution',
            permanentId,
            cardName,
            availableColors: [...(specialLandConfig.colors || [])],
            totalAmount: storageCounters,
            message: `Remove ${storageCounters} ${specialLandConfig.counterType} counter${storageCounters !== 1 ? 's' : ''} to add ${storageCounters} mana.`,
            isStorageCounter: true,
            counterType: specialLandConfig.counterType,
            removeCounterCount: storageCounters,
          },
        });
      } catch (e) {
        debugWarn(1, 'appendEvent(activateBattlefieldAbility:storage-remove) failed:', e);
      }

      broadcastGame(io, game, gameId);
      return true;
    }
  }
  
  // 3. MUTAVAULT - Land Animation
  if (specialLandConfig?.type === 'animate' && (hasLegacyAnimateSpecialLandAbilityId || isGenericAnimateSpecialLandAbility)) {
    // {1}: ~ becomes a 2/2 creature with all creature types until end of turn
    // Validate: permanent must not be tapped for activation
    
    // Pay {1} cost
    const manaPool = getOrInitManaPool(game.state, pid);
    const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
    const totalMana = Object.values(totalAvailable).reduce((sum, val) => sum + val, 0);
    if (totalMana < 1) {
      socket.emit("error", {
        code: "INSUFFICIENT_MANA",
        message: "Not enough mana to activate this ability",
      });
      return true;
    }
    
    const manaPoolBeforePayment = snapshotInteractionManaPool(manaPool);

    // Consume 1 generic mana
    consumeManaFromPool(manaPool, {}, 1);
    
    // Apply animation until end of turn
    (permanent as any).animatedUntilEOT = true;
    (permanent as any).basePower = specialLandConfig.power;
    (permanent as any).baseToughness = specialLandConfig.toughness;
    (permanent as any).effectivePower = specialLandConfig.power;
    (permanent as any).effectiveToughness = specialLandConfig.toughness;
    
    // Add creature type
    const currentTypes = (permanent as any).card?.type_line || "";
    if (!currentTypes.includes("Creature")) {
      (permanent as any).typeAdditions = (permanent as any).typeAdditions || [];
      (permanent as any).typeAdditions.push("Creature");
    }
    
    // Track "all creature types" - special handling needed in creature type checks
    if (specialLandConfig.creatureTypes?.includes('all')) {
      (permanent as any).hasAllCreatureTypes = true;
    } else if (specialLandConfig.creatureTypes) {
      (permanent as any).typeAdditions = (permanent as any).typeAdditions || [];
      specialLandConfig.creatureTypes.forEach(type => {
        if (!(permanent as any).typeAdditions.includes(type)) {
          (permanent as any).typeAdditions.push(type);
        }
      });
    }
    
    // Mark for end-of-turn cleanup
    (permanent as any).untilEndOfTurn = {
      removeAnimation: true,
      turn: (game.state as any).turnNumber || game.state.turn,
    };
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} animated ${cardName} into a ${specialLandConfig.power}/${specialLandConfig.toughness} creature until end of turn.`,
      ts: Date.now(),
    });
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        paymentManaDelta: calculateInteractionManaPoolDelta(manaPoolBeforePayment, manaPool),
        specialAnimation: {
          animatedUntilEOT: true,
          basePower: specialLandConfig.power,
          baseToughness: specialLandConfig.toughness,
          effectivePower: specialLandConfig.power,
          effectiveToughness: specialLandConfig.toughness,
          typeAdditions: Array.from(new Set(Array.isArray((permanent as any).typeAdditions) ? (permanent as any).typeAdditions : [])),
          hasAllCreatureTypes: (permanent as any).hasAllCreatureTypes === true,
          untilEndOfTurn: { ...(permanent as any).untilEndOfTurn },
        },
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(activateBattlefieldAbility:animate-land) failed:', e);
    }

    broadcastGame(io, game, gameId);
    return true;
  }
  
  // 4. HIDEAWAY - Face-down Exile Implementation
  // Hideaway is handled during ETB (Enter the Battlefield), not as activated ability
  // The activated ability is just playing the exiled card
  if (specialLandConfig?.type === 'hideaway' && (hasLegacyHideawayPlayAbilityId || isGenericHideawayPlayAbility)) {
    // Split Second: playing/casting is not allowed.
    if (splitSecondLockActive) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't cast spells or activate non-mana abilities while a spell with split second is on the stack.",
      });
      return true;
    }

    // Check if there's a face-down exiled card for this permanent
    const hideawayData = (permanent as any).hideawayCard;
    if (!hideawayData) {
      socket.emit("error", {
        code: "NO_HIDEAWAY_CARD",
        message: `${cardName} has no exiled card to play`,
      });
      return true;
    }
    
    const hideawayCondition = evaluateHideawayActivationCondition(game, pid, permanent);
    if (!hideawayCondition.met) {
      socket.emit("error", {
        code: "ACTIVATION_CONDITION_NOT_MET",
        message: hideawayCondition.message || `You haven't met the condition to play ${cardName}'s exiled card`,
      });
      return true;
    }

    if ((permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }

    const activationCostText = String(scopedAbilityFullText || '').split(':')[0] || '';
    const manaCost = (activationCostText.match(/\{[^}]+\}/g) || [])
      .filter(symbol => !/^\{t\}$/i.test(symbol))
      .join('');
    const manaPool = getOrInitManaPool(game.state, pid);
    const manaPoolBeforePayment = snapshotInteractionManaPool(manaPool);

    if (manaCost) {
      const paid = validateAndConsumeManaCostFromPool(manaPool as any, manaCost, {
        logPrefix: '[activateBattlefieldAbility:hideaway]',
      });
      if (!paid) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: "Not enough mana to activate this ability",
        });
        return true;
      }
    }

    (permanent as any).tapped = true;
    
    // Move the hideaway card to hand or cast it
    // For now, move to hand
    const zones = (game.state as any).zones?.[pid];
    const movedCard = cardFromHideawayToHand(hideawayData.card);
    if (zones) {
      zones.hand = zones.hand || [];
      zones.hand.push(movedCard);
      zones.handCount = zones.hand.length;
    }
    
    clearStoredHideawayCard(game.state, permanent, pid);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} played ${hideawayData.card.name} from ${cardName}.`,
      ts: Date.now(),
    });
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'activateBattlefieldAbility', {
        playerId: pid,
        permanentId,
        abilityId,
        cardName,
        tappedPermanents: [String(permanentId)],
        paymentManaDelta: calculateInteractionManaPoolDelta(manaPoolBeforePayment, manaPool),
        hideawayMovedCardToHand: movedCard,
        clearedHideawayPermanentId: String(permanentId),
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(activateBattlefieldAbility:hideaway) failed:', e);
    }

    broadcastGame(io, game, gameId);
    return true;
  }
  

  return false;
}
