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
  console.warn(`[hasFlashback] Found flashback on ${card.name} but could not parse cost from: "${oracleText}"`);
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
    console.warn(`[hasForetellOrCanCastFromExile] Found foretell on ${card.name} but could not parse cost from: "${oracleText}"`);
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
  console.warn(`[assumeCanPayUnknownCost] Could not parse ${mechanicName} cost for ${cardName} - being conservative, assuming player can pay`);
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
      console.warn(`[hasValidTargetsForSpell] Could not categorize targeting spell ${cardName}, assuming no valid targets`);
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
function getCostAdjustmentForCard(state: any, playerId: PlayerID, card: any): number {
  if (!state?.battlefield || !card) return 0;
  
  const typeLine = (card.type_line || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  const manaCostRaw = card.mana_cost || "";
  const colors = (card.colors || card.color_identity || []).map((c: string) => c.toUpperCase());
  const isRedSpell = /{R}/i.test(manaCostRaw) || colors.includes("R");
  const isCreatureSpell = typeLine.includes("creature");
  const isArtifactOrEnchantment = typeLine.includes("artifact") || typeLine.includes("enchantment");
  // NOTE: These tables intentionally cover only the red modifiers called out in the current requirements.
  // Add additional entries if wider color support is needed.
  const redCostReducers = [
    { nameMatch: "fire crystal", textMatch: "red spells you cast cost {1} less", applies: (creature: boolean) => true },
    { nameMatch: "ruby medallion", textMatch: "red spells you cast cost {1} less", applies: (creature: boolean) => true },
    { nameMatch: "hazoret's monument", textMatch: "red creature spells you cast cost {1} less", applies: (creature: boolean) => creature },
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
    
    // Cost reducers for red spells (scoped to requested effects)
    if (sameController && isRedSpell) {
      for (const reducer of redCostReducers) {
        if ((reducer.applies(isCreatureSpell)) &&
            (permName.includes(reducer.nameMatch) || permOracle.includes(reducer.textMatch))) {
          // Each matching permanent contributes an additional {1} reduction
          adjustment -= 1;
        }
      }
    }
    
    // Taxes from opponents (Aura of Silence)
    if (!sameController && isArtifactOrEnchantment) {
      for (const tax of taxEffects) {
        if (tax.applies(isArtifactOrEnchantment) &&
            (permName.includes(tax.nameMatch) || permOracle.includes(tax.textMatch))) {
          // Legendary copies should rarely stack, but keep additive behavior for simplicity
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
    
    // Check each card in hand
    if (Array.isArray(zones.hand)) {
      for (const card of zones.hand as any[]) {
        if (!card || typeof card === "string") continue;
        
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
  
  // Check for tap abilities: "{T}: Effect" or "{Cost}, {T}: Effect"
  // Common patterns: 
  // - "{T}: Add {G}" (simple tap)
  // - "{T}, Sacrifice ~: Effect" (tap + additional cost after)
  // - "{2}{R}, {T}: This creature fights..." (mana + tap, like Brash Taunter)
  const hasTapAbility = /\{T\}:/i.test(oracleText);
  
  if (hasTapAbility) {
    // Can only activate if not tapped
    if (permanent.tapped) return false;
    
    // Match tap abilities with various cost patterns:
    // Pattern 1: "{T}, <additional>: <effect>" - tap first, then additional costs
    // Pattern 2: "<costs>, {T}: <effect>" - costs before tap (e.g., {2}{R}, {T})
    // Pattern 3: "{T}: <effect>" - simple tap only
    const abilityMatch = oracleText.match(/(?:(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*,\s*)?\{T\}(?:\s*,\s*([^:]+))?:\s*(.+)/i);
    if (!abilityMatch) return true; // Couldn't parse, assume can activate
    
    const costsBeforeTap = abilityMatch[1] || ""; // Mana costs before {T}
    const additionalCostAfterTap = abilityMatch[2] || ""; // Other costs after {T}
    const effect = abilityMatch[3] || "";
    
    // CRITICAL: Skip mana abilities - they don't use the stack and don't require priority
    // Per MTG Rule 605.3a, mana abilities can be activated whenever needed for payment
    if (isManaAbility(oracleText, effect)) {
      return false; // Mana abilities don't prevent auto-pass
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
      
      // Check for sacrifice costs
      if (additionalCostAfterTap.toLowerCase().includes("sacrifice")) {
        // Would need to check if player has permanents to sacrifice
        // For now, assume they might have one
        return true;
      }
      
      // Check for life payment costs
      if (additionalCostAfterTap.toLowerCase().includes("pay") && additionalCostAfterTap.toLowerCase().includes("life")) {
        const lifeMatch = additionalCostAfterTap.match(/pay (\d+) life/i);
        if (lifeMatch) {
          const lifeCost = parseInt(lifeMatch[1], 10);
          const currentLife = state.life?.[playerId] ?? 40;
          if (currentLife < lifeCost) {
            return false;
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
    
    // Check each permanent on battlefield
    for (const permanent of battlefield) {
      if (hasActivatableAbility(ctx, playerId, permanent, pool)) {
        return true;
      }
    }
    
    // Check graveyard for cards with activated abilities that can be used from there
    // IMPORTANT: Only check cards that are ACTUALLY in the graveyard, not on battlefield
    const zones = state.zones?.[playerId];
    if (zones && Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
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
          console.log(`[canPlayLand] ${playerId}: Found land in hand: ${card.name || 'unknown'} (${card.type_line || 'unknown type'}) - returning TRUE`);
          return true; // Found a land in hand that can be played
        }
      }
      console.log(`[canPlayLand] ${playerId}: No lands found in hand of ${zones.hand.length} cards - returning FALSE`);
    } else {
      console.log(`[canPlayLand] ${playerId}: zones.hand is not an array:`, typeof zones.hand, zones.hand);
      // FALLBACK: Check handCount to see if there might be cards
      if (zones.handCount && zones.handCount > 0) {
        console.warn(`[canPlayLand] ${playerId}: WARNING - handCount=${zones.handCount} but zones.hand is not an array! This is a data consistency issue.`);
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
      const totalCost = {
        ...parsedCost,
        generic: parsedCost.generic + tax,
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
          console.log(`[canCastCommanderFromCommandZone] ${playerId}: Commander ${commander.name} has flash/instant - can cast`);
          return true;
        }
        
        // For sorcery-speed commanders, check if we're in main phase with empty stack
        const currentStep = String((state as any).step || '').toUpperCase();
        const isMainPhase = currentStep === 'MAIN1' || currentStep === 'MAIN2' || currentStep === 'MAIN';
        const stackIsEmpty = !state.stack || state.stack.length === 0;
        
        if (isMainPhase && stackIsEmpty) {
          console.log(`[canCastCommanderFromCommandZone] ${playerId}: Commander ${commander.name} can be cast (main phase, empty stack)`);
          return true;
        }
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[canCastCommanderFromCommandZone] Error:", err);
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
    console.warn("[hasValidAttackers] Error:", err);
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
    console.warn("[hasValidBlockers] Error:", err);
    return true; // On error, assume they might have blockers (don't auto-pass)
  }
}

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
    
    // Check if player can cast commander from command zone (any time they could cast it)
    if (canCastCommanderFromCommandZone(ctx, playerId)) {
      console.log(`[canAct] ${playerId}: Can cast commander from command zone - returning TRUE`);
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
      
      // Check if player can activate sorcery-speed abilities (equip, reconfigure, etc.)
      if (canActivateSorcerySpeedAbility(ctx, playerId)) {
        console.log(`[canAct] ${playerId}: Can activate sorcery-speed ability - returning TRUE`);
        return true;
      }
      
      console.log(`[canAct] ${playerId}: No sorcery-speed actions available in main phase - returning FALSE`);
    } else {
      console.log(`[canAct] ${playerId}: Not in main phase with empty stack (phase check failed or stack not empty) - returning FALSE`);
    }
    
    // Check combat phases - if player has valid attackers/blockers, they can act
    // This prevents auto-pass from skipping combat declaration when creatures are available
    const isTurnPlayer = (ctx.state as any).turnPlayer === playerId;
    
    if (currentStep === 'DECLARE_ATTACKERS' && isTurnPlayer && stackIsEmpty) {
      // Check if player has any creatures that can attack
      if (hasValidAttackers(ctx, playerId)) {
        console.log(`[canAct] ${playerId}: Has valid attackers - returning TRUE`);
        return true;
      }
    }
    
    if (currentStep === 'DECLARE_BLOCKERS' && !isTurnPlayer && stackIsEmpty) {
      // Check if player has any creatures that can block
      if (hasValidBlockers(ctx, playerId)) {
        console.log(`[canAct] ${playerId}: Has valid blockers - returning TRUE`);
        return true;
      }
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
    
    // Check each card in hand
    if (Array.isArray(zones.hand)) {
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
    
    // Check graveyard for flashback sorceries/creatures/etc
    if (Array.isArray(zones.graveyard)) {
      for (const card of zones.graveyard as any[]) {
        if (!card || typeof card === "string") continue;
        
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
        
        // Check for flashback
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
    console.warn("[canCastAnySorcerySpeed] Error:", err);
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
    }
    
    return false;
  } catch (err) {
    console.warn("[canActivateSorcerySpeedAbility] Error:", err);
    return false;
  }
}
