/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: activateBattlefieldAbility fetch-land family
 * (sacrifice + search library for land cards).
 *
 * Public entry symbols: tryHandleActivateFetchLand.
 */

import { appendEvent } from "../../db";
import {
  broadcastGame,
  calculateTotalAvailableMana,
  consumeManaFromPool,
  getOrInitManaPool,
  getPlayerName,
  parseManaCost,
  validateManaPayment,
} from "../util";
import type { ActivateBattlefieldAbilityContext } from "./interactionActivateBattlefieldAbilityContext.js";
import { notifySpellOrAbilityPutOnStack } from "../../state/modules/stackPutNotify.js";
import { parseSearchCriteria } from "./interactionTutorSearchCriteriaParsing.js";

export async function tryHandleActivateFetchLand(
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
    typeLine,
    scopedAbilityFullText,
    isGenericActivatedAbilityId,
  } = ctx;

  const lowerScopedAbilityFullText = scopedAbilityFullText.toLowerCase();
  const hasLegacyAbilityToken = (token: string) => !abilityId.includes('-ability-') && abilityId.includes(token);

  // Handle fetch land ability
  // Support both legacy "fetch-land" format and new parser format like "${cardId}-fetch-${index}"
  // Also validate that this is actually a land that fetches (not a spell, creature, or artifact)
  // IMPORTANT: Creatures like Magda, Brazen Outlaw have "sacrifice...search your library" text
  // but are NOT fetch lands - they search for non-land cards (artifacts, dragons, etc.)
  const isLand = typeLine.includes("land");
  const isCreature = typeLine.includes("creature");
  const isArtifact = typeLine.includes("artifact") && !typeLine.includes("land");
  
  // A true fetch land pattern requires:
  // 1. It's a land (not creature, not non-land artifact)
  // 2. Has sacrifice + search your library
  // 3. Specifically searches for LAND cards (not artifacts, dragons, etc.)
  const hasFetchPattern = lowerScopedAbilityFullText.includes("sacrifice") && 
    lowerScopedAbilityFullText.includes("search your library") && 
    (lowerScopedAbilityFullText.includes("land card") || 
     // Check for basic land type searching like "search...for a forest or plains"
     (lowerScopedAbilityFullText.match(/search[^.]*for[^.]*(?:forest|plains|island|swamp|mountain)/) !== null));
  
  // Exclude creatures and non-land artifacts from fetch land detection
  const isFetchLandAbility = (abilityId === "fetch-land" || hasLegacyAbilityToken("-fetch-") || (isGenericActivatedAbilityId && hasFetchPattern)) && 
    isLand && !isCreature && !isArtifact && hasFetchPattern;
  if (isFetchLandAbility) {
    // Split Second: can't activate non-mana abilities.
    if (splitSecondLockActive) {
      socket.emit('error', {
        code: 'SPLIT_SECOND_LOCK',
        message: "Can't activate abilities while a spell with split second is on the stack.",
      });
      return true;
    }

    // Validate: permanent must not be tapped
    if ((permanent as any).tapped) {
      socket.emit("error", {
        code: "ALREADY_TAPPED",
        message: `${cardName} is already tapped`,
      });
      return true;
    }
    
    const fetchAbilityText = (abilityId === "fetch-land" || hasLegacyAbilityToken("-fetch-"))
      ? oracleText
      : lowerScopedAbilityFullText;

    let manaCostStr = '';
    // Parse and validate mana cost from oracle text
    // Examples: "{2}, {T}, Sacrifice ~" (Myriad Landscape), "{3}{G}, {T}, Sacrifice ~" (Blighted Woodland)
    const manaCostMatch = fetchAbilityText.match(/\{[^}]+\}(?:\s*,\s*\{[^}]+\})*(?=\s*,\s*\{t\})/i);
    if (manaCostMatch) {
      manaCostStr = manaCostMatch[0];
      const parsedCost = parseManaCost(manaCostStr);
      const manaPool = getOrInitManaPool(game.state, pid);
      
      // Check if player can pay the mana cost
      const totalAvailable = calculateTotalAvailableMana(manaPool, undefined);
      const validationError = validateManaPayment(
        totalAvailable,
        parsedCost.colors,
        parsedCost.generic
      );
      
      if (validationError) {
        socket.emit("error", {
          code: "INSUFFICIENT_MANA",
          message: validationError,
        });
        return true;
      }
      
      // Consume the mana from the pool
      consumeManaFromPool(manaPool, parsedCost.colors, parsedCost.generic);
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} paid ${manaCostStr}.`,
        ts: Date.now(),
      });
    }
    
    // Check if it's a true fetch (pay 1 life)
    const isTrueFetch = fetchAbilityText.includes("pay 1 life");
    
    // Pay life cost if required (costs are paid immediately when activating)
    if (isTrueFetch) {
      // Ensure life object exists
      if (!(game.state as any).life) {
        (game.state as any).life = {};
      }
      const life = (game.state as any).life[pid] ?? (game as any).life?.[pid] ?? 40;
      const newLife = life - 1;
      
      // Update life in all locations
      (game.state as any).life[pid] = newLife;
      if ((game as any).life) {
        (game as any).life[pid] = newLife;
      }
      
      // Also update player object for UI sync
      const players = game.state?.players || [];
      const player = players.find((p: any) => p.id === pid);
      if (player) {
        (player as any).life = newLife;
      }

      try {
        (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
        (game.state as any).lifeLostThisTurn[String(pid)] = ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + 1;
      } catch {}
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} paid 1 life (${life} → ${newLife}).`,
        ts: Date.now(),
      });
    }
    
    // Tap the permanent (part of cost - paid immediately)
    (permanent as any).tapped = true;
    
    // Remove from battlefield (sacrifice - part of cost, paid immediately)
    {
      const tokenGraveyardSnapshot = (permanent as any)?.isToken && (permanent as any)?.card
        ? { ...(((permanent as any).card || {}) as any), zone: 'graveyard' }
        : null;
      const graveyardOwnerId = String((permanent as any)?.owner || (permanent as any)?.controller || pid || '').trim();
      const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');
      const moved = movePermanentToGraveyard(game as any, String(permanentId), true);
      if (moved && tokenGraveyardSnapshot && graveyardOwnerId) {
        const zones = (((game.state as any).zones = (game.state as any).zones || {}) as any);
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
    }
    
    // Parse what land types this fetch can find
    const filter = parseSearchCriteria(fetchAbilityText);
    
    // Parse maxSelections from oracle text (e.g., "up to two" in Myriad Landscape)
    let maxSelections = 1; // Default to 1
    const upToMatch = fetchAbilityText.match(/search your library for up to (\w+)/i);
    if (upToMatch) {
      const num = upToMatch[1].toLowerCase();
      if (num === 'two') maxSelections = 2;
      else if (num === 'three') maxSelections = 3;
      else if (num === 'four') maxSelections = 4;
      else {
        const parsed = parseInt(num, 10);
        if (!isNaN(parsed)) maxSelections = parsed;
      }
    }
    
    // Detect if fetched lands enter tapped (Evolving Wilds, Terramorphic Expanse, etc.)
    // Look for patterns like:
    // - "put it onto the battlefield tapped"
    // - "put them onto the battlefield tapped"
    // - "enters the battlefield tapped"
    const entersTapped = /(?:put (?:it|them) onto|enters) the battlefield tapped/i.test(fetchAbilityText);
    
    // Build description for the ability
    let searchDescription = "Search your library for a land card";
    if (maxSelections > 1) {
      searchDescription = `Search your library for up to ${maxSelections} land cards`;
    }
    if (filter.subtypes && filter.subtypes.length > 0) {
      const landTypes = filter.subtypes.filter(s => !s.includes("basic")).map(s => s.charAt(0).toUpperCase() + s.slice(1));
      if (landTypes.length > 0) {
        const prefix = maxSelections > 1 ? `Search for up to ${maxSelections}` : "Search for a";
        searchDescription = `${prefix} ${landTypes.join(" or ")} card${maxSelections > 1 ? 's' : ''}`;
      }
      if (filter.subtypes.includes("basic")) {
        const prefix = maxSelections > 1 ? `Search for up to ${maxSelections} basic` : "Search for a basic";
        searchDescription = `${prefix} ${landTypes.join(" or ")} card${maxSelections > 1 ? 's' : ''}`;
      }
    }
    
    // Put the fetch land ability on the stack (per MTG rules, activated abilities use the stack)
    game.state.stack = game.state.stack || [];
    const abilityStackId = `ability_fetch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    game.state.stack.push({
      id: abilityStackId,
      type: 'ability',
      controller: pid,
      source: permanentId,
      abilityId,
      sourceName: cardName,
      description: `${searchDescription}, put ${maxSelections > 1 ? 'them' : 'it'} onto the battlefield${entersTapped ? ' tapped' : ''}, then shuffle`,
      activatedAbilityText: fetchAbilityText,
      abilityType: 'fetch-land',
      // Store search parameters for when the ability resolves
      searchParams: {
        filter,
        searchDescription,
        isTrueFetch,
        maxSelections,
        entersTapped,
        cardImageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      },
    } as any);
    notifySpellOrAbilityPutOnStack(game as any, abilityStackId);
    
    if (typeof game.bumpSeq === "function") {
      game.bumpSeq();
    }
    
    appendEvent(gameId, (game as any).seq ?? 0, "activateFetchland", { 
      playerId: pid, 
      permanentId, 
      abilityId, 
      cardName,
      stackId: abilityStackId,
      activatedAbilityText: fetchAbilityText,
      ...(manaCostStr ? { manaCost: manaCostStr } : {}),
      ...(isTrueFetch ? { lifePaidForCost: 1 } : {}),
      searchParams: {
        filter,
        searchDescription,
        isTrueFetch,
        maxSelections,
        entersTapped,
        cardImageUrl: card?.image_uris?.small || card?.image_uris?.normal,
      },
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} activated ${cardName}${isTrueFetch ? " (paid 1 life)" : ""}, sacrificed it. Ability on the stack.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
    return true;
  }
  

  return false;
}
