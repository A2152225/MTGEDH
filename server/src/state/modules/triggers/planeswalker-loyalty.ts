/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover planeswalker loyalty parse/activate helpers
 * Public: parsePlaneswalkerAbilities, getLoyaltyActivationLimit, checkChainVeilEndStepTrigger,
 *   canActivateLoyaltyAbility, getLoyaltyAdditionalCost, canActivateLoyaltyAtInstantSpeed,
 *   getTeferisTalentDrawTrigger, calculateLoyaltyChange, getAvailableLoyaltyAbilities
 */
// ============================================================================
// Planeswalker Loyalty Ability Support
// ============================================================================

/**
 * Planeswalker loyalty abilities parsed from oracle text
 * 
 * Supports all standard planeswalker ability formats:
 * - [+N]: Add N loyalty (e.g., [+2]: Exile top three cards)
 * - [-N]: Remove N loyalty (e.g., [-3]: Return target creature)
 * - [0]: No loyalty change (e.g., [0]: Draw a card)
 * - [-X]: Variable loyalty cost (e.g., [-X]: Put a creature with MV X onto battlefield)
 * 
 * Examples from actual cards:
 * - Ashiok, Nightmare Weaver: [+2], [-X], [-10]
 * - Liliana of the Veil: [+1], [-2], [-6]
 * - Jace, the Mind Sculptor: [+2], [0], [-1], [-12]
 * - Nissa, Who Shakes the World: [+1], [-8]
 */
export interface LoyaltyAbility {
  cost: number | 'X'; // Positive = add loyalty, negative = remove, 0 = static, 'X' = variable
  costDisplay: string; // Original cost string for display ("+2", "-X", "0", etc.)
  effect: string;
  requiresTarget: boolean;
  targetType?: string;
  isUltimate?: boolean;
  isVariableCost?: boolean; // True for -X abilities
  xBasedEffect?: string; // Description of what X represents (e.g., "mana value")
}

export interface PlaneswalkerAbilities {
  permanentId: string;
  cardName: string;
  startingLoyalty: number;
  abilities: LoyaltyAbility[];
  hasStaticAbility?: boolean;
  staticAbilityText?: string;
}

/**
 * Parse planeswalker abilities from oracle text
 * 
 * Handles all 168+ planeswalkers including:
 * - Standard +N/-N abilities
 * - Variable -X abilities (Ashiok, Nissa Revane, etc.)
 * - Static abilities (Narset Transcendent, The Wanderer, etc.)
 * - Zero-cost abilities (Jace TMS, Teferi Hero of Dominaria, etc.)
 */
export function parsePlaneswalkerAbilities(card: any, permanent: any): PlaneswalkerAbilities | null {
  const oracleText = card?.oracle_text || "";
  const typeLine = (card?.type_line || "").toLowerCase();
  
  if (!typeLine.includes('planeswalker')) {
    return null;
  }
  
  const startingLoyalty = card?.loyalty ? parseInt(card.loyalty, 10) : 0;
  const abilities: LoyaltyAbility[] = [];
  
  // Check for static abilities (text before first loyalty ability)
  // Examples: "Your opponents can't cast noncreature spells during combat."
  // Static abilities don't have [+/-N]: format
  let hasStaticAbility = false;
  let staticAbilityText: string | undefined;
  
  // Find first loyalty ability marker
  const firstLoyaltyMatch = oracleText.match(/\[[+-]?(?:\d+|X)\]:/i);
  if (firstLoyaltyMatch && firstLoyaltyMatch.index && firstLoyaltyMatch.index > 0) {
    const textBeforeLoyalty = oracleText.substring(0, firstLoyaltyMatch.index).trim();
    // If there's substantial text before the first loyalty ability, it's likely a static ability
    if (textBeforeLoyalty.length > 10 && !textBeforeLoyalty.startsWith('—')) {
      hasStaticAbility = true;
      staticAbilityText = textBeforeLoyalty;
    }
  }
  
  // Parse loyalty abilities: +N:, -N:, 0:, -X:, +X: (Scryfall format WITHOUT brackets)
  // Pattern handles both numeric costs and X costs, and various dash characters
  // The Unicode minus sign (−, U+2212) is commonly used in Scryfall data
  // Examples: +2: Effect, −3: Effect, 0: Effect, −X: Effect
  // Note: Scryfall oracle text uses newlines to separate abilities, so we match from start of line
  const loyaltyPattern = /^([+−–—-]?\d+|[+−–—-]?X):\s*(.+)$/gim;
  let match;
  
  while ((match = loyaltyPattern.exec(oracleText)) !== null) {
    const rawCostString = match[1];
    const effect = match[2].trim();
    
    // Normalize the cost string by replacing Unicode minus/dash characters with standard minus
    const costString = rawCostString.replace(/[−–—]/g, '-');
    const isVariableCost = costString.toUpperCase().includes('X');
    
    // Parse the cost value
    let cost: number | 'X';
    if (isVariableCost) {
      cost = 'X';
    } else {
      cost = parseInt(costString, 10);
    }
    
    // Detect if this ability requires a target
    const effectLower = effect.toLowerCase();
    const requiresTarget = 
      effectLower.includes('target') ||
      effectLower.includes('choose');
    
    // Detect target type (expanded list)
    let targetType: string | undefined;
    if (requiresTarget) {
      if (effectLower.includes('target creature')) targetType = 'creature';
      else if (effectLower.includes('target player') || effectLower.includes("target opponent")) targetType = 'player';
      else if (effectLower.includes('target permanent')) targetType = 'permanent';
      else if (effectLower.includes('target land')) targetType = 'land';
      else if (effectLower.includes('target artifact')) targetType = 'artifact';
      else if (effectLower.includes('target enchantment')) targetType = 'enchantment';
      else if (effectLower.includes('target planeswalker')) targetType = 'planeswalker';
      else if (effectLower.includes('target spell')) targetType = 'spell';
      else if (effectLower.includes('target card')) targetType = 'card';
      else if (effectLower.includes('target nonland')) targetType = 'nonland permanent';
      else if (effectLower.includes('target noncreature')) targetType = 'noncreature permanent';
    }
    
    // For X abilities, try to detect what X represents
    let xBasedEffect: string | undefined;
    if (isVariableCost) {
      if (effectLower.includes('mana value x') || effectLower.includes('mana value equal')) {
        xBasedEffect = 'mana value';
      } else if (effectLower.includes('power x') || effectLower.includes('power equal')) {
        xBasedEffect = 'power';
      } else if (effectLower.includes('x damage')) {
        xBasedEffect = 'damage';
      } else if (effectLower.includes('x cards')) {
        xBasedEffect = 'cards';
      } else if (effectLower.includes('x target') || effectLower.includes('x creatures')) {
        xBasedEffect = 'targets';
      }
    }
    
    abilities.push({
      cost,
      costDisplay: costString.startsWith('+') || costString.startsWith('-') ? costString : `+${costString}`,
      effect,
      requiresTarget,
      targetType,
      isVariableCost,
      xBasedEffect,
    });
  }
  
  // Determine ultimate ability (typically the largest negative cost, or only negative ability)
  // For variable X costs, it's usually an ultimate if there are no other large negative costs
  if (abilities.length > 0) {
    let lowestCost = 0;
    let lowestCostIndex = -1;
    
    for (let i = 0; i < abilities.length; i++) {
      const ability = abilities[i];
      if (ability.cost === 'X') {
        // -X is often an ultimate or at least a significant ability
        // If it's the only negative ability, mark it as ultimate
        const hasOtherNegative = abilities.some((a, idx) => 
          idx !== i && typeof a.cost === 'number' && a.cost < 0
        );
        if (!hasOtherNegative) {
          ability.isUltimate = true;
        }
      } else if (typeof ability.cost === 'number' && ability.cost < lowestCost) {
        lowestCost = ability.cost;
        lowestCostIndex = i;
      }
    }
    
    // Mark the ability with lowest cost as ultimate (typically -6 or lower)
    if (lowestCostIndex >= 0 && lowestCost <= -5) {
      abilities[lowestCostIndex].isUltimate = true;
    } else if (lowestCostIndex >= 0 && abilities.length >= 3) {
      // For 3+ ability planeswalkers, the last negative ability is usually the ultimate
      // even if cost is lower than -5 (e.g., Liliana of the Veil's -6)
      abilities[lowestCostIndex].isUltimate = true;
    }
  }
  
  if (abilities.length === 0 && !hasStaticAbility) {
    return null;
  }
  
  return {
    permanentId: permanent?.id || '',
    cardName: card?.name || 'Unknown Planeswalker',
    startingLoyalty,
    abilities,
    hasStaticAbility,
    staticAbilityText,
  };
}

/**
 * Get the maximum number of loyalty ability activations per planeswalker per turn
 * 
 * Default is 1, but can be increased by:
 * - The Chain Veil: "At the beginning of your end step, if you didn't activate a loyalty ability
 *   of a planeswalker this turn, you lose 2 life. You may activate loyalty abilities of 
 *   planeswalkers you control twice each turn rather than only once."
 * - Oath of Teferi: "You may activate the loyalty abilities of planeswalkers you control twice
 *   each turn rather than only once."
 * - Teferi, Temporal Pilgrim emblem
 * - Carth the Lion (from graveyard)
 * - Nicol Bolas, Dragon-God (copying abilities)
 */
export function getLoyaltyActivationLimit(gameState: any, playerId: string): number {
  let limit = 1; // Default: once per turn
  
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // The Chain Veil
    if (cardName === "the chain veil") {
      limit = Math.max(limit, 2);
    }
    
    // Oath of Teferi
    if (cardName === "oath of teferi") {
      limit = Math.max(limit, 2);
    }
    
    // Carth the Lion - "You may activate loyalty abilities of planeswalkers you control twice"
    if (cardName === "carth the lion") {
      limit = Math.max(limit, 2);
    }
    
    // Generic check for "loyalty abilities...twice each turn" or similar
    if (oracleText.includes("loyalty abilities") && 
        (oracleText.includes("twice each turn") || oracleText.includes("twice rather than only once"))) {
      limit = Math.max(limit, 2);
    }
    
    // Some effects might allow even more activations (theoretical future cards)
    const tripleMatch = oracleText.match(/loyalty abilities.*three times/i);
    if (tripleMatch) {
      limit = Math.max(limit, 3);
    }
  }
  
  // Check emblems (stored in a different location)
  const emblems = gameState?.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== playerId) continue;
    
    const oracleText = (emblem.effect || "").toLowerCase();
    
    if (oracleText.includes("loyalty abilities") && 
        (oracleText.includes("twice") || oracleText.includes("additional"))) {
      limit = Math.max(limit, 2);
    }
  }
  
  return limit;
}

/**
 * Check if The Chain Veil trigger should fire (end step: lose 2 life if no loyalty activated)
 */
export function checkChainVeilEndStepTrigger(gameState: any, playerId: string): boolean {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    if (cardName === "the chain veil") {
      // Check if any planeswalker loyalty ability was activated this turn
      const planeswalkers = battlefield.filter((p: any) => 
        p?.controller === playerId && 
        (p?.card?.type_line || "").toLowerCase().includes("planeswalker")
      );
      
      const anyActivated = planeswalkers.some((pw: any) => 
        (pw?.loyaltyActivationsThisTurn || 0) > 0
      );
      
      // If no loyalty ability was activated, trigger the 2 life loss
      return !anyActivated;
    }
  }
  
  return false;
}

/**
 * Check if a planeswalker can activate a specific ability
 * (Once per turn per planeswalker, at sorcery speed, loyalty requirement met)
 * 
 * Handles:
 * - Standard +N/-N abilities
 * - Variable -X abilities (can always activate if loyalty >= 1)
 * - Zero cost abilities
 * - The Chain Veil effect (additional loyalty activation)
 * - Oath of Teferi effect (activate loyalty twice per turn)
 * - Eidolon of Obstruction (loyalty abilities cost {1} more for opponents)
 * - Teferi's Talent emblem (instant speed loyalty activation)
 */
export function canActivateLoyaltyAbility(
  permanent: any,
  abilityIndex: number,
  gameState: any,
  playerId: string,
  xValue?: number // For -X abilities, what X value the player wants to use
): { canActivate: boolean; reason?: string; maxX?: number; additionalManaCost?: number } {
  // Check controller
  if (permanent?.controller !== playerId) {
    return { canActivate: false, reason: "Not your planeswalker" };
  }
  
  // Check if already activated this turn, considering Chain Veil and similar effects
  const activationsThisTurn = permanent?.loyaltyActivationsThisTurn || 0;
  const maxActivations = getLoyaltyActivationLimit(gameState, playerId);
  
  if (activationsThisTurn >= maxActivations) {
    return { canActivate: false, reason: "Already activated maximum loyalty abilities this turn" };
  }
  
  // Check current loyalty
  const currentLoyalty = permanent?.counters?.loyalty || permanent?.card?.loyalty || 0;
  const abilities = parsePlaneswalkerAbilities(permanent?.card, permanent);
  
  if (!abilities || abilityIndex >= abilities.abilities.length) {
    return { canActivate: false, reason: "Invalid ability" };
  }
  
  const ability = abilities.abilities[abilityIndex];
  
  // Calculate additional mana cost from effects like Eidolon of Obstruction
  const additionalManaCost = getLoyaltyAdditionalCost(gameState, playerId, permanent);
  
  // Handle variable X cost abilities
  if (ability.cost === 'X' || ability.isVariableCost) {
    // -X abilities can be activated with any X from 0 to current loyalty
    // The player chooses X when activating
    const maxX = currentLoyalty;
    
    if (xValue !== undefined) {
      // Validate the chosen X value
      if (xValue < 0) {
        return { canActivate: false, reason: "X cannot be negative", maxX, additionalManaCost };
      }
      if (xValue > currentLoyalty) {
        return { canActivate: false, reason: `X cannot exceed current loyalty (${currentLoyalty})`, maxX, additionalManaCost };
      }
    }
    
    // Can activate -X ability as long as we have any loyalty
    // (X can be 0 in some cases)
    return { canActivate: true, maxX, additionalManaCost };
  }
  
  // For minus abilities with fixed cost, check if we have enough loyalty
  if (typeof ability.cost === 'number' && ability.cost < 0 && currentLoyalty < Math.abs(ability.cost)) {
    return { canActivate: false, reason: `Not enough loyalty (have ${currentLoyalty}, need ${Math.abs(ability.cost)})`, additionalManaCost };
  }
  
  // Check timing restrictions
  const canActivateAtInstantSpeed = canActivateLoyaltyAtInstantSpeed(gameState, playerId);
  const phase = gameState?.phase || '';
  const stack = gameState?.stack || [];
  const activePlayer = gameState?.activePlayer;
  
  if (!canActivateAtInstantSpeed) {
    // Normal sorcery speed check (main phase, stack empty, have priority)
    if (!phase.includes('main') || stack.length > 0) {
      return { canActivate: false, reason: "Can only activate at sorcery speed", additionalManaCost };
    }
    
    if (activePlayer !== playerId) {
      return { canActivate: false, reason: "Not your turn", additionalManaCost };
    }
  }
  // If instant speed is allowed, skip the sorcery speed checks
  
  return { canActivate: true, additionalManaCost };
}

/**
 * Get additional mana cost for activating loyalty abilities
 * 
 * Effects that increase loyalty ability costs:
 * - Eidolon of Obstruction: "Loyalty abilities of planeswalkers your opponents control cost {1} more to activate"
 * - Suppression Field: "Activated abilities cost {2} more to activate" (includes loyalty abilities)
 */
export function getLoyaltyAdditionalCost(gameState: any, playerId: string, planeswalker: any): number {
  let additionalCost = 0;
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const controller = permanent.controller;
    
    // Eidolon of Obstruction - affects opponents' planeswalkers
    if (cardName === "eidolon of obstruction" && controller !== playerId) {
      // The planeswalker's controller is playerId, and Eidolon is controlled by opponent
      // So this makes playerId's loyalty abilities cost more
      additionalCost += 1;
    }
    
    // Also check for generic "loyalty abilities...cost...more" patterns
    // This handles similar future cards
    if (controller !== playerId && 
        oracleText.includes("loyalty abilities") && 
        oracleText.includes("opponents control") &&
        oracleText.includes("cost") && 
        oracleText.includes("more")) {
      // Try to extract the amount
      const costMatch = oracleText.match(/cost\s*\{(\d+)\}\s*more/);
      if (costMatch) {
        additionalCost += parseInt(costMatch[1], 10);
      }
    }
    
    // Suppression Field affects all activated abilities
    if (cardName === "suppression field") {
      additionalCost += 2;
    }
    
    // Aura Shards and similar - "Activated abilities...cost {N} more"
    if (oracleText.includes("activated abilities") && 
        oracleText.includes("cost") && 
        oracleText.includes("more")) {
      const costMatch = oracleText.match(/cost\s*\{(\d+)\}\s*more/);
      if (costMatch) {
        additionalCost += parseInt(costMatch[1], 10);
      }
    }
  }
  
  return additionalCost;
}

/**
 * Check if a player can activate loyalty abilities at instant speed
 * 
 * Effects that grant instant speed activation:
 * - Teferi's Talent emblem: "You may activate loyalty abilities of planeswalkers you control 
 *   on any player's turn any time you could cast an instant"
 * - Teferi, Temporal Archmage emblem (similar effect)
 * - The Peregrine Dynamo (can copy at instant speed, but not activate)
 */
export function canActivateLoyaltyAtInstantSpeed(gameState: any, playerId: string): boolean {
  // Check emblems
  const emblems = gameState?.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== playerId) continue;
    
    const effect = (emblem.effect || "").toLowerCase();
    
    // Teferi's Talent emblem
    if (effect.includes("loyalty abilities") && 
        effect.includes("any player's turn") &&
        effect.includes("instant")) {
      return true;
    }
    
    // Teferi, Temporal Archmage emblem
    if (effect.includes("loyalty abilities") && 
        effect.includes("any time you could cast an instant")) {
      return true;
    }
  }
  
  // Check battlefield for permanents that grant this ability
  const battlefield = gameState?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // Generic check for instant speed loyalty activation
    if (oracleText.includes("loyalty abilities") && 
        oracleText.includes("any time") &&
        oracleText.includes("instant")) {
      return true;
    }
  }
  
  return false;
}

/**
 * Handle Teferi's Talent draw trigger - add loyalty counter to enchanted planeswalker
 * Returns the planeswalker that should receive a loyalty counter, if any
 */
export function getTeferisTalentDrawTrigger(gameState: any, playerId: string): string | null {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    if (cardName === "teferi's talent") {
      // Find the enchanted planeswalker
      const attachedTo = permanent.attachedTo;
      if (attachedTo) {
        return attachedTo;
      }
    }
  }
  
  return null;
}

/**
 * Calculate the loyalty change when activating an ability
 * Returns the amount to add (positive) or remove (negative) from loyalty
 */
export function calculateLoyaltyChange(ability: LoyaltyAbility, xValue?: number): number {
  if (ability.cost === 'X' || ability.isVariableCost) {
    // -X ability: remove X loyalty (xValue should be provided)
    return -(xValue || 0);
  }
  
  if (typeof ability.cost === 'number') {
    return ability.cost; // Already signed correctly (+N or -N)
  }
  
  return 0;
}

// NOTE: Aura Graveyard Triggers have been moved to ./triggers/aura-graveyard.ts
// Re-exports are at the top of this file

/**
 * Get all available loyalty abilities for a planeswalker with activation status
 * Useful for UI to display which abilities can be activated
 */
export function getAvailableLoyaltyAbilities(
  permanent: any,
  gameState: any,
  playerId: string
): Array<{
  index: number;
  ability: LoyaltyAbility;
  canActivate: boolean;
  reason?: string;
  maxX?: number;
}> {
  const abilities = parsePlaneswalkerAbilities(permanent?.card, permanent);
  if (!abilities) {
    return [];
  }
  
  return abilities.abilities.map((ability, index) => {
    const result = canActivateLoyaltyAbility(permanent, index, gameState, playerId);
    return {
      index,
      ability,
      canActivate: result.canActivate,
      reason: result.reason,
      maxX: result.maxX,
    };
  });
}
