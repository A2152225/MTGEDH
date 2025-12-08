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

/**
 * Parse mana cost from a string into components
 * Adapted from util.ts for use in can-respond logic
 */
function parseManaCost(manaCost?: string): {
  colors: Record<string, number>;
  generic: number;
  hasX: boolean;
} {
  const result = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 0,
    hasX: false,
  };

  if (!manaCost) return result;

  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const token of tokens) {
    const clean = token.replace(/[{}]/g, "").toUpperCase();
    if (clean === "X") {
      result.hasX = true;
    } else if (/^\d+$/.test(clean)) {
      result.generic += parseInt(clean, 10);
    } else if (clean.length === 1 && (result.colors as any).hasOwnProperty(clean)) {
      (result.colors as any)[clean] = ((result.colors as any)[clean] || 0) + 1;
    }
  }

  return result;
}

/**
 * Get total available mana from a mana pool
 */
function getTotalManaFromPool(pool: Record<string, number>): number {
  return Object.values(pool || {}).reduce((sum, val) => sum + (val || 0), 0);
}

/**
 * Check if a player can pay a mana cost with their current mana pool
 */
function canPayManaCost(
  pool: Record<string, number>,
  parsedCost: { colors: Record<string, number>; generic: number; hasX: boolean }
): boolean {
  if (!pool) return false;

  const manaColorMap: Record<string, string> = {
    W: "white",
    U: "blue",
    B: "black",
    R: "red",
    G: "green",
    C: "colorless",
  };

  // Check if we have enough of each colored mana
  let remainingMana = getTotalManaFromPool(pool);
  for (const [color, needed] of Object.entries(parsedCost.colors)) {
    if (needed === 0) continue;
    const colorKey = manaColorMap[color];
    if (!colorKey) continue;
    
    const available = pool[colorKey] || 0;
    if (available < needed) {
      return false; // Can't pay this colored requirement
    }
    remainingMana -= needed;
  }

  // Check if we have enough remaining for generic cost
  return remainingMana >= parsedCost.generic;
}

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
 * Check if a spell has an alternate cost that can be paid
 * Examples: Force of Will, Fierce Guardianship, etc.
 */
function hasPayableAlternateCost(ctx: GameContext, playerId: PlayerID, card: any): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  const cardName = (card.name || "").toLowerCase();
  
  // Force of Will: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost"
  if (cardName.includes("force of will") || 
      (oracleText.includes("exile") && oracleText.includes("blue card") && oracleText.includes("from your hand"))) {
    const zones = state.zones?.[playerId];
    if (!zones || !Array.isArray(zones.hand)) return false;
    
    // Check if player has 1+ life and a blue card in hand (other than this card)
    const currentLife = state.life?.[playerId] ?? 40;
    if (currentLife < 1) return false;
    
    const hasBlueCard = (zones.hand as any[]).some((c: any) => 
      c && c.id !== card.id && 
      Array.isArray(c.colors) && c.colors.includes("U")
    );
    return hasBlueCard;
  }
  
  // Fierce Guardianship: "If you control a commander, you may cast this spell without paying its mana cost"
  if (cardName.includes("fierce guardianship") || 
      (oracleText.includes("if you control") && oracleText.includes("commander") && 
       oracleText.includes("without paying its mana cost"))) {
    // Check if player controls their commander on battlefield
    const battlefield = state.battlefield || [];
    const hasCommander = battlefield.some((p: any) => 
      p && p.controller === playerId && 
      (p.card?.type_line || "").toLowerCase().includes("legendary creature")
    );
    return hasCommander;
  }
  
  // Deflecting Swat: Similar to Fierce Guardianship
  if (cardName.includes("deflecting swat")) {
    const battlefield = state.battlefield || [];
    const hasCommander = battlefield.some((p: any) => 
      p && p.controller === playerId && 
      (p.card?.type_line || "").toLowerCase().includes("legendary creature")
    );
    return hasCommander;
  }
  
  // Flusterstorm: Has storm (can be cast for {U})
  // Pact cycle: Can be cast without paying mana cost (pay on next upkeep)
  if (cardName.includes("pact") && oracleText.includes("without paying its mana cost")) {
    return true; // Can always cast pacts
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
    const pool = (state as any).manaPool?.[playerId] || {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };
    
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
    const pool = (state as any).manaPool?.[playerId] || {
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
    };
    
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
