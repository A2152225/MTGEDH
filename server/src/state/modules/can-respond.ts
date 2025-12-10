/**
 * can-respond.ts
 * 
 * Determines if a player can respond to something during priority.
 * This enables auto-passing priority when a player has no legal responses available.
 * 
 * A player can respond if they can:
 * 1. Cast instant spells or spells with flash
 * 2. Activate abilities (tap abilities, activated abilities with costs)
 * 3. Pay the costs required (mana, tap, life, alternate costs like Force of Will)
 * 4. Have valid targets if targeting is required
 * 
 * This is used to improve gameplay flow by automatically passing priority
 * when a player has no available responses.
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";
import { parseManaCost, canPayManaCost, getManaPoolFromState } from "./mana-check";
import { hasPayableAlternateCost } from "./alternate-costs";

/**
 * Check if a card has flash or is an instant
 */
function hasFlashOrInstant(card: any): boolean {
  if (!card) return false;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check if it's an instant
  if (typeLine.includes("instant")) {
    return true;
  }
  
  // Check if it has flash keyword
  if (oracleText.includes("flash")) {
    return true;
  }
  
  return false;
}



/**
 * Check if player can cast any instant or flash spell from hand
 */
export function canCastAnySpell(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const zones = state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) return false;
    
    // Get mana pool
    const pool = getManaPoolFromState(state, playerId);
    
    // Check each card in hand
    for (const card of zones.hand as any[]) {
      if (!card || typeof card === "string") continue;
      
      // Skip non-instant/flash cards
      if (!hasFlashOrInstant(card)) continue;
      
      // Check if player can pay the cost (either normal or alternate)
      const manaCost = card.mana_cost || "";
      const parsedCost = parseManaCost(manaCost);
      
      // Check normal mana cost
      if (canPayManaCost(pool, parsedCost)) {
        return true;
      }
      
      // Check alternate costs
      if (hasPayableAlternateCost(ctx, playerId, card)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[canCastAnySpell] Error:", err);
    return false; // Default to false on error
  }
}

/**
 * Check if an ability is a mana ability (doesn't use the stack, doesn't require priority)
 * Per MTG Rule 605.1a: A mana ability is an activated ability that:
 * - Could add mana to a player's mana pool when it resolves
 * - Isn't a loyalty ability
 * - Doesn't target
 * 
 * Mana abilities can be activated at any time without priority, so they should NOT
 * prevent auto-passing priority.
 */
function isManaAbility(oracleText: string, effectPart: string): boolean {
  if (!effectPart) return false;
  
  const effectLower = effectPart.toLowerCase();
  
  // Check if it adds mana to a player's mana pool
  // Patterns: "Add {G}", "Add {C}{C}", "Add one mana of any color", etc.
  const addsMana = /add\s+(?:\{[wubrgc]\}|\{[^}]+\}\{[^}]+\}|one mana|mana|[x\d]+\s+mana)/i.test(effectLower);
  
  if (!addsMana) return false;
  
  // Check if it targets (mana abilities can't target per Rule 605.1a)
  const hasTarget = /target/i.test(effectPart);
  if (hasTarget) return false;
  
  // Check if it's a loyalty ability (planeswalker abilities use +/- counters)
  // Loyalty abilities are not mana abilities even if they add mana
  const isLoyaltyAbility = /[+-]\d+:/i.test(oracleText);
  if (isLoyaltyAbility) return false;
  
  return true;
}

/**
 * Check if a permanent has an activated ability that can be activated
 * and requires priority (excludes mana abilities per Rule 605)
 */
function hasActivatableAbility(
  ctx: GameContext,
  playerId: PlayerID,
  permanent: any,
  pool: Record<string, number>
): boolean {
  if (!permanent || !permanent.card) return false;
  
  const { state } = ctx;
  const controller = permanent.controller;
  if (controller !== playerId) return false;
  
  const oracleText = permanent.card.oracle_text || "";
  const typeLine = (permanent.card.type_line || "").toLowerCase();
  
  // Check for tap abilities: "{T}: Effect"
  // Common patterns: "{T}: Add {G}", "{T}: Draw a card", "{T}, Sacrifice ~: Effect"
  const hasTapAbility = /\{T\}:/i.test(oracleText);
  
  if (hasTapAbility) {
    // Can only activate if not tapped
    if (permanent.tapped) return false;
    
    // Check if there's a mana cost in the ability
    const abilityMatch = oracleText.match(/\{T\}(?:,\s*([^:]+))?:\s*(.+)/i);
    if (!abilityMatch) return true; // Simple tap ability with no cost
    
    const additionalCost = abilityMatch[1] || "";
    const effect = abilityMatch[2] || "";
    
    // CRITICAL: Skip mana abilities - they don't use the stack and don't require priority
    // Per MTG Rule 605.3a, mana abilities can be activated whenever needed for payment
    if (isManaAbility(oracleText, effect)) {
      return false; // Mana abilities don't prevent auto-pass
    }
    
    // Check for mana costs in additional cost
    const manaCostMatch = additionalCost.match(/\{[^}]+\}/g);
    if (manaCostMatch) {
      const costString = manaCostMatch.join("");
      const parsedCost = parseManaCost(costString);
      if (!canPayManaCost(pool, parsedCost)) {
        return false;
      }
    }
    
    // Check for sacrifice costs
    if (additionalCost.toLowerCase().includes("sacrifice")) {
      // Would need to check if player has permanents to sacrifice
      // For now, assume they might have one
      return true;
    }
    
    // Check for life payment costs
    if (additionalCost.toLowerCase().includes("pay") && additionalCost.toLowerCase().includes("life")) {
      const lifeMatch = additionalCost.match(/pay (\d+) life/i);
      if (lifeMatch) {
        const lifeCost = parseInt(lifeMatch[1], 10);
        const currentLife = state.life?.[playerId] ?? 40;
        if (currentLife < lifeCost) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  // Check for other activated abilities: "{Cost}: Effect"
  // Pattern: Mana symbols or other costs followed by colon
  const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*:\s*(.+)/gi;
  const matches = [...oracleText.matchAll(activatedAbilityPattern)];
  
  for (const match of matches) {
    const costPart = match[1];
    const effectPart = match[2];
    
    // Skip if this is just a mana ability we already checked
    if (costPart.includes("{T}") && hasTapAbility) continue;
    
    // Skip mana abilities - they don't require priority
    if (isManaAbility(oracleText, effectPart)) {
      continue;
    }
    
    // Skip sorcery-speed abilities (Equip, Reconfigure, etc.)
    // These can only be activated during main phase when stack is empty
    const effectLower = effectPart.toLowerCase();
    
    // Equip is sorcery-speed by default (Rule 702.6a)
    // Only a few exceptions exist (Cranial Plating, Lightning Greaves in some contexts)
    // For safety, we'll consider ALL equip abilities as sorcery-speed unless explicitly stated otherwise
    if (effectLower.includes("equip") || effectLower.includes("reconfigure")) {
      continue; // Skip all equip/reconfigure abilities
    }
    
    // Skip other sorcery-speed only abilities
    // Pattern: "Activate only as a sorcery" or "Activate only any time you could cast a sorcery"
    if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
      continue; // Skip sorcery-speed ability
    }
    
    // Parse the cost
    const parsedCost = parseManaCost(costPart);
    
    // Check if we can pay it
    if (canPayManaCost(pool, parsedCost)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if player can activate any abilities
 */
export function canActivateAnyAbility(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    
    // Get mana pool
    const pool = getManaPoolFromState(state, playerId);
    
    // Check each permanent on battlefield
    for (const permanent of battlefield) {
      if (hasActivatableAbility(ctx, playerId, permanent, pool)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[canActivateAnyAbility] Error:", err);
    return false;
  }
}

/**
 * Check if game is currently in a main phase
 */
function isInMainPhase(ctx: GameContext): boolean {
  try {
    const step = (ctx.state as any).step;
    if (!step) return false;
    
    // Main phases are MAIN_1 (pre-combat) and MAIN_2 (post-combat)
    const stepStr = String(step).toUpperCase();
    return stepStr === 'MAIN_1' || stepStr === 'MAIN_2' || stepStr === 'MAIN' || stepStr.includes('MAIN');
  } catch (err) {
    console.warn("[isInMainPhase] Error:", err);
    // Default to true to be conservative (don't auto-pass if uncertain)
    return true;
  }
}

/**
 * Check if player can play a land
 * This includes:
 * - Having a land in hand
 * - Having a land in graveyard AND an effect that allows playing from graveyard
 * - Having a land in exile AND an effect that allows playing from exile
 * - Having pending play effects (impulse draw, etc.)
 * - Not having reached the land play limit for this turn
 * 
 * NOTE: Caller should verify game is in main phase with empty stack before calling
 */
export function canPlayLand(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) {
      console.log(`[canPlayLand] ${playerId}: No state`);
      return false;
    }
    
    const zones = state.zones?.[playerId];
    if (!zones) {
      console.log(`[canPlayLand] ${playerId}: No zones found`);
      return false;
    }
    
    // Check if player has already played maximum lands this turn
    const landsPlayedThisTurn = (state.landsPlayedThisTurn as any)?.[playerId] ?? 0;
    const maxLandsPerTurn = 1; // Standard MTG rule
    
    if (landsPlayedThisTurn >= maxLandsPerTurn) {
      console.log(`[canPlayLand] ${playerId}: Already played max lands this turn (${landsPlayedThisTurn}/${maxLandsPerTurn})`);
      return false; // Already played max lands
    }
    
    // Check if player has a land card in hand
    if (Array.isArray(zones.hand)) {
      console.log(`[canPlayLand] ${playerId}: Checking hand with ${zones.hand.length} cards`);
      
      // Log first few cards in hand for debugging
      const sampleCards = zones.hand.slice(0, 3).map((c: any) => {
        if (!c || typeof c === "string") return `string:${c}`;
        return `${c.name || 'unknown'}(${(c.type_line || '').substring(0, 20)})`;
      });
      console.log(`[canPlayLand] ${playerId}: Sample cards in hand: [${sampleCards.join(', ')}]`);
      
      for (const card of zones.hand as any[]) {
        if (!card || typeof card === "string") continue;
        
        const typeLine = (card.type_line || "").toLowerCase();
        if (typeLine.includes("land")) {
          console.log(`[canPlayLand] ${playerId}: Found land in hand: ${card.name || 'unknown'} (${card.type_line || 'unknown type'})`);
          return true; // Found a land in hand that can be played
        }
      }
      console.log(`[canPlayLand] ${playerId}: No lands found in hand of ${zones.hand.length} cards`);
    } else {
      console.log(`[canPlayLand] ${playerId}: zones.hand is not an array:`, typeof zones.hand, zones.hand);
    }
    
    // Check if player can play lands from graveyard
    const canPlayFromGraveyard = hasPlayFromZoneEffect(ctx, playerId, "graveyard");
    
    if (canPlayFromGraveyard && Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        if (!card || typeof card === "string") continue;
        
        const typeLine = (card.type_line || "").toLowerCase();
        if (typeLine.includes("land")) {
          return true; // Found a land in graveyard and can play it
        }
      }
    }
    
    // Check if player can play lands from exile
    // This covers: Aetherworks Marvel, Golos, impulse draw effects (Light Up the Stage, etc.)
    const canPlayFromExile = hasPlayFromZoneEffect(ctx, playerId, "exile");
    
    if (canPlayFromExile) {
      // Check exile zone for lands
      const exileZone = (state as any).exile?.[playerId];
      if (Array.isArray(exileZone)) {
        for (const card of exileZone as any[]) {
          if (!card || typeof card === "string") continue;
          
          const typeLine = (card.type_line || "").toLowerCase();
          if (typeLine.includes("land")) {
            return true; // Found a land in exile and can play it
          }
        }
      }
    }
    
    // Check for "play from top of library" effects (Experimental Frenzy, Future Sight, etc.)
    if (hasPlayFromTopOfLibraryEffect(ctx, playerId)) {
      // Library is stored in ctx.libraries Map, not in zones
      const libraries = (ctx as any).libraries;
      if (libraries && typeof libraries.get === 'function') {
        const library = libraries.get(playerId);
        if (Array.isArray(library) && library.length > 0) {
          const topCard = library[library.length - 1]; // Top of library is last element
          if (topCard && typeof topCard !== "string") {
            const typeLine = (topCard.type_line || "").toLowerCase();
            if (typeLine.includes("land")) {
              return true; // Can play land from top of library
            }
          }
        }
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[canPlayLand] Error:", err);
    return false;
  }
}

/**
 * Check if player has an effect that allows playing cards from a specific zone
 * @param zone - The zone to check (graveyard, exile, etc.)
 */
function hasPlayFromZoneEffect(ctx: GameContext, playerId: PlayerID, zone: string): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      // Only check permanents controlled by this player
      if (permanent.controller !== playerId) continue;
      
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      
      // Check for "you may play" or "you may cast" from the specified zone
      const hasPlayText = oracleText.includes("you may play") || oracleText.includes("you may cast");
      const hasZone = oracleText.includes(zone);
      
      if (hasPlayText && hasZone) {
        // Additional check for lands specifically
        if (zone === "graveyard" && oracleText.includes("land")) {
          return true;
        }
        // For exile, be more generous as it often comes from impulse draw effects
        if (zone === "exile") {
          return true;
        }
      }
      
      // Special case: "play cards from exile" or "cast cards from exile"
      if (zone === "exile" && 
          (oracleText.includes("play") || oracleText.includes("cast")) && 
          oracleText.includes("from exile")) {
        return true;
      }
    }
    
    // Check for temporary effects stored in game state
    // Many impulse draw effects store exiled cards with "can play until end of turn" markers
    const stateAny = state as any;
    if (zone === "exile" && stateAny.playableFromExile) {
      const playableCards = stateAny.playableFromExile[playerId];
      if (playableCards && (Array.isArray(playableCards) ? playableCards.length > 0 : Object.keys(playableCards).length > 0)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[hasPlayFromZoneEffect] Error:", err);
    return false;
  }
}

/**
 * Check if player has "play from top of library" effect
 * Examples: Experimental Frenzy, Future Sight, Bolas's Citadel
 */
function hasPlayFromTopOfLibraryEffect(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      // Only check permanents controlled by this player
      if (permanent.controller !== playerId) continue;
      
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      
      // Check for various patterns of "play from top of library"
      if ((oracleText.includes("you may play") || oracleText.includes("you may cast")) &&
          (oracleText.includes("top") || oracleText.includes("off the top")) &&
          (oracleText.includes("library") || oracleText.includes("your library"))) {
        return true;
      }
      
      // Special case for Experimental Frenzy and similar
      if (oracleText.includes("play") && 
          oracleText.includes("from the top of your library")) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[hasPlayFromTopOfLibraryEffect] Error:", err);
    return false;
  }
}

/**
 * Determine if a player can respond to something on the stack or during priority.
 * 
 * A player can respond if they can cast an instant/flash spell or activate an ability
 * that uses the stack. This is used for auto-passing non-active players.
 * 
 * NOTE: This function is intentionally STRICT - it only returns true if the player
 * has instant-speed responses available. For the active player during their own turn,
 * use canAct() instead, which is more conservative.
 * 
 * @param ctx Game context
 * @param playerId The player to check
 * @returns true if the player can respond, false otherwise
 */
export function canRespond(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    console.log(`[canRespond] ${playerId}: checking instant-speed responses only`);
    
    // Check if player can cast any instant/flash spells
    if (canCastAnySpell(ctx, playerId)) {
      console.log(`[canRespond] ${playerId}: Can cast instant/flash spell`);
      return true;
    }
    
    // Check if player can activate any abilities
    if (canActivateAnyAbility(ctx, playerId)) {
      console.log(`[canRespond] ${playerId}: Can activate ability`);
      return true;
    }
    
    // No instant-speed responses available
    console.log(`[canRespond] ${playerId}: No instant-speed responses available (returning false)`);
    return false;
  } catch (err) {
    console.warn("[canRespond] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Determine if the active player can take any action during their turn.
 * 
 * This is a MORE CONSERVATIVE check than canRespond - it returns true if the player
 * can take ANY action, including:
 * - Instant/flash spells (checked by canRespond)
 * - Activated abilities (checked by canRespond)
 * - Playing lands (if lands played < maxLands AND in main phase with empty stack)
 * - Sorcery-speed spells (if in main phase with empty stack)
 * 
 * This function should be used for the active player (turn player) to decide if they
 * should be auto-passed. The active player should almost NEVER be auto-passed during
 * their main phase if they have any possible actions.
 * 
 * @param ctx Game context
 * @param playerId The player to check (should be the active player)
 * @returns true if the player can take any action, false otherwise
 */
export function canAct(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const currentStep = String((ctx.state as any).step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !ctx.state.stack || ctx.state.stack.length === 0;
    
    console.log(`[canAct] ${playerId}: step=${currentStep}, isMainPhase=${isMainPhase}, stackIsEmpty=${stackIsEmpty}`);
    
    // First check instant-speed responses (same as canRespond)
    if (canCastAnySpell(ctx, playerId)) {
      console.log(`[canAct] ${playerId}: Can cast instant/flash spell - returning TRUE`);
      return true;
    }
    
    if (canActivateAnyAbility(ctx, playerId)) {
      console.log(`[canAct] ${playerId}: Can activate ability - returning TRUE`);
      return true;
    }
    
    // During main phase with empty stack, check sorcery-speed actions
    if (isMainPhase && stackIsEmpty) {
      console.log(`[canAct] ${playerId}: In main phase with empty stack, checking sorcery-speed actions`);
      
      // Check if player can play a land
      if (canPlayLand(ctx, playerId)) {
        console.log(`[canAct] ${playerId}: Can play land - returning TRUE`);
        return true;
      }
      
      // Check if player can cast any sorcery-speed spells
      if (canCastAnySorcerySpeed(ctx, playerId)) {
        console.log(`[canAct] ${playerId}: Can cast sorcery-speed spell - returning TRUE`);
        return true;
      }
      
      console.log(`[canAct] ${playerId}: No sorcery-speed actions available in main phase - returning FALSE`);
    } else {
      console.log(`[canAct] ${playerId}: Not in main phase with empty stack (phase check failed or stack not empty) - returning FALSE`);
    }
    
    // No actions available
    console.log(`[canAct] ${playerId}: No actions available - returning FALSE`);
    return false;
  } catch (err) {
    console.warn("[canAct] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Check if player can cast any sorcery-speed spell from hand
 * (creatures, sorceries, artifacts, enchantments, planeswalkers)
 */
function canCastAnySorcerySpeed(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const zones = state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) return false;
    
    // Get mana pool
    const pool = getManaPoolFromState(state, playerId);
    
    // Check each card in hand
    for (const card of zones.hand as any[]) {
      if (!card || typeof card === "string") continue;
      
      const typeLine = (card.type_line || "").toLowerCase();
      
      // Check if it's a sorcery-speed spell (not instant, not land)
      const isSorcerySpeed = 
        typeLine.includes("creature") ||
        typeLine.includes("sorcery") ||
        typeLine.includes("artifact") ||
        typeLine.includes("enchantment") ||
        typeLine.includes("planeswalker") ||
        typeLine.includes("battle");
      
      // Skip if it's instant or has flash (already checked in canCastAnySpell)
      if (typeLine.includes("instant") || (card.oracle_text || "").toLowerCase().includes("flash")) {
        continue;
      }
      
      // Skip lands (checked separately in canPlayLand)
      if (typeLine.includes("land")) {
        continue;
      }
      
      if (!isSorcerySpeed) continue;
      
      // Check if player can pay the cost (either normal or alternate)
      const manaCost = card.mana_cost || "";
      const parsedCost = parseManaCost(manaCost);
      
      // Check normal mana cost
      if (canPayManaCost(pool, parsedCost)) {
        return true;
      }
      
      // Check alternate costs
      if (hasPayableAlternateCost(ctx, playerId, card)) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[canCastAnySorcerySpeed] Error:", err);
    return false;
  }
}
