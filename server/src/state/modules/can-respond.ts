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
import { parseManaCost, canPayManaCost, getManaPoolFromState, getAvailableMana } from "./mana-check";
import { hasPayableAlternateCost } from "./alternate-costs";
import { categorizeSpell, evaluateTargeting, parseTargetRequirements } from "../../rules-engine/targeting";
import { calculateMaxLandsPerTurn } from "./game-state-effects";
import { creatureHasHaste } from "../../socket/game-actions.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";

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
 * Check if a card has flashback ability
 * Flashback allows casting from graveyard for an alternate cost
 */
function hasFlashback(card: any): { hasIt: boolean; cost?: string } {
  if (!card) return { hasIt: false };
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for flashback keyword
  if (!oracleText.includes("flashback")) {
    return { hasIt: false };
  }
  
  // Try to extract the flashback cost
  // Pattern: "Flashback {cost}" or "Flashback—{cost}"
  const flashbackMatch = oracleText.match(/flashback[—\s]+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (flashbackMatch) {
    return { hasIt: true, cost: flashbackMatch[1] };
  }
  
  // If we find "flashback" but can't parse cost, log warning and assume it exists
  debugWarn(2, `[hasFlashback] Found flashback on ${card.name} but could not parse cost from: "${oracleText}"`);
  return { hasIt: true };
}

/**
 * Check if a card has foretell ability or can be cast from exile
 * Foretell allows casting from exile for an alternate cost after being foretold
 */
function hasForetellOrCanCastFromExile(card: any): { hasIt: boolean; cost?: string } {
  if (!card) return { hasIt: false };
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for foretell keyword
  if (oracleText.includes("foretell")) {
    // Try to extract foretell cost
    // Pattern: "Foretell {cost}"
    const foretellMatch = oracleText.match(/foretell\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (foretellMatch) {
      return { hasIt: true, cost: foretellMatch[1] };
    }
    debugWarn(2, `[hasForetellOrCanCastFromExile] Found foretell on ${card.name} but could not parse cost from: "${oracleText}"`);
    return { hasIt: true };
  }
  
  // Check for "you may cast this card from exile" or similar patterns
  if (oracleText.includes("you may cast") && oracleText.includes("from exile")) {
    return { hasIt: true };
  }
  
  // Check for "you may play" from exile
  if (oracleText.includes("you may play") && oracleText.includes("from exile")) {
    return { hasIt: true };
  }
  
  return { hasIt: false };
}

/**
 * Conservative check for unparseable alternative cost.
 * When we can't parse the cost, we assume the player might be able to pay it.
 * This prevents auto-passing when we're unsure, which is safer than auto-passing incorrectly.
 * 
 * @returns Always returns true (assumes player can pay)
 */
function assumeCanPayUnknownCost(cardName: string, mechanicName: string): boolean {
  debugWarn(2, `[assumeCanPayUnknownCost] Could not parse ${mechanicName} cost for ${cardName} - being conservative, assuming player can pay`);
  return true;
}

/**
 * Check if a card is marked as playable from exile
 * Handles both array and object formats for playableFromExile state
 */
function isCardPlayableFromExile(playableCards: any, cardId: string): boolean {
  if (!playableCards) return false;
  
  // Handle array format: ['card1', 'card2']
  if (Array.isArray(playableCards)) {
    return playableCards.includes(cardId);
  }
  
  // Handle object format: { 'card1': true, 'card2': true }
  return Boolean(playableCards[cardId]);
}

/**
 * Check if a spell has valid targets available on the battlefield.
 * This prevents spells requiring targets from being considered "playable" when no valid targets exist.
 * 
 * MTG Rule 601.2c: A spell or ability cannot be cast/activated unless valid targets are available
 * for all required targets.
 * 
 * @param state - Game state
 * @param playerId - The player casting the spell
 * @param card - The card being checked
 * @returns true if spell has valid targets (or doesn't require targets), false otherwise
 */
function hasValidTargetsForSpell(state: any, playerId: PlayerID, card: any): boolean {
  if (!card) return false;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  const cardName = card.name || "";
  
  // Check if this is an aura - auras ALWAYS require a target when cast
  // Pattern: Enchantment — Aura with "Enchant <target type>" in oracle text
  const isAura = typeLine.includes("aura") && /^enchant\s+/i.test(oracleText);
  
  if (isAura) {
    // Extract what the aura can enchant (creature, permanent, player, artifact, land, opponent)
    const auraMatch = oracleText.match(/^enchant\s+(creature|permanent|player|artifact|land|opponent)/i);
    const auraTargetType = auraMatch ? auraMatch[1].toLowerCase() : 'creature';
    
    // Check if valid targets exist
    if (auraTargetType === 'player' || auraTargetType === 'opponent') {
      // Check if there are valid player targets
      const players = state.players || [];
      const validPlayers = players.filter((p: any) => 
        auraTargetType !== 'opponent' || p.id !== playerId
      );
      return validPlayers.length > 0;
    } else {
      // Check battlefield for permanents of the required type
      const battlefield = state.battlefield || [];
      const validTargets = battlefield.filter((p: any) => {
        const tl = (p.card?.type_line || '').toLowerCase();
        if (auraTargetType === 'permanent') return true;
        return tl.includes(auraTargetType);
      });
      return validTargets.length > 0;
    }
  }
  
  // Check for instants/sorceries that require targets
  const isInstantOrSorcery = typeLine.includes("instant") || typeLine.includes("sorcery");
  if (isInstantOrSorcery) {
    // Check for counterspells - they need items on the stack to target
    // Pattern: "counter target spell" or similar
    const isCounterspell = /counter\s+target\s+(?:\w+\s+)?spell/i.test(oracleText) ||
                           /counter\s+target\s+(?:instant|sorcery)/i.test(oracleText) ||
                           /counter\s+target\s+(?:activated|triggered)\s+ability/i.test(oracleText);
    
    if (isCounterspell) {
      // Counterspells require items on the stack to target
      const stack = (state as any).stack || [];
      if (stack.length === 0) {
        // No spells/abilities on stack to counter
        return false;
      }
      // Continue to normal targeting check below to validate specific targets
    }
    
    // Try to categorize the spell to see if it needs targets
    const spellSpec = categorizeSpell(cardName, oracleText);
    if (spellSpec && spellSpec.minTargets > 0) {
      // This spell requires targets - check if valid targets exist
      const validTargets = evaluateTargeting(state, playerId, spellSpec);
      return validTargets.length >= spellSpec.minTargets;
    }
    
    // Also check via parseTargetRequirements as backup
    const targetReqs = parseTargetRequirements(oracleText);
    if (targetReqs.needsTargets && targetReqs.minTargets > 0) {
      // This spell requires targets but we couldn't categorize it precisely
      // Cannot determine if valid targets exist without proper categorization
      // To be safe for turn advancement: return false (spell not castable)
      // This prevents incorrect turn stoppage while being conservative about unknown spells
      debugWarn(2, `[hasValidTargetsForSpell] Could not categorize targeting spell ${cardName}, assuming no valid targets`);
      return false;
    }
  }
  
  // Spell doesn't require targets, or we couldn't determine targeting requirements
  return true;
}

/**
 * Determine total cost adjustment (reductions/taxes) that apply to a spell.
 * Currently handles common red cost reducers (Fire Crystal, Hazoret's Monument,
 * Ruby Medallion) and Aura of Silence style taxes.
 */
export function getCostAdjustmentForCard(state: any, playerId: PlayerID, card: any): number {
  if (!state?.battlefield || !card) return 0;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  const manaCostRaw = card.mana_cost || "";
  const colors = (card.colors || card.color_identity || []).map((c: string) => c.toUpperCase());
  const isWhiteSpell = /{W}/i.test(manaCostRaw) || colors.includes("W");
  const isBlueSpell = /{U}/i.test(manaCostRaw) || colors.includes("U");
  const isBlackSpell = /{B}/i.test(manaCostRaw) || colors.includes("B");
  const isRedSpell = /{R}/i.test(manaCostRaw) || colors.includes("R");
  const isGreenSpell = /{G}/i.test(manaCostRaw) || colors.includes("G");
  const isCreatureSpell = typeLine.includes("creature");
  const isArtifactOrEnchantment = typeLine.includes("artifact") || typeLine.includes("enchantment");
  
  const redCostReducers = [
    { nameMatch: "fire crystal", textMatch: "red spells you cast cost {1} less", applies: (creature: boolean) => true },
    { nameMatch: "ruby medallion", textMatch: "red spells you cast cost {1} less", applies: (creature: boolean) => true },
    { nameMatch: "hazoret's monument", textMatch: "red creature spells you cast cost {1} less", applies: (creature: boolean) => creature },
  ];
  
  const monumentCostReducers = [
    { nameMatch: "oketra's monument", textMatch: "white creature spells you cast cost {1} less", colorCheck: isWhiteSpell },
    { nameMatch: "bontu's monument", textMatch: "black creature spells you cast cost {1} less", colorCheck: isBlackSpell },
    { nameMatch: "hazoret's monument", textMatch: "red creature spells you cast cost {1} less", colorCheck: isRedSpell },
    { nameMatch: "kefnet's monument", textMatch: "blue creature spells you cast cost {1} less", colorCheck: isBlueSpell },
    { nameMatch: "rhonas's monument", textMatch: "green creature spells you cast cost {1} less", colorCheck: isGreenSpell },
  ];
  
  const taxEffects = [
    { nameMatch: "aura of silence", textMatch: "artifact and enchantment spells your opponents cast cost {2} more", applies: (isAE: boolean) => isAE, amount: 2 },
  ];
  
  let adjustment = 0; // negative = reduction, positive = increase
  
  for (const perm of state.battlefield) {
    if (!perm?.card) continue;
    const permName = (perm.card.name || "").toLowerCase();
    const permOracle = (perm.card.oracle_text || "").toLowerCase();
    const sameController = perm.controller === playerId;
    
    // DYNAMIC COST REDUCTION PARSING
    // Pattern: "[TYPE] spells you cast cost {N} less" or "spells you cast cost {N} less"
    if (sameController && permOracle.includes("spells you cast cost") && permOracle.includes("less")) {
      const costReductionMatch = permOracle.match(/(?:(white|blue|black|red|green|colorless|artifact|enchantment|noncreature|creature|instant|sorcery)\s+)?(?:(creature|artifact|enchantment)\s+)?spells you cast cost \{(\d+)\} less/i);
      
      if (costReductionMatch) {
        const colorOrType1 = costReductionMatch[1]?.toLowerCase();
        const type2 = costReductionMatch[2]?.toLowerCase();
        const reductionAmount = parseInt(costReductionMatch[3], 10) || 1;
        
        // Determine if this reduction applies to the current spell
        let applies = true;
        
        // Check color restrictions
        if (colorOrType1 === 'white' && !isWhiteSpell) applies = false;
        if (colorOrType1 === 'blue' && !isBlueSpell) applies = false;
        if (colorOrType1 === 'black' && !isBlackSpell) applies = false;
        if (colorOrType1 === 'red' && !isRedSpell) applies = false;
        if (colorOrType1 === 'green' && !isGreenSpell) applies = false;
        
        // Check type restrictions
        if (colorOrType1 === 'creature' || type2 === 'creature') {
          if (!isCreatureSpell) applies = false;
        }
        if (colorOrType1 === 'noncreature') {
          if (isCreatureSpell) applies = false;
        }
        if (colorOrType1 === 'artifact' || type2 === 'artifact') {
          if (!typeLine.includes('artifact')) applies = false;
        }
        if (colorOrType1 === 'enchantment' || type2 === 'enchantment') {
          if (!typeLine.includes('enchantment')) applies = false;
        }
        if (colorOrType1 === 'instant' || colorOrType1 === 'sorcery') {
          if (!typeLine.includes('instant') && !typeLine.includes('sorcery')) applies = false;
        }
        
        if (applies) {
          adjustment -= reductionAmount;
        }
      }
    }
    
    // LEGACY TABLE-BASED CHECKING (for backwards compatibility, will be removed in future refactor)
    // Cost reducers for red spells
    if (sameController && isRedSpell) {
      for (const reducer of redCostReducers) {
        if ((reducer.applies(isCreatureSpell)) &&
            permName.includes(reducer.nameMatch)) {
          // Skip if already handled by dynamic parsing
          if (!permOracle.includes("spells you cast cost") || !permOracle.includes("less")) {
            adjustment -= 1;
          }
        }
      }
    }
    
    // Monument cost reducers - DEPRECATED, now handled by dynamic parsing above
    // Kept for backwards compatibility
    if (sameController && isCreatureSpell) {
      for (const monument of monumentCostReducers) {
        if (monument.colorCheck && permName.includes(monument.nameMatch)) {
          // Skip if already handled by dynamic parsing
          if (!permOracle.includes("spells you cast cost") || !permOracle.includes("less")) {
            adjustment -= 1;
          }
        }
      }
    }
    
    // Taxes from opponents (Aura of Silence)
    if (!sameController && isArtifactOrEnchantment) {
      for (const tax of taxEffects) {
        if (tax.applies(isArtifactOrEnchantment) &&
            (permName.includes(tax.nameMatch) || permOracle.includes(tax.textMatch))) {
          adjustment += tax.amount;
        }
      }
    }
  }
  
  return adjustment;
}

/**
 * Apply a generic cost adjustment (positive = tax, negative = reduction) to a parsed cost.
 * Reductions lower generic first, then try to reduce red requirements to handle medallion-style effects.
 */
function applyCostAdjustment(
  parsedCost: { colors: Record<string, number>; generic: number; hasX: boolean },
  adjustment: number
): { colors: Record<string, number>; generic: number; hasX: boolean } {
  if (!adjustment) return parsedCost;
  
  const result = {
    colors: { ...parsedCost.colors },
    generic: parsedCost.generic,
    hasX: parsedCost.hasX,
  };
  
  if (adjustment > 0) {
    // Taxes add to generic
    result.generic += adjustment;
    return result;
  }
  
  // Reductions: consume generic first, then red pips if any
  let remainingReduction = Math.abs(adjustment);
  
  const genericReduction = Math.min(result.generic, remainingReduction);
  result.generic -= genericReduction;
  remainingReduction -= genericReduction;
  
  if (remainingReduction > 0) {
    const redAvailable = result.colors.R || 0;
    const redReduction = Math.min(redAvailable, remainingReduction);
    result.colors.R = redAvailable - redReduction;
  }
  
  return result;
}

/**
 * Detailed cost adjustment info for UI display
 */
export interface CostAdjustmentInfo {
  originalCost: string;
  adjustedCost: string;
  adjustment: number;       // positive = increase, negative = reduction
  genericAdjustment: number;
  sources: Array<{ name: string; amount: number }>;
}

/**
 * Get detailed cost adjustment info for a card including source names
 * This is used for UI display to show what's affecting the cost
 */
export function getCostAdjustmentInfo(state: any, playerId: string, card: any): CostAdjustmentInfo | null {
  if (!state?.battlefield || !card) return null;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const manaCostRaw = card.mana_cost || "";
  const colors = (card.colors || card.color_identity || []).map((c: string) => c.toUpperCase());
  const isWhiteSpell = /{W}/i.test(manaCostRaw) || colors.includes("W");
  const isBlueSpell = /{U}/i.test(manaCostRaw) || colors.includes("U");
  const isBlackSpell = /{B}/i.test(manaCostRaw) || colors.includes("B");
  const isRedSpell = /{R}/i.test(manaCostRaw) || colors.includes("R");
  const isGreenSpell = /{G}/i.test(manaCostRaw) || colors.includes("G");
  const isCreatureSpell = typeLine.includes("creature");
  const isArtifactOrEnchantment = typeLine.includes("artifact") || typeLine.includes("enchantment");
  
  // Skip lands - they don't have mana costs
  if (typeLine.includes("land")) return null;
  
  const sources: Array<{ name: string; amount: number }> = [];
  let totalAdjustment = 0;
  
  // Cost reducers table
  const redCostReducers = [
    { nameMatch: "fire crystal", displayName: "Fire Crystal", textMatch: "red spells you cast cost {1} less", applies: () => true, amount: -1 },
    { nameMatch: "ruby medallion", displayName: "Ruby Medallion", textMatch: "red spells you cast cost {1} less", applies: () => true, amount: -1 },
    { nameMatch: "hazoret's monument", displayName: "Hazoret's Monument", textMatch: "red creature spells you cast cost {1} less", applies: () => isCreatureSpell, amount: -1 },
  ];
  
  // Monument cost reducers (one for each color)
  const monumentCostReducers = [
    { nameMatch: "oketra's monument", displayName: "Oketra's Monument", textMatch: "white creature spells you cast cost {1} less", applies: () => isCreatureSpell && isWhiteSpell, amount: -1 },
    { nameMatch: "bontu's monument", displayName: "Bontu's Monument", textMatch: "black creature spells you cast cost {1} less", applies: () => isCreatureSpell && isBlackSpell, amount: -1 },
    { nameMatch: "hazoret's monument", displayName: "Hazoret's Monument", textMatch: "red creature spells you cast cost {1} less", applies: () => isCreatureSpell && isRedSpell, amount: -1 },
    { nameMatch: "kefnet's monument", displayName: "Kefnet's Monument", textMatch: "blue creature spells you cast cost {1} less", applies: () => isCreatureSpell && isBlueSpell, amount: -1 },
    { nameMatch: "rhonas's monument", displayName: "Rhonas's Monument", textMatch: "green creature spells you cast cost {1} less", applies: () => isCreatureSpell && isGreenSpell, amount: -1 },
  ];
  
  // Tax effects table - DEPRECATED, will be replaced by dynamic parsing
  const taxEffects = [
    { nameMatch: "aura of silence", displayName: "Aura of Silence", textMatch: "artifact and enchantment spells your opponents cast cost {2} more", applies: () => isArtifactOrEnchantment, amount: 2 },
    { nameMatch: "sphere of resistance", displayName: "Sphere of Resistance", textMatch: "spells cost {1} more to cast", applies: () => true, amount: 1 },
    { nameMatch: "thorn of amethyst", displayName: "Thorn of Amethyst", textMatch: "noncreature spells cost {1} more to cast", applies: () => !isCreatureSpell, amount: 1 },
    { nameMatch: "thalia, guardian of thraben", displayName: "Thalia, Guardian of Thraben", textMatch: "noncreature spells cost {1} more to cast", applies: () => !isCreatureSpell, amount: 1 },
    { nameMatch: "vryn wingmare", displayName: "Vryn Wingmare", textMatch: "noncreature spells cost {1} more to cast", applies: () => !isCreatureSpell, amount: 1 },
    { nameMatch: "lodestone golem", displayName: "Lodestone Golem", textMatch: "nonartifact spells cost {1} more to cast", applies: () => !typeLine.includes("artifact"), amount: 1 },
  ];
  
  for (const perm of state.battlefield) {
    if (!perm?.card) continue;
    const permName = (perm.card.name || "").toLowerCase();
    const permOracle = (perm.card.oracle_text || "").toLowerCase();
    const sameController = perm.controller === playerId;
    
    // DYNAMIC COST REDUCTION PARSING (for your permanents)
    if (sameController && permOracle.includes("spells you cast cost") && permOracle.includes("less")) {
      const costReductionMatch = permOracle.match(/(?:(white|blue|black|red|green|colorless|artifact|enchantment|noncreature|creature|instant|sorcery)\s+)?(?:(creature|artifact|enchantment)\s+)?spells you cast cost \{(\d+)\} less/i);
      
      if (costReductionMatch) {
        const colorOrType1 = costReductionMatch[1]?.toLowerCase();
        const type2 = costReductionMatch[2]?.toLowerCase();
        const reductionAmount = parseInt(costReductionMatch[3], 10) || 1;
        
        // Determine if this reduction applies
        let applies = true;
        
        if (colorOrType1 === 'white' && !isWhiteSpell) applies = false;
        if (colorOrType1 === 'blue' && !isBlueSpell) applies = false;
        if (colorOrType1 === 'black' && !isBlackSpell) applies = false;
        if (colorOrType1 === 'red' && !isRedSpell) applies = false;
        if (colorOrType1 === 'green' && !isGreenSpell) applies = false;
        if (colorOrType1 === 'creature' || type2 === 'creature') {
          if (!isCreatureSpell) applies = false;
        }
        if (colorOrType1 === 'noncreature') {
          if (isCreatureSpell) applies = false;
        }
        if (colorOrType1 === 'artifact' || type2 === 'artifact') {
          if (!typeLine.includes('artifact')) applies = false;
        }
        if (colorOrType1 === 'enchantment' || type2 === 'enchantment') {
          if (!typeLine.includes('enchantment')) applies = false;
        }
        
        if (applies) {
          const cardDisplayName = perm.card.name || 'Unknown';
          sources.push({ name: cardDisplayName, amount: -reductionAmount });
          totalAdjustment -= reductionAmount;
        }
      }
    }
    
    // DYNAMIC TAX PARSING (for opponent permanents)
    if (!sameController && permOracle.includes("spells") && permOracle.includes("cost") && permOracle.includes("more")) {
      // Pattern: "spells cost {N} more" or "[TYPE] spells...cost {N} more"
      const taxMatch = permOracle.match(/(?:(artifact|enchantment|noncreature|nonartifact)\s+(?:and\s+\w+\s+)?)?spells(?: your opponents cast| opponents cast)? cost \{(\d+)\} more/i);
      
      if (taxMatch) {
        const typeRestriction = taxMatch[1]?.toLowerCase();
        const taxAmount = parseInt(taxMatch[2], 10) || 1;
        
        let applies = true;
        
        if (typeRestriction === 'artifact' && !typeLine.includes('artifact')) applies = false;
        if (typeRestriction === 'enchantment' && !typeLine.includes('enchantment')) applies = false;
        if (typeRestriction === 'noncreature' && isCreatureSpell) applies = false;
        if (typeRestriction === 'nonartifact' && typeLine.includes('artifact')) applies = false;
        // "artifact and enchantment" case
        if (permOracle.includes('artifact and enchantment') && !isArtifactOrEnchantment) applies = false;
        
        if (applies) {
          const cardDisplayName = perm.card.name || 'Unknown';
          sources.push({ name: cardDisplayName, amount: taxAmount });
          totalAdjustment += taxAmount;
        }
      }
    }
  }
  
  // Only return info if there's an adjustment
  if (sources.length === 0) return null;
  
  // Calculate adjusted mana cost string
  const parsed = parseManaCost(manaCostRaw);
  const adjustedGeneric = Math.max(0, parsed.generic + totalAdjustment);
  
  // Reconstruct adjusted cost string
  let adjustedCostParts: string[] = [];
  // Only add generic mana component if:
  // 1. The original cost had generic mana (parsed.generic > 0), OR
  // 2. There's an adjustment that would add generic mana (adjusted > 0)
  if (adjustedGeneric > 0 || parsed.generic > 0) {
    adjustedCostParts.push(`{${adjustedGeneric}}`);
  }
  // Add color requirements
  for (const [color, count] of Object.entries(parsed.colors)) {
    for (let i = 0; i < (count as number); i++) {
      adjustedCostParts.push(`{${color}}`);
    }
  }
  if (parsed.hasX) {
    adjustedCostParts.unshift('{X}');
  }
  const adjustedCost = adjustedCostParts.join('');
  
  return {
    originalCost: manaCostRaw,
    adjustedCost: adjustedCost || manaCostRaw,
    adjustment: totalAdjustment,
    genericAdjustment: totalAdjustment,
    sources,
  };
}

/**
 * Check if player can cast any instant or flash spell from hand, graveyard (flashback), 
 * or exile (foretell/impulse draw)
 */
export function canCastAnySpell(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const zones = state.zones?.[playerId];
    if (!zones) return false;
    
    // Get mana pool (floating + potential from untapped sources)
    const pool = getAvailableMana(state, playerId);
    
    // Get ignored cards for this player (for auto-pass)
    const ignoredCards = (state as any).ignoredCardsForAutoPass?.[playerId] || {};
    
    // Check each card in hand
    if (Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        if (!card || typeof card === "string") continue;
        
        // Skip ignored cards - they shouldn't trigger auto-pass prompts
        if (ignoredCards[card.id]) {
          debug(2, `[canCastAnySpell] Skipping ignored card in hand: ${card.name || card.id}`);
          continue;
        }
        
        // Skip transform back faces - they can't be cast from hand
        if (isTransformBackFace(card)) {
          debug(2, `[canCastAnySpell] Skipping transform back face: ${card.name || 'unknown'}`);
          continue;
        }
        
        // Skip non-instant/flash cards
        if (!hasFlashOrInstant(card)) continue;
        
        // Check if player can pay the cost (either normal or alternate)
        const manaCost = card.mana_cost || "";
        const parsedCost = parseManaCost(manaCost);
        const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
        const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
        
        // Check normal mana cost
        if (canPayManaCost(pool, adjustedCost)) {
          // Also check if the spell has valid targets (if it requires targets)
          if (hasValidTargetsForSpell(state, playerId, card)) {
            return true;
          }
        }
        
        // Check alternate costs
        if (hasPayableAlternateCost(ctx, playerId, card)) {
          // Also check if the spell has valid targets (if it requires targets)
          if (hasValidTargetsForSpell(state, playerId, card)) {
            return true;
          }
        }
      }
    }
    
    // Check graveyard for flashback instants
    if (Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        if (!card || typeof card === "string") continue;
        
        // Skip ignored cards in graveyard
        if (ignoredCards[card.id]) {
          debug(2, `[canCastAnySpell] Skipping ignored card in graveyard: ${card.name || card.id}`);
          continue;
        }
        
        // Check if it's an instant with flashback
        const typeLine = (card.type_line || "").toLowerCase();
        if (!typeLine.includes("instant")) continue;
        
        const flashbackInfo = hasFlashback(card);
        if (!flashbackInfo.hasIt) continue;
        
        // Check if player can pay the flashback cost
        if (flashbackInfo.cost) {
          const parsedCost = parseManaCost(flashbackInfo.cost);
          const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
          const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
          if (canPayManaCost(pool, adjustedCost)) {
            // Also check if the spell has valid targets (if it requires targets)
            if (hasValidTargetsForSpell(state, playerId, card)) {
              return true;
            }
          }
        } else {
          // If we can't parse the cost, be conservative and assume they can pay it
          if (assumeCanPayUnknownCost(card.name, 'flashback')) {
            // Also check if the spell has valid targets (if it requires targets)
            if (hasValidTargetsForSpell(state, playerId, card)) {
              return true;
            }
          }
        }
      }
    }
    
    // Check exile for foretell instants or impulse draw effects
    const stateAny = state as any;
    const exileZone = stateAny.exile?.[playerId];
    
    if (Array.isArray(exileZone)) {
      for (const card of exileZone as any[]) {
        if (!card || typeof card === "string") continue;
        
        // Skip ignored cards in exile
        if (ignoredCards[card.id]) {
          debug(2, `[canCastAnySpell] Skipping ignored card in exile: ${card.name || card.id}`);
          continue;
        }
        
        // Check if it's an instant that can be cast from exile
        const typeLine = (card.type_line || "").toLowerCase();
        if (!typeLine.includes("instant")) continue;
        
        // Check for foretell
        const foretellInfo = hasForetellOrCanCastFromExile(card);
        if (foretellInfo.hasIt) {
          // Check if player can pay the foretell cost
          if (foretellInfo.cost) {
            const parsedCost = parseManaCost(foretellInfo.cost);
            const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
            const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
            if (canPayManaCost(pool, adjustedCost)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          } else {
            // If we can't parse cost or card has "you may cast from exile", be conservative
            if (assumeCanPayUnknownCost(card.name, 'foretell/exile')) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          }
        }
        
        // Check for impulse draw effects (playableFromExile state marker)
        if (stateAny.playableFromExile?.[playerId]) {
          const playableCards = stateAny.playableFromExile[playerId];
          const cardId = card.id || card.name;
          
          // Check if this card is marked as playable from exile
          if (isCardPlayableFromExile(playableCards, cardId)) {
            // Check if player can pay the normal mana cost
            const manaCost = card.mana_cost || "";
            const parsedCost = parseManaCost(manaCost);
            const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
            const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
            
            if (canPayManaCost(pool, adjustedCost)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
            
            // Check alternate costs
            if (hasPayableAlternateCost(ctx, playerId, card)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          }
        }
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canCastAnySpell] Error:", err);
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
  
  // Check for tap abilities: "{T}: Effect" or "{Cost}, {T}: Effect" or "{T}, Cost: Effect"
  // Common patterns: 
  // - "{T}: Add {G}" (simple tap)
  // - "{T}, Sacrifice ~: Effect" (tap + additional cost after, like fetchlands)
  // - "{2}{R}, {T}: This creature fights..." (mana + tap, like Brash Taunter)
  // Pattern allows for optional comma and text between {T} and colon
  // Using [^:]* to match any costs between {T} and : (e.g., ", Pay 1 life, Sacrifice ~")
  // This is safe because ability patterns always end with a colon before the effect
  const hasTapAbility = /\{T\}(?:\s*,?\s*[^:]*)?:/i.test(oracleText);
  
  if (hasTapAbility) {
    // Can only activate if not tapped
    if (permanent.tapped) return false;
    
    // Rule 302.6 / 702.10: Check summoning sickness for creatures with tap abilities
    // A creature can't use tap/untap abilities unless it has been continuously controlled
    // since the turn began OR it has haste (from any source).
    // Lands and non-creature permanents are NOT affected by summoning sickness.
    const isCreature = /\bcreature\b/.test(typeLine);
    const isLand = typeLine.includes("land");
    
    if (isCreature && !isLand) {
      // Check if creature has summoning sickness
      if ((permanent as any).summoningSickness) {
        // Check if creature has haste from any source
        const battlefield = state.battlefield || [];
        const hasHaste = creatureHasHaste(permanent, battlefield, playerId);
        
        if (!hasHaste) {
          return false; // Has summoning sickness and no haste - can't activate
        }
      }
    }
    
    // Match tap abilities with various cost patterns:
    // Pattern 1: "{T}, <additional>: <effect>" - tap first, then additional costs
    // Pattern 2: "<costs>, {T}: <effect>" - costs before tap (e.g., {2}{R}, {T})
    // Pattern 3: "{T}: <effect>" - simple tap only
    const abilityMatch = oracleText.match(/(?:(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*,\s*)?\{T\}(?:\s*,\s*([^:]+))?:\s*(.+)/i);
    if (!abilityMatch) {
      // Couldn't parse the tap ability pattern - be conservative and return false
      // This prevents false positives in auto-pass system
      return false;
    }
    
    const costsBeforeTap = abilityMatch[1] || ""; // Mana costs before {T}
    const additionalCostAfterTap = abilityMatch[2] || ""; // Other costs after {T}
    const effect = abilityMatch[3] || "";
    
    // CRITICAL: Skip mana abilities - they don't use the stack and don't require priority
    // Per MTG Rule 605.3a, mana abilities can be activated whenever needed for payment
    if (isManaAbility(oracleText, effect)) {
      return false; // Mana abilities don't prevent auto-pass
    }
    
    // Check for "Activate only during your turn" restriction (e.g., Humble Defector)
    const isTurnPlayer = (state as any).turnPlayer === playerId;
    if (/activate (?:this ability )?only during your turn/i.test(oracleText) && !isTurnPlayer) {
      return false; // Can only be activated during player's turn
    }
    
    // Check for mana costs BEFORE tap symbol (e.g., "{2}{R}, {T}:")
    if (costsBeforeTap) {
      const manaCostMatch = costsBeforeTap.match(/\{[^}]+\}/g);
      if (manaCostMatch) {
        const costString = manaCostMatch.join("");
        const parsedCost = parseManaCost(costString);
        if (!canPayManaCost(pool, parsedCost)) {
          return false; // Can't pay mana cost
        }
      }
    }
    
    // Check for mana costs AFTER tap symbol (e.g., "{T}, {2}:")
    if (additionalCostAfterTap) {
      const manaCostMatch = additionalCostAfterTap.match(/\{[^}]+\}/g);
      if (manaCostMatch) {
        const costString = manaCostMatch.join("");
        const parsedCost = parseManaCost(costString);
        if (!canPayManaCost(pool, parsedCost)) {
          return false; // Can't pay mana cost
        }
      }
      
      // Check for sacrifice costs - only return true if we can verify player has something to sacrifice
      if (additionalCostAfterTap.toLowerCase().includes("sacrifice")) {
        // Parse what needs to be sacrificed
        const sacrificeMatch = additionalCostAfterTap.match(/sacrifice\s+(?:a|an|this)\s*(\w+)?/i);
        if (sacrificeMatch) {
          const sacrificeType = sacrificeMatch[1] ? sacrificeMatch[1].toLowerCase() : "";
          // Check if player has appropriate permanents to sacrifice
          const battlefield = state.battlefield || [];
          const hasSacrificeable = battlefield.some((perm: any) => {
            if (perm.controller !== playerId) return false;
            if (perm.id === permanent.id && additionalCostAfterTap.toLowerCase().includes("sacrifice this")) {
              return true; // Can sacrifice itself
            }
            if (!sacrificeType) return true; // Generic sacrifice
            const permTypeLine = (perm.card?.type_line || '').toLowerCase();
            return permTypeLine.includes(sacrificeType);
          });
          if (!hasSacrificeable) {
            return false; // Can't pay sacrifice cost
          }
        }
      }
      
      // Check for life payment costs
      if (additionalCostAfterTap.toLowerCase().includes("pay") && additionalCostAfterTap.toLowerCase().includes("life")) {
        const lifeMatch = additionalCostAfterTap.match(/pay (\d+) life/i);
        if (lifeMatch) {
          const lifeCost = parseInt(lifeMatch[1], 10);
          const currentLife = state.life?.[playerId] ?? 40;
          if (currentLife < lifeCost) {
            return false; // Can't pay life cost
          }
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
    
    // Skip "Activate only during your turn" abilities if it's not our turn
    // Pattern: "Activate only during your turn" (e.g., Humble Defector)
    const isTurnPlayer = (state as any).turnPlayer === playerId;
    if (/activate (?:this ability )?only during your turn/i.test(oracleText) && !isTurnPlayer) {
      continue; // Skip - can only be activated during player's turn
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
 * Check if a card in graveyard has an activated ability that can be activated
 * Examples: Magma Phoenix, Squee, Goblin Nabob, etc.
 * 
 * IMPORTANT: This should ONLY be called for cards actually in the graveyard.
 * When a card is on the battlefield, its graveyard-only abilities should not be activatable.
 */
function hasGraveyardActivatedAbility(
  ctx: GameContext,
  playerId: PlayerID,
  card: any,
  pool: Record<string, number>
): boolean {
  if (!card || typeof card === "string") return false;
  
  const oracleText = card.oracle_text || "";
  const cardName = card.name || "this card";
  
  // Check for activated abilities that can be used from graveyard
  // Pattern: "{Cost}: [Effect]. Activate only from your graveyard"
  // OR: "{Cost}: [Effect] from your graveyard"
  // Examples:
  // - "{3}{R}{R}: Return Magma Phoenix from your graveyard to your hand."
  // - "{1}{R}: Return Squee, Goblin Nabob from your graveyard to your hand."
  
  // Look for cost patterns followed by effects that mention graveyard
  const activatedAbilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:\s*(.+?)(?:\.|$)/gi;
  const matches = [...oracleText.matchAll(activatedAbilityPattern)];
  
  for (const match of matches) {
    const costPart = match[1];
    const effectPart = match[2];
    
    // Check if the effect mentions "from your graveyard" or "from a graveyard"
    if (!effectPart.toLowerCase().includes("graveyard")) {
      continue;
    }
    
    // Check if it's explicitly restricted to "only from your graveyard" or similar
    // or if the effect naturally works from graveyard (returns card from graveyard, etc.)
    const isGraveyardAbility = 
      /from (?:your |a )?graveyard/i.test(effectPart) ||
      /activate (?:this ability |only )?(?:only )?from (?:your |a )?graveyard/i.test(oracleText);
    
    if (!isGraveyardAbility) {
      continue;
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
    
    // Get mana pool (floating + potential from untapped sources)
    const pool = getAvailableMana(state, playerId);
    
    // Get ignored cards for this player (for auto-pass)
    const ignoredCards = (state as any).ignoredCardsForAutoPass?.[playerId] || {};
    
    // Check each permanent on battlefield
    for (const permanent of battlefield) {
      // Skip ignored permanents - they shouldn't trigger auto-pass prompts
      if (ignoredCards[permanent.id]) {
        debug(2, `[canActivateAnyAbility] Skipping ignored card: ${permanent.card?.name || permanent.id}`);
        continue;
      }
      
      if (hasActivatableAbility(ctx, playerId, permanent, pool)) {
        return true;
      }
    }
    
    // Check graveyard for cards with activated abilities that can be used from there
    // IMPORTANT: Only check cards that are ACTUALLY in the graveyard, not on battlefield
    const zones = state.zones?.[playerId];
    if (zones && Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        // Skip ignored cards in graveyard
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored graveyard card: ${card.name || card.id}`);
          continue;
        }
        
        // Skip this card if it's also on the battlefield (shouldn't happen, but defensive check)
        // This ensures abilities like Magma Phoenix's graveyard ability are ONLY activatable from graveyard
        const isOnBattlefield = battlefield.some((perm: any) => 
          perm.card?.id === card.id || perm.card?.name === card.name
        );
        
        if (isOnBattlefield) {
          continue; // Card is on battlefield, don't allow graveyard abilities
        }
        
        if (hasGraveyardActivatedAbility(ctx, playerId, card, pool)) {
          return true;
        }
      }
    }
    
    // Check exile zone for playable cards (foretold, suspended, plotted, etc.)
    if (zones && Array.isArray(zones.exile)) {
      for (const card of zones.exile as any[]) {
        // Skip ignored cards in exile
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored exile card: ${card.name || card.id}`);
          continue;
        }
        
        if (hasExileActivatedAbility(ctx, playerId, card, pool)) {
          return true;
        }
      }
    }
    
    // Check hand for special abilities (foretell cost from hand, etc.)
    if (zones && Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        // Skip ignored cards in hand
        if (ignoredCards[card.id]) {
          debug(2, `[canActivateAnyAbility] Skipping ignored hand card: ${card.name || card.id}`);
          continue;
        }
        
        // Note: Regular casting from hand is handled in canCastAnySpell
        // This is for special hand abilities like foretelling
        if (hasHandActivatedAbility(ctx, playerId, card, pool)) {
          return true;
        }
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canActivateAnyAbility] Error:", err);
    return false;
  }
}

/**
 * Check if a card in exile has an activated ability that can be used
 */
function hasExileActivatedAbility(ctx: GameContext, playerId: PlayerID, card: any, pool: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Foretell - can be cast from exile for the foretell cost
  if (oracleText.includes('foretell') && card.isForetold) {
    return true;
  }
  
  // Plot - can be cast from exile without paying mana cost
  if (oracleText.includes('plot') && card.isPlotted) {
    return true;
  }
  
  // Suspend - will cast when last time counter is removed
  if (oracleText.includes('suspend') && card.isSuspended) {
    // Check if it's ready to cast (no time counters)
    if (card.timeCounters === 0) {
      return true;
    }
  }
  
  // Adventure - can cast creature from exile after adventure
  if ((card.layout === 'adventure' || oracleText.includes('adventure')) && card.adventureUsed) {
    return true;
  }
  
  // Generic "play from exile" effects
  if (card.canPlayFromExile) {
    return true;
  }
  
  return false;
}

/**
 * Check if a card in hand has a special activated ability (not regular casting)
 */
function hasHandActivatedAbility(ctx: GameContext, playerId: PlayerID, card: any, pool: any): boolean {
  if (!card) return false;
  
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Foretell - pay {2} to exile face-down
  if (oracleText.includes('foretell')) {
    // Check if player can pay {2}
    const hasTwoMana = (pool.colorless || 0) + (pool.white || 0) + (pool.blue || 0) + 
                       (pool.black || 0) + (pool.red || 0) + (pool.green || 0) >= 2;
    if (hasTwoMana) {
      return true;
    }
  }
  
  return false;
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
    debugWarn(1, "[isInMainPhase] Error:", err);
    // Default to true to be conservative (don't auto-pass if uncertain)
    return true;
  }
}

/**
 * Check if a card is a transform back face (not playable from hand)
 * 
 * Transform back faces have "(Transforms from [Name])" in their oracle text
 * and should only be accessible after the front face transforms.
 * 
 * Examples:
 * - "Barracks of the Thousand" has "(Transforms from Thousand Moons Smithy.)" 
 * - Back faces of werewolves, etc.
 */
export function isTransformBackFace(card: any): boolean {
  if (!card) return false;
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Check for the standard transform pattern: "(Transforms from [Name])"
  // This is the indicator that this is a back face that cannot be played from hand
  return /\(transforms from [^)]+\)/i.test(oracleText);
}

/**
 * Check if player can play a land
 * This includes:
 * - Having a land in hand (excluding transform back faces)
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
      debug(2, `[canPlayLand] ${playerId}: No state`);
      return false;
    }
    
    const zones = state.zones?.[playerId];
    if (!zones) {
      debug(2, `[canPlayLand] ${playerId}: No zones found`);
      return false;
    }
    
    // Check if player has already played maximum lands this turn
    const landsPlayedThisTurn = (state.landsPlayedThisTurn as any)?.[playerId] ?? 0;
    
    // Calculate max lands dynamically based on game state (Exploration, Azusa, etc.)
    const maxLandsPerTurn = calculateMaxLandsPerTurn(ctx, playerId);
    
    if (landsPlayedThisTurn >= maxLandsPerTurn) {
      debug(2, `[canPlayLand] ${playerId}: Already played max lands this turn (${landsPlayedThisTurn}/${maxLandsPerTurn})`);
      return false; // Already played max lands
    }
    
    // Check if player has a land card in hand
    if (Array.isArray(zones.hand)) {
      debug(2, `[canPlayLand] ${playerId}: Checking hand with ${zones.hand.length} cards`);
      
      // Log first few cards in hand for debugging
      const sampleCards = zones.hand.slice(0, 3).map((c: any) => {
        if (!c || typeof c === "string") return `string:${c}`;
        return `${c.name || 'unknown'}(${(c.type_line || '').substring(0, 20)})`;
      });
      debug(1, `[canPlayLand] ${playerId}: Sample cards in hand: [${sampleCards.join(', ')}]`);
      
      for (const card of zones.hand as any[]) {
        if (!card || typeof card === "string") continue;
        
        const typeLine = (card.type_line || "").toLowerCase();
        if (typeLine.includes("land")) {
          // Skip transform back faces - they can't be played from hand
          if (isTransformBackFace(card)) {
            debug(2, `[canPlayLand] ${playerId}: Skipping transform back face: ${card.name || 'unknown'}`);
            continue;
          }
          
          debug(2, `[canPlayLand] ${playerId}: Found land in hand: ${card.name || 'unknown'} (${card.type_line || 'unknown type'}) - returning TRUE`);
          return true; // Found a land in hand that can be played
        }
      }
      debug(2, `[canPlayLand] ${playerId}: No lands found in hand of ${zones.hand.length} cards - returning FALSE`);
    } else {
      debug(2, `[canPlayLand] ${playerId}: zones.hand is not an array:`, typeof zones.hand, zones.hand);
      // FALLBACK: Check handCount to see if there might be cards
      if (zones.handCount && zones.handCount > 0) {
        debugWarn(1, `[canPlayLand] ${playerId}: WARNING - handCount=${zones.handCount} but zones.hand is not an array! This is a data consistency issue.`);
        // Return true conservatively - don't auto-pass if we're not sure
        return true;
      }
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
    debugWarn(1, "[canPlayLand] Error:", err);
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
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      
      // Check for "you may play" or "you may cast" from the specified zone
      const hasPlayText = oracleText.includes("you may play") || oracleText.includes("you may cast");
      const hasZone = oracleText.includes(zone);
      
      if (hasPlayText && hasZone) {
        // For graveyard casting from Station cards, check charge counter threshold
        if (zone === "graveyard" && typeLine.includes("spacecraft")) {
          // Station cards: graveyard casting is threshold-gated
          // Check if the ability mentions "permanent spell" (Station restriction)
          if (oracleText.includes("permanent spell") && oracleText.includes("from your graveyard")) {
            // Parse required threshold - graveyard casting is typically at highest threshold
            // Pattern: "It's an artifact creature at N+." indicates when it becomes a creature
            const creatureMatch = oracleText.match(/it's an? (?:artifact )?creature at (\d+)\+/i);
            if (creatureMatch) {
              const threshold = parseInt(creatureMatch[1], 10);
              const chargeCounters = (permanent as any).counters?.charge || 0;
              
              // Only allow graveyard casting if threshold is met
              if (chargeCounters >= threshold) {
                return true;
              }
              // Threshold not met - continue checking other permanents
              continue;
            }
          }
        }
        
        // Additional check for lands specifically (Crucible of Worlds, etc.)
        if (zone === "graveyard" && oracleText.includes("land")) {
          return true;
        }
        
        // For exile, be more generous as it often comes from impulse draw effects
        if (zone === "exile") {
          return true;
        }
        
        // Generic graveyard casting (not Station-specific)
        if (zone === "graveyard" && !typeLine.includes("spacecraft")) {
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
    debugWarn(1, "[hasPlayFromZoneEffect] Error:", err);
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
    debugWarn(1, "[hasPlayFromTopOfLibraryEffect] Error:", err);
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
    debug(2, `[canRespond] ${playerId}: checking instant-speed responses only`);
    
    // Check if player can cast any instant/flash spells
    if (canCastAnySpell(ctx, playerId)) {
      debug(2, `[canRespond] ${playerId}: Can cast instant/flash spell`);
      return true;
    }
    
    // Check if player can activate any abilities
    if (canActivateAnyAbility(ctx, playerId)) {
      debug(2, `[canRespond] ${playerId}: Can activate ability`);
      return true;
    }
    
    // No instant-speed responses available
    debug(2, `[canRespond] ${playerId}: No instant-speed responses available (returning false)`);
    return false;
  } catch (err) {
    debugWarn(1, "[canRespond] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Check if player can cast their commander(s) from the command zone
 * Commanders can be cast at any time they could normally cast that type of spell
 * (e.g., instant if it has flash, sorcery-speed otherwise)
 * 
 * @param ctx Game context
 * @param playerId Player to check
 * @returns true if player can afford to cast at least one commander
 */
function canCastCommanderFromCommandZone(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    // Get commander zone info for this player
    const commandZone = (state as any).commandZone?.[playerId];
    if (!commandZone) return false;
    
    // Get commanders that are currently in the command zone
    const inCommandZone = (commandZone as any).inCommandZone as string[] || [];
    const commanderCards = (commandZone as any).commanderCards as any[] || [];
    
    if (inCommandZone.length === 0 || commanderCards.length === 0) {
      return false;
    }
    
    // Get available mana
    const pool = getAvailableMana(state, playerId);
    
    // Check each commander in the command zone
    for (const commanderId of inCommandZone) {
      const commander = commanderCards.find((c: any) => c.id === commanderId);
      if (!commander) continue;
      
      // Parse mana cost
      const manaCost = commander.mana_cost || "";
      if (!manaCost) continue; // Can't cast without a mana cost
      
      const parsedCost = parseManaCost(manaCost);
      
      // Add commander tax to generic cost
      const tax = (commandZone as any).taxById?.[commanderId] || 0;
      
      // Apply cost adjustments (monuments, cost reducers, taxes from opponents)
      const costAdjustment = getCostAdjustmentForCard(state, playerId, commander);
      
      const totalCost = {
        ...parsedCost,
        generic: parsedCost.generic + tax + costAdjustment, // Tax increases cost, adjustment can reduce or increase
      };
      
      // Check if player can pay the cost
      if (canPayManaCost(pool, totalCost)) {
        // Also check if this commander has flash (can be cast at instant speed)
        const typeLine = (commander.type_line || "").toLowerCase();
        const oracleText = (commander.oracle_text || "").toLowerCase();
        
        // Creatures, artifacts, enchantments, planeswalkers are sorcery-speed by default
        // But if they have flash, they can be cast any time
        const hasFlash = oracleText.includes("flash");
        const isInstant = typeLine.includes("instant");
        
        if (hasFlash || isInstant) {
          // Can cast at instant speed - always valid
          debug(2, `[canCastCommanderFromCommandZone] ${playerId}: Commander ${commander.name} has flash/instant - can cast`);
          return true;
        }
        
        // For sorcery-speed commanders, check if we're in main phase with empty stack
        const currentStep = String((state as any).step || '').toUpperCase();
        const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
        const stackIsEmpty = !state.stack || state.stack.length === 0;
        
        if (isMainPhase && stackIsEmpty) {
          debug(2, `[canCastCommanderFromCommandZone] ${playerId}: Commander ${commander.name} can be cast (main phase, empty stack)`);
          return true;
        }
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canCastCommanderFromCommandZone] Error:", err);
    return false;
  }
}

/**
 * Determine if the active player can take any action during their turn.
 * 
 * This is a MORE CONSERVATIVE check than canRespond - it returns true if the player
 * can take ANY action, including:
 * - Instant/flash spells (checked by canRespond)
 * - Activated abilities (checked by canRespond)
 * - Casting commanders from command zone
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

/**
 * Check if a creature is goaded (Rule 701.15)
 * Goaded creatures must attack each combat if able.
 */
function isCreatureGoaded(permanent: any, currentTurn?: number): boolean {
  if (!permanent) return false;
  
  const goadedBy = permanent.goadedBy;
  if (!goadedBy || !Array.isArray(goadedBy) || goadedBy.length === 0) {
    return false;
  }
  
  // If no turn tracking, just check if goaded by anyone
  if (currentTurn === undefined) {
    return true;
  }
  
  // Check if any goad effects are still active
  const goadedUntil = permanent.goadedUntil;
  if (!goadedUntil) {
    return true; // Has goad but no expiration tracking, assume active
  }
  
  // Check if any goad is still active
  return goadedBy.some((playerId: string) => {
    const expiryTurn = goadedUntil[playerId];
    return expiryTurn === undefined || expiryTurn > currentTurn;
  });
}

/**
 * Check if player has any goaded creatures that MUST attack (Rule 701.15b)
 * This is different from hasValidAttackers - goaded creatures MUST attack if able,
 * so the player cannot skip combat declaration when they have goaded creatures.
 * 
 * @param ctx Game context
 * @param playerId The player to check
 * @returns true if the player has any goaded creatures that can attack
 */
function hasGoadedCreaturesThatMustAttack(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    const currentTurn = (state as any).turn;
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Check if this creature is goaded
      if (!isCreatureGoaded(permanent, currentTurn)) continue;
      
      // Can't attack if tapped
      if (permanent.tapped) continue;
      
      // Can't attack with summoning sickness (unless haste)
      const enteredThisTurn = permanent.enteredThisTurn === true;
      if (enteredThisTurn) {
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
        const grantedAbilities = permanent.grantedAbilities || [];
        const hasHaste = oracleText.includes("haste") || 
                        grantedAbilities.some((a: string) => a && a.toLowerCase().includes("haste"));
        
        if (!hasHaste) continue; // Summoning sickness
      }
      
      // Check for "can't attack" effects
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) {
        continue;
      }
      
      const hasCantAttack = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't attack") || abilityText.includes("cannot attack");
      });
      
      if (hasCantAttack) continue;
      
      // Found a goaded creature that CAN attack, so it MUST attack
      debug(2, `[hasGoadedCreaturesThatMustAttack] ${playerId}: Found goaded creature that must attack: ${permanent.card?.name || permanent.id}`);
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasGoadedCreaturesThatMustAttack] Error:", err);
    return true; // On error, assume they might have goaded creatures (don't auto-pass)
  }
}

/**
 * Check if player has any valid attackers (untapped creatures that can attack)
 * Used to prevent auto-pass from skipping attack phase when creatures are available
 */
function hasValidAttackers(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Can't attack if tapped
      if (permanent.tapped) continue;
      
      // Can't attack with summoning sickness (unless haste)
      // Check if creature entered this turn AND doesn't have haste
      const enteredThisTurn = permanent.enteredThisTurn === true;
      if (enteredThisTurn) {
        // Check for haste in oracle text or granted abilities
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
        const grantedAbilities = permanent.grantedAbilities || [];
        const hasHaste = oracleText.includes("haste") || 
                        grantedAbilities.some((a: string) => a && a.toLowerCase().includes("haste"));
        
        if (!hasHaste) continue; // Summoning sickness
      }
      
      // Check for "can't attack" effects (like Pacifism, Trapped in the Tower, etc.)
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      // Check permanent's own text
      if (oracleText.includes("can't attack") || oracleText.includes("cannot attack")) {
        continue; // This creature can't attack
      }
      
      // Check granted abilities from other sources
      const hasCantAttack = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't attack") || abilityText.includes("cannot attack");
      });
      
      if (hasCantAttack) continue; // Granted ability prevents attacking
      
      // If we have an untapped creature without summoning sickness that can attack, return true
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasValidAttackers] Error:", err);
    return true; // On error, assume they might have attackers (don't auto-pass)
  }
}

/**
 * Check if player has any valid blockers (untapped creatures that can block)
 * Used to prevent auto-pass from skipping block phase when creatures are available
 */
function hasValidBlockers(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    const battlefield = state.battlefield || [];
    
    // First check if there are any declared attackers to block
    const declaredAttackers = (state as any).declaredAttackers || [];
    if (declaredAttackers.length === 0) {
      return false; // No attackers to block
    }
    
    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      
      // Can't block if tapped
      if (permanent.tapped) continue;
      
      // Check for "can't block" effects (like Goblin Tunneler's ability)
      const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
      const grantedAbilities = permanent.grantedAbilities || [];
      
      // Check permanent's own text
      if (oracleText.includes("can't block") || oracleText.includes("cannot block")) {
        continue; // This creature can't block
      }
      
      // Check granted abilities from other sources
      const hasCantBlock = grantedAbilities.some((a: string) => {
        const abilityText = (a || "").toLowerCase();
        return abilityText.includes("can't block") || abilityText.includes("cannot block");
      });
      
      if (hasCantBlock) continue; // Granted ability prevents blocking
      
      // Note: Flying/reach restrictions are complex and would require checking all attackers
      // For Smart Auto-Pass purposes, we're conservative: if any untapped creature exists, 
      // pause to let player decide (they might have flying blockers for flying attackers, etc.)
      // This is safer than auto-passing and missing a valid block
      return true;
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[hasValidBlockers] Error:", err);
    return true; // On error, assume they might have blockers (don't auto-pass)
  }
}

export function canAct(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const currentStep = String((ctx.state as any).step || '').toUpperCase();
    const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
    const stackIsEmpty = !ctx.state.stack || ctx.state.stack.length === 0;
    const isTurnPlayer = (ctx.state as any).turnPlayer === playerId;
    
    debug(2, `[canAct] ${playerId}: step=${currentStep}, isMainPhase=${isMainPhase}, stackIsEmpty=${stackIsEmpty}, isTurnPlayer=${isTurnPlayer}`);
    
    // CRITICAL: During main phase with empty stack, the turn player should ALWAYS be allowed
    // to take sorcery-speed actions (play land, cast creatures, etc.) before auto-passing.
    // This prevents the race condition where auto-pass advances the step before the player
    // has a chance to play their land or cast sorcery-speed spells.
    //
    // Per MTG rules: During a main phase, if the stack is empty, the active player receives
    // priority and may play lands, cast spells, or activate abilities before passing.
    if (isMainPhase && stackIsEmpty && isTurnPlayer) {
      // Check if player can play a land FIRST (highest priority action)
      // This ensures we never skip the land play opportunity
      if (canPlayLand(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Turn player in main phase can play land - returning TRUE`);
        return true;
      }
    }
    
    // First check instant-speed responses (same as canRespond)
    if (canCastAnySpell(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can cast instant/flash spell - returning TRUE`);
      return true;
    }
    
    if (canActivateAnyAbility(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can activate ability - returning TRUE`);
      return true;
    }
    
    // Check if player can cast commander from command zone (any time they could cast it)
    if (canCastCommanderFromCommandZone(ctx, playerId)) {
      debug(2, `[canAct] ${playerId}: Can cast commander from command zone - returning TRUE`);
      return true;
    }
    
    // During main phase with empty stack, check sorcery-speed actions
    if (isMainPhase && stackIsEmpty) {
      debug(2, `[canAct] ${playerId}: In main phase with empty stack, checking sorcery-speed actions`);
      
      // Check if player can play a land (Note: This is also checked above for turn player specifically,
      // but we check here too for completeness in case of unusual game states)
      if (canPlayLand(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can play land - returning TRUE`);
        return true;
      }
      
      // Check if player can cast any sorcery-speed spells
      if (canCastAnySorcerySpeed(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can cast sorcery-speed spell - returning TRUE`);
        return true;
      }
      
      // Check if player can activate sorcery-speed abilities (equip, reconfigure, etc.)
      if (canActivateSorcerySpeedAbility(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Can activate sorcery-speed ability - returning TRUE`);
        return true;
      }
      
      debug(2, `[canAct] ${playerId}: No sorcery-speed actions available in main phase - returning FALSE`);
    } else {
      debug(1, `[canAct] ${playerId}: Not in main phase with empty stack (phase check failed or stack not empty) - returning FALSE`);
    }
    
    // Check combat phases - if player has valid attackers/blockers, they can act
    // This prevents auto-pass from skipping combat declaration when creatures are available
    
    // GOAD ENFORCEMENT (Rule 701.15b): Goaded creatures MUST attack if able
    // This check ensures that:
    // 1. Players cannot skip combat if they have goaded creatures
    // 2. Auto-pass and smart-pass do not bypass combat with goaded creatures
    // 3. Phase navigator cannot skip to end step if goaded creatures exist
    
    // Check during beginning of combat - if player has goaded creatures, they must proceed to declare attackers
    if ((currentStep === 'BEGIN_COMBAT' || currentStep === 'BEGINNING_OF_COMBAT') && isTurnPlayer && stackIsEmpty) {
      if (hasGoadedCreaturesThatMustAttack(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has goaded creatures that must attack - cannot skip combat - returning TRUE`);
        return true;
      }
    }
    
    if (currentStep === 'DECLARE_ATTACKERS' && isTurnPlayer && stackIsEmpty) {
      // FIRST: Check if player has goaded creatures that MUST attack (Rule 701.15b)
      // Goaded creatures must attack if able - player cannot skip this
      if (hasGoadedCreaturesThatMustAttack(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has goaded creatures that MUST attack - returning TRUE`);
        return true;
      }
      
      // Check if player has any creatures that can attack
      if (hasValidAttackers(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has valid attackers - returning TRUE`);
        return true;
      }
    }
    
    if (currentStep === 'DECLARE_BLOCKERS' && !isTurnPlayer && stackIsEmpty) {
      // Check if player has any creatures that can block
      if (hasValidBlockers(ctx, playerId)) {
        debug(2, `[canAct] ${playerId}: Has valid blockers - returning TRUE`);
        return true;
      }
    }
    
    // No actions available
    debug(2, `[canAct] ${playerId}: No actions available - returning FALSE`);
    return false;
  } catch (err) {
    debugWarn(1, "[canAct] Error:", err);
    // On error, default to true (don't auto-pass) to be safe
    return true;
  }
}

/**
 * Check if player can cast any sorcery-speed spell from hand, graveyard (flashback),
 * or exile (foretell/impulse draw)
 * (creatures, sorceries, artifacts, enchantments, planeswalkers)
 */
function canCastAnySorcerySpeed(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const zones = state.zones?.[playerId];
    if (!zones) return false;
    
    // Get mana pool (including potential from untapped sources)
    const pool = getAvailableMana(state, playerId);
    
    // Get ignored cards for this player (for auto-pass)
    const ignoredCards = (state as any).ignoredCardsForAutoPass?.[playerId] || {};
    
    // Check each card in hand
    if (Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        if (!card || typeof card === "string") continue;
        
        // Skip ignored cards - they shouldn't trigger auto-pass prompts
        if (ignoredCards[card.id]) {
          debug(2, `[canCastAnySorcerySpeed] Skipping ignored card in hand: ${card.name || card.id}`);
          continue;
        }
        
        // Skip transform back faces - they can't be cast from hand
        if (isTransformBackFace(card)) {
          debug(2, `[canCastAnySorcerySpeed] Skipping transform back face: ${card.name || 'unknown'}`);
          continue;
        }
        
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
        const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
        const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
        
        // Check normal mana cost
        if (canPayManaCost(pool, adjustedCost)) {
          // Also check if the spell has valid targets (if it requires targets)
          if (hasValidTargetsForSpell(state, playerId, card)) {
            return true;
          }
        }
        
        // Check alternate costs
        if (hasPayableAlternateCost(ctx, playerId, card)) {
          // Also check if the spell has valid targets (if it requires targets)
          if (hasValidTargetsForSpell(state, playerId, card)) {
            return true;
          }
        }
      }
    }
    
    // Check graveyard for flashback sorceries/creatures/etc AND Station-enabled permanent casting
    if (Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        if (!card || typeof card === "string") continue;
        
        // Skip ignored cards in graveyard
        if (ignoredCards[card.id]) {
          debug(2, `[canCastAnySorcerySpeed] Skipping ignored card in graveyard: ${card.name || card.id}`);
          continue;
        }
        
        const typeLine = (card.type_line || "").toLowerCase();
        
        // Skip instants (already checked)
        if (typeLine.includes("instant")) continue;
        
        // Skip lands
        if (typeLine.includes("land")) continue;
        
        // Check if it's a sorcery-speed spell
        const isSorcerySpeed = 
          typeLine.includes("creature") ||
          typeLine.includes("sorcery") ||
          typeLine.includes("artifact") ||
          typeLine.includes("enchantment") ||
          typeLine.includes("planeswalker") ||
          typeLine.includes("battle");
        
        if (!isSorcerySpeed) continue;
        
        // Check for flashback (allows any spell type with flashback)
        const flashbackInfo = hasFlashback(card);
        if (flashbackInfo.hasIt) {
          // Check if player can pay the flashback cost
          if (flashbackInfo.cost) {
            const parsedCost = parseManaCost(flashbackInfo.cost);
            const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
            const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
            if (canPayManaCost(pool, adjustedCost)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          } else {
            // If we can't parse the cost, be conservative and assume they can pay it
            if (assumeCanPayUnknownCost(card.name, 'flashback')) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          }
          continue; // Processed flashback, continue to next card
        }
        
        // Check for Station-enabled graveyard casting (permanent spells only)
        // Station cards grant: "you may cast a permanent spell from your graveyard"
        // This requires checking if a Station with 8+ counters is on battlefield
        const canCastFromGraveyard = hasPlayFromZoneEffect(ctx, playerId, "graveyard");
        if (canCastFromGraveyard) {
          // Station abilities restrict to "permanent spell" only
          // Permanent spell = creature, artifact, enchantment, planeswalker, battle
          // NOT sorcery or instant
          const isPermanentSpell = 
            typeLine.includes("creature") ||
            typeLine.includes("artifact") ||
            typeLine.includes("enchantment") ||
            typeLine.includes("planeswalker") ||
            typeLine.includes("battle");
          
          // Sorceries are NOT permanents, so block them
          if (typeLine.includes("sorcery") && !isPermanentSpell) {
            continue; // Skip sorceries when casting via Station ability
          }
          
          if (isPermanentSpell) {
            // Check if player can pay the normal cost
            const manaCost = card.mana_cost || "";
            const parsedCost = parseManaCost(manaCost);
            const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
            const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
            
            if (canPayManaCost(pool, adjustedCost)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          }
        }
      }
    }
    
    // Check exile for foretell sorceries or impulse draw effects
    const stateAny = state as any;
    const exileZone = stateAny.exile?.[playerId];
    
    if (Array.isArray(exileZone)) {
      for (const card of exileZone as any[]) {
        if (!card || typeof card === "string") continue;
        
        const typeLine = (card.type_line || "").toLowerCase();
        
        // Skip instants
        if (typeLine.includes("instant")) continue;
        
        // Skip lands
        if (typeLine.includes("land")) continue;
        
        // Check if it's a sorcery-speed spell
        const isSorcerySpeed = 
          typeLine.includes("creature") ||
          typeLine.includes("sorcery") ||
          typeLine.includes("artifact") ||
          typeLine.includes("enchantment") ||
          typeLine.includes("planeswalker") ||
          typeLine.includes("battle");
        
        if (!isSorcerySpeed) continue;
        
        // Check for foretell
        const foretellInfo = hasForetellOrCanCastFromExile(card);
        if (foretellInfo.hasIt) {
          // Check if player can pay the foretell cost
          if (foretellInfo.cost) {
            const parsedCost = parseManaCost(foretellInfo.cost);
            const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
            const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
            if (canPayManaCost(pool, adjustedCost)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          } else {
            // If we can't parse cost or card has "you may cast from exile", be conservative
            if (assumeCanPayUnknownCost(card.name, 'foretell/exile')) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          }
        }
        
        // Check for impulse draw effects (playableFromExile state marker)
        if (stateAny.playableFromExile?.[playerId]) {
          const playableCards = stateAny.playableFromExile[playerId];
          const cardId = card.id || card.name;
          
          // Check if this card is marked as playable from exile
          if (isCardPlayableFromExile(playableCards, cardId)) {
            // Check if player can pay the normal mana cost
            const manaCost = card.mana_cost || "";
            const parsedCost = parseManaCost(manaCost);
            const costAdjustment = getCostAdjustmentForCard(state, playerId, card);
            const adjustedCost = applyCostAdjustment(parsedCost, costAdjustment);
            
            if (canPayManaCost(pool, adjustedCost)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
            
            // Check alternate costs
            if (hasPayableAlternateCost(ctx, playerId, card)) {
              // Also check if the spell has valid targets (if it requires targets)
              if (hasValidTargetsForSpell(state, playerId, card)) {
                return true;
              }
            }
          }
        }
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canCastAnySorcerySpeed] Error:", err);
    return false;
  }
}

/**
 * Check if player can activate any sorcery-speed abilities (equip, reconfigure, etc.)
 * These can only be activated during main phase when stack is empty
 */
function canActivateSorcerySpeedAbility(ctx: GameContext, playerId: PlayerID): boolean {
  try {
    const { state } = ctx;
    if (!state) return false;
    
    const battlefield = state.battlefield || [];
    const pool = getAvailableMana(state, playerId);
    
    // Check each permanent controlled by the player
    for (const permanent of battlefield) {
      if (!permanent || !permanent.card) continue;
      if (permanent.controller !== playerId) continue;
      
      const oracleText = permanent.card.oracle_text || "";
      const effectLower = oracleText.toLowerCase();
      
      // Check for equip ability: "Equip {cost}" or "{cost}: Equip"
      if (effectLower.includes("equip")) {
        // Try pattern 1: "Equip {cost}"
        let equipMatch = oracleText.match(/equip\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        
        // Try pattern 2: "{cost}: Equip"
        if (!equipMatch) {
          equipMatch = oracleText.match(/(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*:\s*equip/i);
        }
        
        if (equipMatch) {
          const costString = equipMatch[1];
          if (costString) {
            const parsedCost = parseManaCost(costString);
            if (canPayManaCost(pool, parsedCost)) {
              // Also check if there's a valid target (a creature to equip)
              const hasCreatureTarget = battlefield.some((p: any) => 
                p.controller === playerId && 
                (p.card?.type_line || "").toLowerCase().includes("creature")
              );
              if (hasCreatureTarget) {
                return true;
              }
            }
          }
        }
      }
      
      // Check for reconfigure ability: "Reconfigure {cost}"
      if (effectLower.includes("reconfigure")) {
        const reconfigureMatch = oracleText.match(/reconfigure\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
        if (reconfigureMatch) {
          const costString = reconfigureMatch[1];
          const parsedCost = parseManaCost(costString);
          if (canPayManaCost(pool, parsedCost)) {
            return true;
          }
        }
      }
      
      // Check for other sorcery-speed only abilities
      // First check if this ability has sorcery-speed restriction
      if (/(activate|use) (?:this ability|these abilities) only (?:as a sorcery|any time you could cast a sorcery)/i.test(oracleText)) {
        // Look for any activated ability pattern before the restriction: "{cost}: Effect"
        const abilityPattern = /(\{[^}]+\}(?:\s*,?\s*\{[^}]+\})*)\s*:/gi;
        const matches = oracleText.matchAll(abilityPattern);
        
        for (const match of matches) {
          const costString = match[1];
          if (costString) {
            const parsedCost = parseManaCost(costString);
            if (canPayManaCost(pool, parsedCost)) {
              return true;
            }
          }
        }
      }
      
      // Check for planeswalker loyalty abilities (sorcery-speed by default)
      // Loyalty abilities use [+N]:, [-N]:, or [0]: format
      const typeLine = (permanent.card?.type_line || "").toLowerCase();
      if (typeLine.includes("planeswalker")) {
        // Check if the planeswalker has already activated a loyalty ability this turn
        const activationsThisTurn = (permanent as any).loyaltyActivationsThisTurn || 0;
        
        // Check for Chain Veil or similar effects that allow more activations
        let maxActivations = 1;
        for (const otherPerm of battlefield) {
          if (otherPerm.controller !== playerId) continue;
          const otherName = (otherPerm.card?.name || "").toLowerCase();
          const otherOracle = (otherPerm.card?.oracle_text || "").toLowerCase();
          
          // The Chain Veil: "For each planeswalker you control, you may activate one of its loyalty abilities once"
          if (otherName.includes("chain veil") || 
              (otherOracle.includes("activate") && otherOracle.includes("loyalty abilities") && otherOracle.includes("additional"))) {
            maxActivations = 2;
            break;
          }
        }
        
        if (activationsThisTurn < maxActivations) {
          // Get current loyalty
          const loyaltyString = (permanent.card as any)?.loyalty;
          const currentLoyalty = (permanent as any).loyaltyCounters ?? (permanent as any).loyalty ?? 
                                  (loyaltyString ? parseInt(String(loyaltyString), 10) : 0);
          
          // Check if any loyalty ability can be activated
          // Pattern: +N:, -N:, 0: (Scryfall format WITHOUT brackets)
          // Also handles Unicode minus/dash characters: − (U+2212), – (en dash), — (em dash)
          const loyaltyPattern = /^([+−–—-]?)(\d+|X):\s*/gim;
          let match;
          while ((match = loyaltyPattern.exec(oracleText)) !== null) {
            // Normalize sign: Unicode minus signs to standard minus
            const rawSign = match[1];
            const sign = rawSign.replace(/[−–—]/g, '-');
            const cost = match[2];
            
            if (sign === '+' || sign === '' || cost === '0') {
              // Plus ability or zero ability - always usable (adds or doesn't change loyalty)
              return true;
            } else if (sign === '-') {
              // Minus ability - check if we have enough loyalty
              // For -X abilities, the player chooses X, so X can be 0 or any value up to current loyalty
              // This means -X abilities are always activatable (player can choose X=0)
              const numericCost = cost === 'X' ? 0 : parseInt(cost, 10);
              if (currentLoyalty >= numericCost) {
                return true;
              }
            }
          }
        }
      }
    }
    
    return false;
  } catch (err) {
    debugWarn(1, "[canActivateSorcerySpeedAbility] Error:", err);
    return false;
  }
}

