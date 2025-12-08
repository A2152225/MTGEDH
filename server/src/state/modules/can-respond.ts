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
 * Check if a permanent has an activated ability that can be activated
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
 * Main function: Determine if a player can respond
 * 
 * A player can respond if they can cast an instant/flash spell or activate an ability.
 * This is used to auto-pass priority when appropriate.
 * 
 * @param ctx Game context
 * @param playerId The player to check
 * @returns true if the player can respond, false otherwise
 */
export function canRespond(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    // Check if player can cast any spells
    if (canCastAnySpell(ctx, playerId)) {
      return true;
    }
    
    // Check if player can activate any abilities
    if (canActivateAnyAbility(ctx, playerId)) {
      return true;
    }
    
    // No responses available
    return false;
  } catch (err) {
    console.warn("[canRespond] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}
