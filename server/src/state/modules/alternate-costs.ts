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
 * - Mutate: Cast for mutate cost targeting a non-Human creature
 * - Jodah/Fist of Suns: Pay {W}{U}{B}{R}{G} for any spell
 * - Omniscience: Cast from hand without paying mana cost
 * - Bringers: Self-WUBRG alternate cost
 */

import type { GameContext } from "../context";
import type { PlayerID } from "../../../../shared/src";

/**
 * Alternate cost types
 */
export type AlternateCostType = 
  | 'force_of_will'
  | 'commander_free'
  | 'pact'
  | 'convoke'
  | 'delve'
  | 'improvise'
  | 'mutate'
  | 'evoke'
  | 'overload'
  | 'dash'
  | 'flashback'
  | 'surge'
  | 'spectacle'
  | 'kicker'
  | 'multikicker'
  | 'buyback'
  | 'madness'
  | 'emerge'
  | 'prowl'
  | 'ninjutsu'
  | 'wubrg_external'
  | 'omniscience'
  | 'wubrg_self'
  | 'alternate';

/**
 * Represents an available alternate cost option
 */
export interface AlternateCostOption {
  type: AlternateCostType;
  name: string;
  description: string;
  manaCost?: string;
  sourceName?: string;
  sourceId?: string;
  requiresTarget?: boolean;
  targetType?: 'non_human_creature' | 'creature' | 'player' | 'permanent';
  additionalEffects?: string[];
}

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
 * 
 * This now checks if convoke can ACTUALLY help pay for the spell, not just if creatures exist.
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
  
  // Get all untapped creatures controlled by the player
  const battlefield = state.battlefield || [];
  const untappedCreatures = battlefield.filter((p: any) => 
    p && p.controller === playerId && 
    !p.tapped &&
    (p.card?.type_line || "").toLowerCase().includes("creature")
  );
  
  // If no untapped creatures, convoke can't help
  if (untappedCreatures.length === 0) {
    return false;
  }
  
  // Import parseManaCost from mana-check to analyze the spell's cost
  const { parseManaCost, getAvailableMana, canPayManaCost } = require('./mana-check');
  
  // Get the card's mana cost
  const manaCost = card.mana_cost || "";
  if (!manaCost) {
    // Free spells don't benefit from convoke
    return false;
  }
  
  const parsedCost = parseManaCost(manaCost);
  const availableMana = getAvailableMana(state, playerId);
  
  // If the player can already pay the full cost without convoke, we still return true
  // because convoke is an option they CAN use (even if not required)
  // But we need to check if convoke would actually help them cast something they couldn't otherwise
  
  // Calculate how much mana the player needs after using available mana
  const totalCost = parsedCost.generic + 
    (parsedCost.colors.W || 0) +
    (parsedCost.colors.U || 0) +
    (parsedCost.colors.B || 0) +
    (parsedCost.colors.R || 0) +
    (parsedCost.colors.G || 0) +
    (parsedCost.colors.C || 0);
  
  const totalAvailable = (availableMana.white || 0) +
    (availableMana.blue || 0) +
    (availableMana.black || 0) +
    (availableMana.red || 0) +
    (availableMana.green || 0) +
    (availableMana.colorless || 0);
  
  // If player already has enough mana without convoke, they can cast it
  // so return true (convoke is available as an option)
  if (canPayManaCost(availableMana, parsedCost)) {
    return true;
  }
  
  // Calculate how much mana convoke can provide
  // Each creature can pay for {1} or one mana of its color
  // For simplicity, we'll assume each creature can contribute 1 generic mana
  // This is conservative but correct for canAct purposes
  const convokeContribution = untappedCreatures.length;
  
  // Check if available mana + convoke contribution is enough to cast the spell
  const totalAfterConvoke = totalAvailable + convokeContribution;
  
  return totalAfterConvoke >= totalCost;
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
 * Pattern matcher for Mutate
 * "Mutate [cost]" - Cast for mutate cost targeting non-Human creature you own
 */
export function hasMutateAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  if (!card) return false;
  
  const { state } = ctx;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for mutate keyword
  if (!/\bmutate\b/.test(oracleText)) {
    return false;
  }
  
  // Check if player has a non-Human creature they own on the battlefield
  const battlefield = state.battlefield || [];
  const hasValidTarget = battlefield.some((p: any) => {
    if (!p || p.owner !== playerId) return false;
    const typeLine = (p.card?.type_line || "").toLowerCase();
    return typeLine.includes("creature") && !typeLine.includes("human");
  });
  
  return hasValidTarget;
}

/**
 * Parse mutate cost from oracle text
 */
export function parseMutateCost(oracleText: string): string | undefined {
  if (!oracleText) return undefined;
  const match = oracleText.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Check for self-WUBRG alternate cost (Bringers)
 * "You may pay {W}{U}{B}{R}{G} rather than pay this spell's mana cost."
 */
export function hasSelfWUBRGAlternateCost(card: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  return oracleText.includes("{w}{u}{b}{r}{g}") && 
         oracleText.includes("rather than pay") &&
         oracleText.includes("this spell");
}

/**
 * Check for external WUBRG sources (Jodah, Fist of Suns)
 * Returns the source permanent if found
 */
export function getExternalWUBRGSource(
  ctx: GameContext,
  playerId: PlayerID
): { sourceId: string; sourceName: string } | null {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "").toLowerCase();
    
    // Jodah, Archmage Eternal or Fist of Suns
    // "You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast."
    if ((cardName.includes("jodah") || cardName.includes("fist of suns")) &&
        oracleText.includes("{w}{u}{b}{r}{g}") && 
        oracleText.includes("rather than pay") &&
        !oracleText.includes("this spell")) {
      return {
        sourceId: perm.id,
        sourceName: perm.card?.name || "Unknown",
      };
    }
  }
  
  return null;
}

/**
 * Check for Omniscience effect
 * "You may cast spells from your hand without paying their mana costs."
 */
export function getOmniscienceSource(
  ctx: GameContext,
  playerId: PlayerID
): { sourceId: string; sourceName: string } | null {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = (perm.card?.name || "").toLowerCase();
    const oracleText = (perm.card?.oracle_text || "").toLowerCase();
    
    // Omniscience: "You may cast spells from your hand without paying their mana costs."
    if (cardName.includes("omniscience") || 
        (oracleText.includes("cast spells from your hand") && 
         oracleText.includes("without paying"))) {
      return {
        sourceId: perm.id,
        sourceName: perm.card?.name || "Omniscience",
      };
    }
  }
  
  return null;
}

/**
 * Check for Devastating Mastery style alternate cost
 * "You may pay {2}{W}{W} rather than pay this spell's mana cost.
 * If the {2}{W}{W} cost was paid, [conditional effect]"
 */
export function hasConditionalAlternateCost(card: any): {
  hasCost: boolean;
  manaCost?: string;
  conditionalEffect?: string;
} {
  if (!card) return { hasCost: false };
  
  const oracleText = card.oracle_text || "";
  
  // Pattern: "You may pay X rather than pay this spell's mana cost. If the X cost was paid, [effect]"
  const match = oracleText.match(
    /you may pay (\{[^}]+\}(?:\s*\{[^}]+\})*) rather than pay this spell's mana cost\.?\s*if.*?was paid,\s*([^.]+)/i
  );
  
  if (match) {
    return {
      hasCost: true,
      manaCost: match[1],
      conditionalEffect: match[2].trim(),
    };
  }
  
  return { hasCost: false };
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
  if (hasMutateAlternateCost(ctx, playerId, card)) return true;
  if (hasSelfWUBRGAlternateCost(card)) return true;
  if (getExternalWUBRGSource(ctx, playerId)) return true;
  if (getOmniscienceSource(ctx, playerId)) return true;
  
  return false;
}

/**
 * Get all available alternate cost options for a card
 * Returns structured options for UI display
 */
export function getAllAlternateCostOptions(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  castFromZone: string = 'hand'
): AlternateCostOption[] {
  const options: AlternateCostOption[] = [];
  
  if (!card) return options;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Force of Will style
  if (hasForceOfWillAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'force_of_will',
      name: 'Pitch Cost',
      description: 'Exile a blue card from your hand and pay 1 life',
      additionalEffects: ['Pay 1 life', 'Exile a blue card from hand'],
    });
  }
  
  // Commander free cast
  if (hasCommanderFreeAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'commander_free',
      name: 'Commander Free Cast',
      description: 'Cast for free (you control your commander)',
      manaCost: undefined,
    });
  }
  
  // Pact
  if (hasPactAlternateCost(card)) {
    options.push({
      type: 'pact',
      name: 'Pact',
      description: 'Cast for free now, pay on your next upkeep',
      manaCost: undefined,
      additionalEffects: ['Must pay cost at next upkeep or lose the game'],
    });
  }
  
  // Mutate
  if (hasMutateAlternateCost(ctx, playerId, card)) {
    const mutateCost = parseMutateCost(card.oracle_text || "");
    options.push({
      type: 'mutate',
      name: 'Mutate',
      description: 'Merge with a non-Human creature you own',
      manaCost: mutateCost,
      requiresTarget: true,
      targetType: 'non_human_creature',
      additionalEffects: [
        'Choose to put on top or bottom of target creature',
        'Combined creature has all abilities',
        'Top card determines name, power/toughness',
      ],
    });
  }
  
  // Self WUBRG (Bringers)
  if (hasSelfWUBRGAlternateCost(card)) {
    options.push({
      type: 'wubrg_self',
      name: 'WUBRG Cost',
      description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
      manaCost: '{W}{U}{B}{R}{G}',
    });
  }
  
  // Conditional alternate cost (Devastating Mastery style)
  const conditionalAlt = hasConditionalAlternateCost(card);
  if (conditionalAlt.hasCost) {
    options.push({
      type: 'alternate',
      name: 'Conditional Alternate Cost',
      description: `Pay ${conditionalAlt.manaCost} for different effect`,
      manaCost: conditionalAlt.manaCost,
      additionalEffects: conditionalAlt.conditionalEffect ? [conditionalAlt.conditionalEffect] : undefined,
    });
  }
  
  // External WUBRG (Jodah, Fist of Suns)
  const wubrgSource = getExternalWUBRGSource(ctx, playerId);
  if (wubrgSource) {
    options.push({
      type: 'wubrg_external',
      name: 'WUBRG Alternative',
      description: `Pay {W}{U}{B}{R}{G} via ${wubrgSource.sourceName}`,
      manaCost: '{W}{U}{B}{R}{G}',
      sourceName: wubrgSource.sourceName,
      sourceId: wubrgSource.sourceId,
    });
  }
  
  // Omniscience (only from hand)
  if (castFromZone === 'hand') {
    const omniscienceSource = getOmniscienceSource(ctx, playerId);
    if (omniscienceSource) {
      options.push({
        type: 'omniscience',
        name: 'Free Cast',
        description: `Cast without paying mana cost via ${omniscienceSource.sourceName}`,
        manaCost: undefined,
        sourceName: omniscienceSource.sourceName,
        sourceId: omniscienceSource.sourceId,
      });
    }
  }
  
  // Convoke
  if (hasConvokeAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'convoke',
      name: 'Convoke',
      description: 'Tap creatures to help pay for this spell',
      additionalEffects: ['Each creature tapped pays {1} or one mana of its color'],
    });
  }
  
  // Delve
  if (hasDelveAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'delve',
      name: 'Delve',
      description: 'Exile cards from graveyard to reduce cost',
      additionalEffects: ['Each card exiled pays {1}'],
    });
  }
  
  // Improvise
  if (hasImproviseAlternateCost(ctx, playerId, card)) {
    options.push({
      type: 'improvise',
      name: 'Improvise',
      description: 'Tap artifacts to help pay for this spell',
      additionalEffects: ['Each artifact tapped pays {1}'],
    });
  }
  
  return options;
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
  
  if (hasMutateAlternateCost(ctx, playerId, card)) {
    const mutateCost = parseMutateCost(card.oracle_text || "");
    descriptions.push(`Mutate ${mutateCost || ''} (merge with a creature)`);
  }
  
  if (hasSelfWUBRGAlternateCost(card)) {
    descriptions.push("Pay {W}{U}{B}{R}{G} instead of mana cost");
  }
  
  const wubrgSource = getExternalWUBRGSource(ctx, playerId);
  if (wubrgSource) {
    descriptions.push(`Pay {W}{U}{B}{R}{G} via ${wubrgSource.sourceName}`);
  }
  
  const omniscienceSource = getOmniscienceSource(ctx, playerId);
  if (omniscienceSource) {
    descriptions.push(`Cast free via ${omniscienceSource.sourceName}`);
  }
  
  return descriptions;
}

/**
 * Get valid mutate targets for a player
 */
export function getValidMutateTargets(
  ctx: GameContext,
  playerId: PlayerID
): Array<{
  permanentId: string;
  cardName: string;
  controller: string;
  owner: string;
  typeLine: string;
  power?: string;
  toughness?: string;
  imageUrl?: string;
}> {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  const targets: Array<{
    permanentId: string;
    cardName: string;
    controller: string;
    owner: string;
    typeLine: string;
    power?: string;
    toughness?: string;
    imageUrl?: string;
  }> = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card) continue;
    if (perm.owner !== playerId) continue;
    
    const typeLine = (perm.card.type_line || "").toLowerCase();
    if (!typeLine.includes("creature")) continue;
    if (typeLine.includes("human")) continue;
    
    targets.push({
      permanentId: perm.id,
      cardName: perm.card.name || "Unknown",
      controller: perm.controller,
      owner: perm.owner,
      typeLine: perm.card.type_line || "",
      power: perm.card.power != null ? String(perm.card.power) : undefined,
      toughness: perm.card.toughness != null ? String(perm.card.toughness) : undefined,
      imageUrl: perm.card.image_uris?.small || perm.card.image_uris?.normal,
    });
  }
  
  return targets;
}
