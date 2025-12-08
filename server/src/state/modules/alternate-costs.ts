/**
 * alternate-costs.ts
 * 
 * Modular helper for checking alternate casting costs.
 * This module identifies if a spell has an alternate cost that can be paid
 * instead of its regular mana cost.
 * 
 * Examples:
 * - Force of Will: Exile a blue card + pay 1 life
 * - Fierce Guardianship: Free if you control a commander
 * - Deflecting Swat: Free if you control a commander
 * - Pact cycle: Free now, pay on next upkeep
 * - Convoke: Tap creatures to pay for spell
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";

/**
 * Pattern matcher for Force of Will style alternate costs
 * "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost"
 */
export function hasForceOfWillAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  const cardName = (card.name || "").toLowerCase();
  
  // Check for Force of Will pattern in oracle text
  const hasForceOfWillPattern = 
    oracleText.includes("exile") && 
    oracleText.includes("blue card") && 
    oracleText.includes("from your hand");
  
  // Check if card name or pattern matches Force of Will
  if (!cardName.includes("force of will") && !hasForceOfWillPattern) {
    return false;
  }
  
  const zones = state.zones?.[playerId];
  if (!zones || !Array.isArray(zones.hand)) return false;
  
  // Check if player has 1+ life
  const currentLife = state.life?.[playerId] ?? 40;
  if (currentLife < 1) return false;
  
  // Check if player has a blue card in hand (other than this card)
  const hasBlueCard = (zones.hand as any[]).some((c: any) => 
    c && c.id !== card.id && 
    Array.isArray(c.colors) && c.colors.includes("U")
  );
  
  return hasBlueCard;
}

/**
 * Pattern matcher for commander-dependent free spells
 * "If you control a commander, you may cast this spell without paying its mana cost"
 */
export function hasCommanderFreeAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  const cardName = (card.name || "").toLowerCase();
  
  // Check for commander-dependent free cast pattern in oracle text
  const hasCommanderFreePattern = 
    oracleText.includes("if you control") && 
    oracleText.includes("commander") && 
    oracleText.includes("without paying its mana cost");
  
  // Check if pattern matches
  if (!hasCommanderFreePattern) {
    return false;
  }
  
  // Check if player controls their commander on battlefield
  const battlefield = state.battlefield || [];
  const hasCommander = battlefield.some((p: any) => 
    p && p.controller === playerId && 
    (p.card?.type_line || "").toLowerCase().includes("legendary creature")
  );
  
  return hasCommander;
}

/**
 * Pattern matcher for Pact cycle (free now, pay later)
 * "You may cast this spell without paying its mana cost. At the beginning of your next upkeep, pay..."
 */
export function hasPactAlternateCost(card: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  const cardName = (card.name || "").toLowerCase();
  
  // Pact cards can always be cast for free (pay on next upkeep)
  if (cardName.includes("pact") && oracleText.includes("without paying its mana cost")) {
    return true;
  }
  
  return false;
}

/**
 * Pattern matcher for Convoke
 * "Convoke (Your creatures can help cast this spell. Each creature you tap while casting 
 * this spell pays for {1} or one mana of that creature's color.)"
 */
export function hasConvokeAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for convoke keyword
  if (!oracleText.includes("convoke")) {
    return false;
  }
  
  // Check if player has any untapped creatures
  const battlefield = state.battlefield || [];
  const hasUntappedCreature = battlefield.some((p: any) => 
    p && p.controller === playerId && 
    !p.tapped &&
    (p.card?.type_line || "").toLowerCase().includes("creature")
  );
  
  return hasUntappedCreature;
}

/**
 * Pattern matcher for Delve
 * "Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)"
 */
export function hasDelveAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for delve keyword
  if (!oracleText.includes("delve")) {
    return false;
  }
  
  // Check if player has any cards in graveyard
  const zones = state.zones?.[playerId];
  if (!zones || !Array.isArray(zones.graveyard)) return false;
  
  return (zones.graveyard as any[]).length > 0;
}

/**
 * Pattern matcher for Improvise
 * "Improvise (Your artifacts can help cast this spell. Each artifact you tap while casting 
 * this spell pays for {1}.)"
 */
export function hasImproviseAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for improvise keyword
  if (!oracleText.includes("improvise")) {
    return false;
  }
  
  // Check if player has any untapped artifacts
  const battlefield = state.battlefield || [];
  const hasUntappedArtifact = battlefield.some((p: any) => 
    p && p.controller === playerId && 
    !p.tapped &&
    (p.card?.type_line || "").toLowerCase().includes("artifact")
  );
  
  return hasUntappedArtifact;
}

/**
 * Main function: Check if a spell has any payable alternate cost
 * 
 * @param ctx Game context
 * @param playerId Player attempting to cast
 * @param card Card to check
 * @returns true if an alternate cost can be paid
 */
export function hasPayableAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  // Check each alternate cost type
  if (hasForceOfWillAlternateCost(ctx, playerId, card)) return true;
  if (hasCommanderFreeAlternateCost(ctx, playerId, card)) return true;
  if (hasPactAlternateCost(card)) return true;
  if (hasConvokeAlternateCost(ctx, playerId, card)) return true;
  if (hasDelveAlternateCost(ctx, playerId, card)) return true;
  if (hasImproviseAlternateCost(ctx, playerId, card)) return true;
  
  return false;
}

/**
 * Get a description of available alternate costs for a card
 * Useful for UI display and logging
 */
export function getAlternateCostDescription(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): string[] {
  const descriptions: string[] = [];
  
  if (!card) return descriptions;
  
  if (hasForceOfWillAlternateCost(ctx, playerId, card)) {
    descriptions.push("Exile a blue card and pay 1 life");
  }
  
  if (hasCommanderFreeAlternateCost(ctx, playerId, card)) {
    descriptions.push("Cast for free (control a commander)");
  }
  
  if (hasPactAlternateCost(card)) {
    descriptions.push("Cast for free (pay on next upkeep)");
  }
  
  if (hasConvokeAlternateCost(ctx, playerId, card)) {
    descriptions.push("Convoke (tap creatures to help pay)");
  }
  
  if (hasDelveAlternateCost(ctx, playerId, card)) {
    descriptions.push("Delve (exile cards from graveyard to help pay)");
  }
  
  if (hasImproviseAlternateCost(ctx, playerId, card)) {
    descriptions.push("Improvise (tap artifacts to help pay)");
  }
  
  return descriptions;
}
