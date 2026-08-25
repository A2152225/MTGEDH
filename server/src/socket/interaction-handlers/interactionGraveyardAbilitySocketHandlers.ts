/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: registerInteractionHandlers socket handler for
 * activateGraveyardAbility.
 *
 * Public entry symbols: handleActivateGraveyardAbilityRequest.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { adjustActivationManaCostForPayment } from "../../state/modules/ability-cost-adjustments.js";
import { buildEmbalmOrEternalizeTokenPermanent } from "../../state/modules/graveyard-tokens.js";
import {
  getGrantedEmbalmInfo,
  getGrantedUnearthInfo,
  getPrintedUnearthInfo,
} from "../../state/modules/graveyard-permissions.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { parseWordNumber } from "../../state/utils";
import { canPermanentBeTargetedByPlayer } from "../../rules-engine/targeting.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { filterLibraryCardsForSearch } from "../library-search.js";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateManaPayment,
} from "../util";
import { persistQueuedGraveyardAbilityStepActivation } from "./interactionActivationEventPersistence.js";
import {
  continueCastFromGraveyardAbility,
  createEncoreToken,
  getEncoreTargetPlayerIds,
  getNextEndStepFireTurnNumber,
} from "./interactionGraveyardCastExecution.js";
import {
  enforceSorcerySpeedGraveyardAbility,
  getExplicitGraveyardActivationCost,
  getKeywordGraveyardActivationManaCost,
  markCardLeftGraveyardLive,
  queueSelfEtbForLiveGraveyardEntry,
} from "./interactionGraveyardCastCostAndTimingRules.js";
import { detectTutorEffect, parseSearchCriteria } from "./interactionTutorSearchCriteriaParsing.js";
import { type EnsureInRoomAndSeated } from "./interactionRoomAndBattlefield.js";

// Handle graveyard ability activation
export async function handleActivateGraveyardAbilityRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  generateId: (prefix: string) => string,
  isSplitSecondLockActive: (state: any) => boolean,
  findUntappedPermanentsWithCreatureType: (
    battlefield: any[],
    playerId: string,
    creatureType: string,
  ) => any[],
  payload?: { gameId?: unknown; cardId?: unknown; abilityId?: unknown; targets?: unknown; xValue?: unknown },
): Promise<void> {
    const gameIdRaw = payload?.gameId;
    const cardId = payload?.cardId;
    const abilityId = payload?.abilityId;
    const xValue = typeof payload?.xValue === 'number' && Number.isFinite(payload.xValue)
      ? Math.max(0, Math.floor(Number(payload.xValue)))
      : undefined;

    if (!cardId || typeof cardId !== 'string') return;
    if (!abilityId || typeof abilityId !== 'string') return;

    const ctx = ensureInRoomAndSeated(gameIdRaw);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;

  // Split Second: players can't cast spells or activate non-mana abilities.
  if (isSplitSecondLockActive(game.state)) {
    socket.emit('error', {
      code: 'SPLIT_SECOND_LOCK',
      message: "Can't activate abilities while a spell with split second is on the stack.",
    });
    return;
  }
  const zones = (game.state as any)?.zones?.[pid];
  
  if (!zones || !Array.isArray(zones.graveyard)) {
    socket.emit("error", {
      code: "GRAVEYARD_NOT_FOUND",
      message: "Graveyard not found",
    });
    return;
  }
  
  // Find the card in graveyard
  const cardIndex = zones.graveyard.findIndex((c: any) => c?.id === cardId);
  if (cardIndex === -1) {
    socket.emit("error", {
      code: "CARD_NOT_IN_GRAVEYARD",
      message: "Card not found in graveyard",
    });
    return;
  }
  
  const card = zones.graveyard[cardIndex];
  const cardName = card?.name || "Unknown";
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Handle different graveyard abilities
  if (abilityId === "flashback" || abilityId === "jump-start" || abilityId === "retrace" || abilityId === "escape" || abilityId === "graveyard-cast") {
    const result = continueCastFromGraveyardAbility({
      gameId,
      game,
      io: io as any,
      playerId: String(pid),
      cardId: String(cardId),
      abilityId: String(abilityId),
      targets: payload?.targets,
      xValue,
      emitError: (errorPayload) => socket.emit('error', errorPayload),
    });
    if (result !== 'error') {
      broadcastGame(io, game, gameId);
    }
    return;
  } else if (abilityId === "unearth") {
    if (!enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), 'Unearth')) {
      return;
    }

    const printedUnearthInfo = getPrintedUnearthInfo(card);
    const grantedUnearthInfo = printedUnearthInfo.hasIt ? { hasIt: false } : getGrantedUnearthInfo(game as any, pid as any, card);
    if (!printedUnearthInfo.hasIt && !grantedUnearthInfo.hasIt) {
      socket.emit("error", {
        code: "ABILITY_NOT_AVAILABLE",
        message: `${cardName} does not currently have unearth.`,
      });
      return;
    }

    const recordedManaCost = String(printedUnearthInfo.cost || grantedUnearthInfo.cost || '').trim();
    if (recordedManaCost) {
      const costAdjustment = adjustActivationManaCostForPayment({
        state: game.state,
        activatorId: String(pid),
        sourceCard: card,
        sourceZone: 'graveyard',
        sourceController: String(pid),
        sourceId: String(cardId),
        isManaAbility: false,
        manaCostString: recordedManaCost,
        sourceName: cardName,
      });
      const effectiveManaCost = costAdjustment.adjustedManaCost || recordedManaCost;
      const parsedCost = parseManaCost(effectiveManaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${effectiveManaCost}: ${validationError}`,
        });
        return;
      }
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }

    // Return to battlefield
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    
    // Add to battlefield
    game.state.battlefield = game.state.battlefield || [];
      const createdPermanentId = generateId("perm");
      const createdPermanent = {
        id: createdPermanentId,
      controller: pid,
      owner: pid,
      tapped: false,
      wasUnearthed: true,
      unearthed: true,
      counters: {},
        leaveBattlefieldReplacementDestination: 'exile',
        leaveBattlefieldReplacementSourceName: cardName,
        card: {
          ...card,
          zone: "battlefield",
          unearth: true,
          wasUnearthed: true,
          leaveBattlefieldReplacementDestination: 'exile',
          leaveBattlefieldReplacementSourceName: cardName,
        },
    } as any;
      game.state.battlefield.push(createdPermanent);
      queueSelfEtbForLiveGraveyardEntry(game, gameId, String(pid), createdPermanent);
    const fireAtTurnNumber = getNextEndStepFireTurnNumber(game.state);
    (game.state as any).pendingExileAtNextEndStep = Array.isArray((game.state as any).pendingExileAtNextEndStep)
      ? (game.state as any).pendingExileAtNextEndStep
      : [];
    const pendingExileAtNextEndStep = (game.state as any).pendingExileAtNextEndStep as any[];
    if (!pendingExileAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === String(createdPermanentId))) {
      pendingExileAtNextEndStep.push({
        permanentId: createdPermanentId,
        fireAtTurnNumber,
        sourceName: cardName,
        createdBy: pid,
      });
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId,
      manaCost: recordedManaCost || undefined,
      createdPermanentIds: [createdPermanentId],
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} unearthed ${cardName}.`,
      ts: Date.now(),
    });
  } else if (abilityId === "embalm" || abilityId === "eternalize") {
    if (!enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), abilityId === 'eternalize' ? 'Eternalize' : 'Embalm')) {
      return;
    }

    const printedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
    const hasPrintedAbility = abilityId === 'embalm'
      ? /\bembalm\b/i.test(String(card?.oracle_text || card?.oracleText || ''))
      : /\beternalize\b/i.test(String(card?.oracle_text || card?.oracleText || ''));
    const grantedEmbalmInfo = abilityId === 'embalm' && !hasPrintedAbility
      ? getGrantedEmbalmInfo(game as any, pid as any, card)
      : { hasIt: false };
    if (!hasPrintedAbility && !grantedEmbalmInfo.hasIt) {
      socket.emit("error", {
        code: "ABILITY_NOT_AVAILABLE",
        message: `${cardName} does not currently have ${abilityId}.`,
      });
      return;
    }

    const recordedManaCost = String(printedManaCost || grantedEmbalmInfo.cost || '').trim();
    if (recordedManaCost) {
      const parsedCost = parseManaCost(recordedManaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${recordedManaCost}: ${validationError}`,
        });
        return;
      }
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }

    // Exile original from graveyard
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    
    // Move to exile
    zones.exile = zones.exile || [];
    zones.exile.push({ ...card, zone: "exile" });
    zones.exileCount = zones.exile.length;
    
    game.state.battlefield = game.state.battlefield || [];
    const createdPermanentId = generateId("token");
    const createdToken = buildEmbalmOrEternalizeTokenPermanent(
      card,
      abilityId as 'embalm' | 'eternalize',
      String(pid),
      createdPermanentId,
    );
    game.state.battlefield.push(createdToken as any);
    queueSelfEtbForLiveGraveyardEntry(game, gameId, String(pid), createdToken);
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId,
      manaCost: recordedManaCost || undefined,
      createdPermanentIds: [createdPermanentId],
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} created a token copy of ${cardName} using ${abilityId}.`,
      ts: Date.now(),
    });
  } else if (abilityId === "return-from-graveyard" || abilityId === "graveyard-activated" || (abilityId && abilityId.includes("-return-"))) {
    // Generic return from graveyard ability (like Magma Phoenix, Summon the School)
    // Parse the oracle text to determine the destination and mana cost
    const oracleText = (card.oracle_text || "").toLowerCase();
    const explicitActivationCost = getExplicitGraveyardActivationCost(card);
    let recordedManaCost: string | undefined;
    const requiresSorcerySpeed = /activate(?:\s+this ability)?\s+only\s+(?:as a sorcery|any time you could cast a sorcery)/i.test(String(card?.oracle_text || ''));

    if (requiresSorcerySpeed && !enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), cardName)) {
      return;
    }
    
    // Check for creature tap costs (Summon the School style: "Tap four untapped Merfolk you control:")
    // Pattern: "Tap X untapped [Type] you control: Return this card from your graveyard to your hand"
    const tapCreatureCostMatch = oracleText.match(/tap (\w+|\d+) untapped (\w+)(?:s)? you control:\s*return\s+(?:this card|~|it|[^.]+?)\s+from\s+(?:your\s+)?graveyard/i);
    if (tapCreatureCostMatch) {
      const countStr = tapCreatureCostMatch[1];
      const creatureType = tapCreatureCostMatch[2].toLowerCase();
      const tapCount = parseWordNumber(countStr, 1);
      
      // Find untapped creatures of the required type
      const untappedCreatures = findUntappedPermanentsWithCreatureType(
        game.state.battlefield || [],
        pid,
        creatureType
      );
      
      if (untappedCreatures.length < tapCount) {
        socket.emit("error", {
          code: "INSUFFICIENT_CREATURES",
          message: `Need ${tapCount} untapped ${creatureType}(s), but you only have ${untappedCreatures.length}.`,
        });
        return;
      }
      
      // Unified Resolution Queue prompt
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, pid as any)
        .find((s: any) => (s as any)?.tapCreaturesCost === true && String((s as any)?.cardId || '') === String(cardId));

      if (!existing) {
        const tapCostStep = ResolutionQueueManager.addStep(gameId, {
          type: ResolutionStepType.TARGET_SELECTION,
          playerId: pid as PlayerID,
          sourceName: cardName,
          sourceId: cardId,
          sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
          description: `Tap ${tapCount} untapped ${creatureType}${tapCount > 1 ? 's' : ''} you control to return ${cardName} from your graveyard to your hand.`,
          mandatory: false,
          validTargets: untappedCreatures.map((c: any) => ({
            id: c.id,
            label: c.card?.name || 'Creature',
            description: c.card?.type_line || 'Creature',
            imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
          })),
          targetTypes: ['tap_cost'],
          minTargets: tapCount,
          maxTargets: tapCount,
          targetDescription: `untapped ${creatureType}${tapCount > 1 ? 's' : ''} you control`,
          tapCreaturesCost: true,
          cardId,
          abilityId,
          creatureType,
          requiredCount: tapCount,
        } as any);

        persistQueuedGraveyardAbilityStepActivation({
          gameId,
          game,
          playerId: String(pid),
          cardId: String(cardId),
          abilityId: String(abilityId),
          queuedStep: {
            id: String((tapCostStep as any).id || ''),
            type: ResolutionStepType.TARGET_SELECTION,
            playerId: pid,
            sourceName: cardName,
            sourceId: cardId,
            sourceImage: (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal,
            description: `Tap ${tapCount} untapped ${creatureType}${tapCount > 1 ? 's' : ''} you control to return ${cardName} from your graveyard to your hand.`,
            mandatory: false,
            validTargets: untappedCreatures.map((c: any) => ({
              id: c.id,
              label: c.card?.name || 'Creature',
              description: c.card?.type_line || 'Creature',
              imageUrl: c.card?.image_uris?.small || c.card?.image_uris?.normal,
            })),
            targetTypes: ['tap_cost'],
            minTargets: tapCount,
            maxTargets: tapCount,
            targetDescription: `untapped ${creatureType}${tapCount > 1 ? 's' : ''} you control`,
            tapCreaturesCost: true,
            cardId,
            abilityId,
            creatureType,
            requiredCount: tapCount,
          },
        });
      }
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    if (explicitActivationCost.manaCost) {
      recordedManaCost = explicitActivationCost.manaCost;
      const parsedCost = parseManaCost(recordedManaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      // Validate mana payment
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${recordedManaCost}: ${validationError}`,
        });
        return;
      }
      
      // Consume mana
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }
    
    // Check for search library effects in the ability
    const tutorInfo = detectTutorEffect(card.oracle_text || "");
    
    if (tutorInfo.isTutor) {
      if (explicitActivationCost.exileSourceFromGraveyard) {
        const [exiledSourceCard] = zones.graveyard.splice(cardIndex, 1);
        zones.graveyardCount = zones.graveyard.length;
        markCardLeftGraveyardLive(game, pid, exiledSourceCard);
        zones.exile = zones.exile || [];
        zones.exile.push({ ...exiledSourceCard, zone: 'exile' });
        zones.exileCount = zones.exile.length;
      }

      // This ability involves searching the library
      // Don't remove from graveyard yet - the search needs to resolve first
      const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
      const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
      const isSplit = tutorInfo.splitDestination === true;
      const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
        : (tutorInfo.destination === 'exile') ? 'exile'
        : 'hand';
      
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
        isTutor: true,
        manaCost: recordedManaCost,
        exileSourceOnActivate: explicitActivationCost.exileSourceFromGraveyard || undefined,
        searchCriteria: tutorInfo.searchCriteria || 'any card',
        destination,
        maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
        splitDestination: isSplit,
        toBattlefield: tutorInfo.toBattlefield || 1,
        toHand: tutorInfo.toHand || 1,
        entersTapped: tutorInfo.entersTapped || false,
        filter,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
        ts: Date.now(),
      });

      // Queue library search via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: pid as PlayerID,
          sourceId: cardId,
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
        persistLibrarySearchResolve: true,
        persistLibrarySearchResolveReason: 'graveyard_ability',
        persistLibrarySearchResolveAbilityId: abilityId,
      } as any);
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // Check destination from oracle text
    let destination = "hand"; // default
    if (oracleText.includes("to the battlefield") || oracleText.includes("onto the battlefield")) {
      destination = "battlefield";
    } else if (oracleText.includes("to your hand") || oracleText.includes("into your hand")) {
      destination = "hand";
    }
    
    // Remove from graveyard
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    let createdPermanentId: string | undefined;
    
    if (destination === "battlefield") {
      // Move to battlefield
      game.state.battlefield = game.state.battlefield || [];
      createdPermanentId = generateId("perm");
      const createdPermanent = {
        id: createdPermanentId,
        controller: pid,
        owner: pid,
        tapped: false,
        counters: {},
        card: { ...card, zone: "battlefield" },
      } as any;
      game.state.battlefield.push(createdPermanent);
      queueSelfEtbForLiveGraveyardEntry(game, gameId, String(pid), createdPermanent);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} returned ${cardName} from graveyard to the battlefield.`,
        ts: Date.now(),
      });
    } else {
      // Move to hand (default)
      zones.hand = zones.hand || [];
      zones.hand.push({ ...card, zone: "hand" });
      zones.handCount = zones.hand.length;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} returned ${cardName} from graveyard to hand.`,
        ts: Date.now(),
      });
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId,
      destination,
      manaCost: recordedManaCost,
      createdPermanentIds: destination === "battlefield" ? [createdPermanentId] : undefined,
    });
  } else if (abilityId === "scavenge") {
    if (!enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), 'Scavenge')) {
      return;
    }

          const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
          const validTargets = battlefield
            .filter((permanent: any) => {
              if (!permanent?.id || !permanent?.card) return false;
              const typeLine = String(permanent.card?.type_line || '').toLowerCase();
              if (!typeLine.includes('creature')) return false;
              return canPermanentBeTargetedByPlayer(permanent as any, game.state as any, pid as any);
            })
            .map((permanent: any) => ({
              id: String(permanent.id),
              label: permanent.card?.name || 'Creature',
              description: permanent.card?.type_line || 'Creature',
              imageUrl: permanent.card?.image_uris?.small || permanent.card?.image_uris?.normal,
              type: 'permanent',
              controller: String(permanent.controller || ''),
              isOpponent: String(permanent.controller || '') !== String(pid),
              typeLine: permanent.card?.type_line,
            }));
          if (validTargets.length === 0) {
            socket.emit('error', {
              code: 'NO_VALID_TARGETS',
              message: `${cardName} requires a target creature for scavenge, but none are available.`,
            });
            return;
          }

    const recordedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
    if (recordedManaCost) {
      const parsedCost = parseManaCost(recordedManaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${recordedManaCost}: ${validationError}`,
        });
        return;
      }
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }

    // Scavenge - exile from graveyard (player needs to manually target creature for counters)
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    
    // Move to exile
    zones.exile = zones.exile || [];
    zones.exile.push({ ...card, zone: "exile" });
    zones.exileCount = zones.exile.length;
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId,
      manaCost: recordedManaCost || undefined,
    });

    const power = parseInt(card.power || "0", 10) || 0;
    const targetStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: pid as PlayerID,
      sourceId: cardId,
      sourceName: cardName,
      sourceImage: card?.image_uris?.small || card?.image_uris?.normal,
      description: `Choose target creature for ${cardName}`,
      mandatory: true,
      validTargets,
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'target creature',
      scavengeTargetSelection: true,
      cardId,
      cardName,
      counterCount: power,
    } as any);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'resolveTopOfStackPrompt', {
        playerId: pid,
        sourceId: cardId,
        queuedResolutionStep: {
          ...(targetStep as any),
        },
      });
    } catch (e) {
      debugWarn(1, 'appendEvent(resolveTopOfStackPrompt:scavenge) failed:', e);
    }

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} scavenged ${cardName}. Choose target creature for ${power} +1/+1 counter${power === 1 ? '' : 's'}.`,
      ts: Date.now(),
    });
  } else if (abilityId === "encore") {
    if (!enforceSorcerySpeedGraveyardAbility(socket, game, String(pid), 'Encore')) {
      return;
    }

    const recordedManaCost = String(getKeywordGraveyardActivationManaCost(card, abilityId) || '').trim();
    if (recordedManaCost) {
      const parsedCost = parseManaCost(recordedManaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${recordedManaCost}: ${validationError}`,
        });
        return;
      }
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }

    // Encore - exile from graveyard (creates tokens)
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    
    // Move to exile
    zones.exile = zones.exile || [];
    zones.exile.push({ ...card, zone: "exile" });
    zones.exileCount = zones.exile.length;

    const encoreTargetPlayerIds = getEncoreTargetPlayerIds(game.state, pid);
    const createdPermanentIds: string[] = [];
    const fireAtTurnNumber = getNextEndStepFireTurnNumber(game.state);
    game.state.battlefield = game.state.battlefield || [];
    (game.state as any).pendingSacrificeAtNextEndStep = Array.isArray((game.state as any).pendingSacrificeAtNextEndStep)
      ? (game.state as any).pendingSacrificeAtNextEndStep
      : [];
    for (const targetPlayerId of encoreTargetPlayerIds) {
      const tokenId = generateId("token");
      createdPermanentIds.push(tokenId);
      const token = createEncoreToken(game.state, pid, card, tokenId, targetPlayerId);
      game.state.battlefield.push(token);
      queueSelfEtbForLiveGraveyardEntry(game, gameId, String(pid), token);
      (game.state as any).pendingSacrificeAtNextEndStep.push({
        permanentId: tokenId,
        fireAtTurnNumber,
        maxManaValue: 0,
        sourceName: cardName,
        createdBy: pid,
      });
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId,
      manaCost: recordedManaCost || undefined,
      createdPermanentIds,
      encoreTargetPlayerIds,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} used encore on ${cardName}. Create a token copy for each opponent.`,
      ts: Date.now(),
    });
  } else if (abilityId === "disturb") {
    const result = continueCastFromGraveyardAbility({
      gameId,
      game,
      io: io as any,
      playerId: String(pid),
      cardId: String(cardId),
      abilityId: String(abilityId),
      targets: payload?.targets,
      xValue,
      emitError: (errorPayload) => socket.emit('error', errorPayload),
    });
    if (result !== 'error') {
      broadcastGame(io, game, gameId);
    }
    return;
  } else if (abilityId === "exile-to-add-counters" || oracleText.includes("exile this card from your graveyard") && oracleText.includes("counter")) {
    // Cards like Valiant Veteran: "{3}{W}{W}, Exile this card from your graveyard: Put a +1/+1 counter on each Soldier you control."
    // Parse the creature type from oracle text
    const counterMatch = oracleText.match(/put a \+1\/\+1 counter on each (\w+) you control/i);
    const creatureType = counterMatch ? counterMatch[1] : null;
    
    // Parse mana cost from oracle text - simplified pattern to avoid regex backtracking
    const costMatch = oracleText.match(/(\{[^}]+\}(?:[,\s]*\{[^}]+\})*)[,\s]*exile this card from your graveyard/i);
    let recordedManaCost: string | undefined;
    
    if (costMatch) {
      const manaCost = costMatch[1];
      recordedManaCost = manaCost;
      const parsedCost = parseManaCost(manaCost);
      const pool = getOrInitManaPool(game.state, pid);
      const totalAvailable = calculateTotalAvailableMana(pool, []);
      
      // Validate mana payment
      const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: `Cannot pay ${manaCost}: ${validationError}`,
        });
        return;
      }
      
      // Consume mana
      consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
    }
    
    // Remove from graveyard
    zones.graveyard.splice(cardIndex, 1);
    zones.graveyardCount = zones.graveyard.length;
    markCardLeftGraveyardLive(game, pid, card);
    
    // Move to exile
    zones.exile = zones.exile || [];
    zones.exile.push({ ...card, zone: "exile" });
    zones.exileCount = zones.exile.length;
    
    // If we have a creature type, add +1/+1 counters to those creatures
    let countersAdded = 0;
    if (creatureType) {
      const battlefield = game.state?.battlefield || [];
      for (const perm of battlefield) {
        if (perm.controller !== pid) continue;
        const typeLine = (perm.card?.type_line || "").toLowerCase();
        // Check if the permanent is a creature of the specified type
        const creatureTypePattern = new RegExp(`\\b${creatureType.toLowerCase()}s?\\b`, 'i');
        if (typeLine.includes("creature") && creatureTypePattern.test(typeLine)) {
          // Cast to any to bypass readonly restriction on counters
          const permCounters = (perm.counters || {}) as Record<string, number>;
          permCounters["+1/+1"] = (permCounters["+1/+1"] || 0) + 1;
          (perm as any).counters = permCounters;
          countersAdded++;
        }
      }
    }
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
      playerId: pid,
      cardId,
      abilityId: "exile-to-add-counters",
      creatureType,
      countersAdded,
      manaCost: recordedManaCost,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} exiled ${cardName} from graveyard, putting a +1/+1 counter on ${countersAdded} ${creatureType || "creature"}${countersAdded !== 1 ? "s" : ""}.`,
      ts: Date.now(),
    });
  } else {
    // Unknown or generic graveyard ability
    // Check for tutor/search effects in the oracle text
    const tutorInfo = detectTutorEffect(card.oracle_text || "");
    
    if (tutorInfo.isTutor) {
      const explicitActivationCost = getExplicitGraveyardActivationCost(card);
      const recordedManaCost = String(explicitActivationCost.manaCost || '').trim() || undefined;
      if (recordedManaCost) {
        const parsedCost = parseManaCost(recordedManaCost);
        const pool = getOrInitManaPool(game.state, pid);
        const totalAvailable = calculateTotalAvailableMana(pool, []);
        const validationError = validateManaPayment(totalAvailable, parsedCost.colors, parsedCost.generic);
        if (validationError) {
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: `Cannot pay ${recordedManaCost}: ${validationError}`,
          });
          return;
        }

        consumeManaFromPool(pool, parsedCost.colors, parsedCost.generic, `[activateGraveyardAbility:${cardName}]`);
      }

      if (explicitActivationCost.exileSourceFromGraveyard) {
        const [exiledSourceCard] = zones.graveyard.splice(cardIndex, 1);
        zones.graveyardCount = zones.graveyard.length;
        markCardLeftGraveyardLive(game, pid, exiledSourceCard);
        zones.exile = zones.exile || [];
        zones.exile.push({ ...exiledSourceCard, zone: 'exile' });
        zones.exileCount = zones.exile.length;
      }

      // This ability involves searching the library
      const filter = parseSearchCriteria(tutorInfo.searchCriteria || "");
      const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
      const isSplit = tutorInfo.splitDestination === true;
      const destination: any = (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
        : (tutorInfo.destination === 'exile') ? 'exile'
        : 'hand';
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      appendEvent(gameId, (game as any).seq ?? 0, "activateGraveyardAbility", {
        playerId: pid,
        cardId,
        abilityId,
        isTutor: true,
        manaCost: recordedManaCost,
        exileSourceOnActivate: explicitActivationCost.exileSourceFromGraveyard || undefined,
        searchCriteria: tutorInfo.searchCriteria || 'any card',
        destination,
        maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
        splitDestination: isSplit,
        toBattlefield: tutorInfo.toBattlefield || 1,
        toHand: tutorInfo.toHand || 1,
        entersTapped: tutorInfo.entersTapped || false,
        filter,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} activated ${cardName}'s ability from graveyard.`,
        ts: Date.now(),
      });

      // Queue library search via Resolution Queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: pid as PlayerID,
        sourceId: cardId,
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
        persistLibrarySearchResolve: true,
        persistLibrarySearchResolveReason: 'graveyard_ability',
        persistLibrarySearchResolveAbilityId: abilityId,
      } as any);
      
      broadcastGame(io, game, gameId);
      return;
    }
    
    // If no specific handler, log it and notify
    debug(2, `[activateGraveyardAbility] Unhandled ability ${abilityId} for ${cardName}`);
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated an ability on ${cardName} from graveyard.`,
      ts: Date.now(),
    });
  }
  
  broadcastGame(io, game, gameId);
}
