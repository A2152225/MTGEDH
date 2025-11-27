/**
 * Activated Ability Parser
 * 
 * Parses oracle text to extract activated abilities from permanents on the battlefield.
 * Supports:
 * - Mana abilities (tap for mana)
 * - Fetch land abilities (sacrifice to search)
 * - Creature abilities with tap costs
 * - Planeswalker loyalty abilities
 * - Equipment abilities
 * - Other activated abilities with cost:effect format
 */

import type { KnownCardRef } from '../../../shared/src';

/**
 * Represents a parsed activated ability
 */
export interface ParsedActivatedAbility {
  id: string;
  label: string;
  description: string;
  cost: string;
  effect: string;
  // Cost components
  requiresTap: boolean;
  requiresUntap: boolean;  // For untap symbol costs like {Q}
  requiresSacrifice: boolean;
  manaCost?: string;
  lifeCost?: number;
  loyaltyCost?: number;  // For planeswalker abilities
  otherCosts?: string[];
  // Ability characteristics
  isManaAbility: boolean;
  isLoyaltyAbility: boolean;
  isFetchAbility: boolean;
  // Activation restrictions
  timingRestriction?: 'sorcery' | 'instant';
  oncePerTurn?: boolean;
  // For targeting
  requiresTarget?: boolean;
  targetDescription?: string;
}

/**
 * Represents the context for ability activation
 */
export interface ActivationContext {
  isTapped: boolean;
  hasSummoningSickness: boolean;
  hasHaste: boolean;
  hasThousandYearElixirEffect: boolean;  // Allows tap abilities despite summoning sickness
  loyaltyCounters?: number;
  controllerHasPriority: boolean;
  isMainPhase: boolean;
  isOwnTurn: boolean;
  stackEmpty: boolean;
}

/**
 * Check if a creature can activate tap abilities considering summoning sickness and haste effects
 */
export function canActivateTapAbility(
  requiresTap: boolean,
  context: ActivationContext,
  isManaAbility: boolean = false
): { canActivate: boolean; reason?: string } {
  // Non-tap abilities don't care about summoning sickness
  if (!requiresTap) {
    return { canActivate: true };
  }

  // Already tapped - can't tap again
  if (context.isTapped) {
    return { canActivate: false, reason: 'Already tapped' };
  }

  // Summoning sickness check
  if (context.hasSummoningSickness) {
    // Haste allows tap abilities
    if (context.hasHaste) {
      return { canActivate: true };
    }
    
    // Thousand-Year Elixir effect allows tap abilities for mana
    if (context.hasThousandYearElixirEffect) {
      return { canActivate: true };
    }
    
    return { canActivate: false, reason: 'Summoning sickness' };
  }

  return { canActivate: true };
}

/**
 * Parse mana symbols from oracle text
 * Returns the mana produced (e.g., '{W}', '{U}', '{G} or {U}')
 */
function parseManaProduction(text: string): string | null {
  // Match "Add {X}" or "Add {X} or {Y}" patterns
  const addMatch = text.match(/add\s+(\{[^}]+\}(?:\s+or\s+\{[^}]+\})*)/i);
  if (addMatch) {
    return addMatch[1];
  }
  
  // Match "add one mana of any color"
  if (/add\s+one\s+mana\s+of\s+any\s+color/i.test(text)) {
    return 'any color';
  }
  
  // Match "add X mana of any one color"
  const anyColorMatch = text.match(/add\s+(\w+)\s+mana\s+of\s+any\s+(?:one\s+)?color/i);
  if (anyColorMatch) {
    return `${anyColorMatch[1]} mana of any color`;
  }
  
  return null;
}

/**
 * Parse cost components from cost string
 */
function parseCostComponents(costStr: string): {
  requiresTap: boolean;
  requiresUntap: boolean;
  requiresSacrifice: boolean;
  manaCost?: string;
  lifeCost?: number;
  loyaltyCost?: number;
  otherCosts: string[];
} {
  const result = {
    requiresTap: false,
    requiresUntap: false,
    requiresSacrifice: false,
    manaCost: undefined as string | undefined,
    lifeCost: undefined as number | undefined,
    loyaltyCost: undefined as number | undefined,
    otherCosts: [] as string[],
  };

  const lowerCost = costStr.toLowerCase();
  
  // Check for tap symbol
  if (lowerCost.includes('{t}') || lowerCost === 't' || /\btap\b/i.test(costStr)) {
    result.requiresTap = true;
  }
  
  // Check for untap symbol (e.g., {Q})
  if (lowerCost.includes('{q}')) {
    result.requiresUntap = true;
  }
  
  // Check for sacrifice
  if (/\bsacrifice\b/i.test(costStr)) {
    result.requiresSacrifice = true;
  }
  
  // Extract mana cost
  const manaSymbols = costStr.match(/\{[WUBRGC0-9X\/]+\}/gi);
  if (manaSymbols) {
    // Filter out {T} and {Q}
    const manaPart = manaSymbols.filter(s => 
      s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}'
    ).join('');
    if (manaPart) {
      result.manaCost = manaPart;
    }
  }
  
  // Extract life cost
  const lifeMatch = costStr.match(/pay\s+(\d+)\s+life/i);
  if (lifeMatch) {
    result.lifeCost = parseInt(lifeMatch[1], 10);
  }
  
  // Extract loyalty cost (planeswalker abilities)
  const loyaltyMatch = costStr.match(/\[([+−\-]?\d+)\]/);
  if (loyaltyMatch) {
    result.loyaltyCost = parseInt(loyaltyMatch[1].replace('−', '-'), 10);
  }
  
  // Other costs
  const otherCostPatterns = [
    /discard\s+(?:a|an|one)\s+card/i,
    /exile\s+(?:a|an|one)\s+card/i,
    /remove\s+\d+\s+counters?/i,
    /tap\s+(?:an?|two|three)\s+untapped\s+\w+/i,
  ];
  
  for (const pattern of otherCostPatterns) {
    const match = costStr.match(pattern);
    if (match) {
      result.otherCosts.push(match[0]);
    }
  }
  
  return result;
}

/**
 * Parse activated abilities from a card's oracle text
 */
export function parseActivatedAbilities(card: KnownCardRef): ParsedActivatedAbility[] {
  const abilities: ParsedActivatedAbility[] = [];
  const oracleText = card.oracle_text || '';
  const typeLine = (card.type_line || '').toLowerCase();
  const name = card.name || '';
  const lowerOracle = oracleText.toLowerCase();
  
  let abilityIndex = 0;
  
  // ======== BASIC LAND MANA ABILITIES ========
  // Basic lands have intrinsic mana abilities based on type
  if (typeLine.includes('plains')) {
    abilities.push({
      id: `${card.id}-mana-w-${abilityIndex++}`,
      label: 'Tap for {W}',
      description: 'Add one white mana to your mana pool',
      cost: '{T}',
      effect: 'Add {W}',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      isManaAbility: true,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  if (typeLine.includes('island')) {
    abilities.push({
      id: `${card.id}-mana-u-${abilityIndex++}`,
      label: 'Tap for {U}',
      description: 'Add one blue mana to your mana pool',
      cost: '{T}',
      effect: 'Add {U}',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      isManaAbility: true,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  if (typeLine.includes('swamp')) {
    abilities.push({
      id: `${card.id}-mana-b-${abilityIndex++}`,
      label: 'Tap for {B}',
      description: 'Add one black mana to your mana pool',
      cost: '{T}',
      effect: 'Add {B}',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      isManaAbility: true,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  if (typeLine.includes('mountain')) {
    abilities.push({
      id: `${card.id}-mana-r-${abilityIndex++}`,
      label: 'Tap for {R}',
      description: 'Add one red mana to your mana pool',
      cost: '{T}',
      effect: 'Add {R}',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      isManaAbility: true,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  if (typeLine.includes('forest')) {
    abilities.push({
      id: `${card.id}-mana-g-${abilityIndex++}`,
      label: 'Tap for {G}',
      description: 'Add one green mana to your mana pool',
      cost: '{T}',
      effect: 'Add {G}',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      isManaAbility: true,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== FETCH LAND ABILITIES ========
  // Detect sacrifice + search patterns for fetch lands
  if (lowerOracle.includes('sacrifice') && lowerOracle.includes('search')) {
    const isTrueFetch = lowerOracle.includes('pay 1 life');
    
    // Determine what land types it can fetch
    let fetchDescription = 'Search your library for a land';
    let targetTypes = 'land';
    
    // Match specific land type patterns
    const landTypeMatch = oracleText.match(
      /search your library for (?:a|an) ((?:basic )?(?:(?:Forest|Plains|Island|Mountain|Swamp)(?: or (?:Forest|Plains|Island|Mountain|Swamp))*|land)) card/i
    );
    if (landTypeMatch) {
      targetTypes = landTypeMatch[1];
      fetchDescription = `Search for: ${targetTypes}`;
    }
    
    abilities.push({
      id: `${card.id}-fetch-${abilityIndex++}`,
      label: isTrueFetch ? 'Fetch Land (pay 1 life)' : 'Fetch Land',
      description: fetchDescription,
      cost: isTrueFetch ? '{T}, Pay 1 life, Sacrifice' : '{T}, Sacrifice',
      effect: `Search your library for a ${targetTypes} card`,
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: true,
      lifeCost: isTrueFetch ? 1 : undefined,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: true,
      targetDescription: targetTypes,
    });
  }
  
  // ======== PLANESWALKER LOYALTY ABILITIES ========
  if (typeLine.includes('planeswalker')) {
    // Match planeswalker ability patterns: [+N], [-N], or [0]
    const pwAbilityPattern = /\[([+−\-]?\d+)\]:\s*([^[\]]+?)(?=\n|\[|$)/gi;
    let pwMatch;
    while ((pwMatch = pwAbilityPattern.exec(oracleText)) !== null) {
      const loyaltyCostStr = pwMatch[1].replace('−', '-');
      const loyaltyCost = parseInt(loyaltyCostStr, 10);
      const abilityText = pwMatch[2].trim();
      const shortText = abilityText.length > 60 ? abilityText.slice(0, 57) + '...' : abilityText;
      
      const costLabel = loyaltyCost > 0 ? `+${loyaltyCost}` : `${loyaltyCost}`;
      
      abilities.push({
        id: `${card.id}-pw-${abilityIndex++}`,
        label: `[${costLabel}]`,
        description: shortText,
        cost: `[${costLabel}]`,
        effect: abilityText,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        loyaltyCost,
        isManaAbility: false,
        isLoyaltyAbility: true,
        isFetchAbility: false,
        timingRestriction: 'sorcery',
        oncePerTurn: true,
      });
    }
  }
  
  // ======== GENERAL ACTIVATED ABILITIES ========
  // Parse "{cost}: {effect}" patterns from oracle text
  // This regex matches activated ability patterns
  const activatedPattern = /(?:^|\n)(\{[^}:]+\}(?:,?\s*\{[^}:]+\})*(?:,?\s*[^:]+)?)\s*:\s*([^.]+(?:\.[^:]*)?)/gi;
  
  let match;
  while ((match = activatedPattern.exec(oracleText)) !== null) {
    const costPart = match[1].trim();
    const effectPart = match[2].trim();
    
    // Skip if this is already captured (basic land mana, fetch, or planeswalker)
    if (abilities.some(a => a.effect.toLowerCase().includes(effectPart.toLowerCase().slice(0, 20)))) {
      continue;
    }
    
    const costComponents = parseCostComponents(costPart);
    const manaProduced = parseManaProduction(effectPart);
    const isManaAbility = !!manaProduced && !effectPart.toLowerCase().includes('target');
    
    // Determine if this requires a target
    const requiresTarget = /\btarget\b/i.test(effectPart);
    let targetDescription: string | undefined;
    if (requiresTarget) {
      const targetMatch = effectPart.match(/target\s+([^.]+)/i);
      if (targetMatch) {
        targetDescription = targetMatch[1].trim();
      }
    }
    
    // Check for timing restrictions
    let timingRestriction: 'sorcery' | 'instant' | undefined;
    if (/activate\s+(?:this\s+ability\s+)?(?:only\s+)?(?:as\s+a\s+)?sorcery/i.test(oracleText)) {
      timingRestriction = 'sorcery';
    }
    
    // Check for once per turn
    const oncePerTurn = /activate\s+(?:this\s+ability\s+)?only\s+once\s+(?:each|per)\s+turn/i.test(oracleText);
    
    // Create a label
    let label: string;
    if (isManaAbility) {
      label = `Add ${manaProduced}`;
    } else if (costComponents.requiresSacrifice) {
      label = 'Sacrifice';
    } else if (requiresTarget) {
      label = targetDescription ? `Target ${targetDescription.split(' ').slice(0, 2).join(' ')}...` : 'Target';
    } else {
      label = effectPart.split(' ').slice(0, 3).join(' ') + (effectPart.split(' ').length > 3 ? '...' : '');
    }
    
    abilities.push({
      id: `${card.id}-ability-${abilityIndex++}`,
      label,
      description: effectPart.length > 80 ? effectPart.slice(0, 77) + '...' : effectPart,
      cost: costPart,
      effect: effectPart,
      ...costComponents,
      isManaAbility,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction,
      oncePerTurn,
      requiresTarget,
      targetDescription,
    });
  }
  
  // ======== "TAP: ADD" PATTERN (simpler mana abilities) ========
  // For artifacts and creatures with simple mana abilities not caught above
  if (!abilities.some(a => a.isManaAbility) && !typeLine.includes('land')) {
    const simpleManaMatch = oracleText.match(/\{T\}:\s*Add\s+(\{[^}]+\}(?:\s*or\s*\{[^}]+\})*)/i);
    if (simpleManaMatch) {
      abilities.push({
        id: `${card.id}-mana-${abilityIndex++}`,
        label: `Tap for mana`,
        description: `Add ${simpleManaMatch[1]}`,
        cost: '{T}',
        effect: `Add ${simpleManaMatch[1]}`,
        requiresTap: true,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: true,
        isLoyaltyAbility: false,
        isFetchAbility: false,
      });
    }
    
    // "Add one mana of any color" pattern
    if (lowerOracle.includes('{t}') && 
        (lowerOracle.includes('add one mana of any color') || 
         lowerOracle.includes('add {w}{u}{b}{r}{g}') ||
         lowerOracle.includes('any type of mana'))) {
      // Don't add if we already have a mana ability for this
      if (!abilities.some(a => a.isManaAbility)) {
        abilities.push({
          id: `${card.id}-mana-any-${abilityIndex++}`,
          label: 'Tap for any color',
          description: 'Add one mana of any color',
          cost: '{T}',
          effect: 'Add one mana of any color',
          requiresTap: true,
          requiresUntap: false,
          requiresSacrifice: false,
          isManaAbility: true,
          isLoyaltyAbility: false,
          isFetchAbility: false,
        });
      }
    }
  }
  
  // ======== EQUIP ABILITIES ========
  if (typeLine.includes('equipment')) {
    const equipMatch = oracleText.match(/equip\s*(\{[^}]+\}|\d+)/i);
    if (equipMatch) {
      const equipCost = equipMatch[1].startsWith('{') ? equipMatch[1] : `{${equipMatch[1]}}`;
      abilities.push({
        id: `${card.id}-equip-${abilityIndex++}`,
        label: `Equip ${equipCost}`,
        description: 'Attach to target creature you control',
        cost: equipCost,
        effect: 'Attach to target creature you control',
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        manaCost: equipCost,
        isManaAbility: false,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        timingRestriction: 'sorcery',
        requiresTarget: true,
        targetDescription: 'creature you control',
      });
    }
  }
  
  // ======== CYCLING ABILITIES ========
  const cyclingMatch = oracleText.match(/cycling\s*(\{[^}]+\})/i);
  if (cyclingMatch) {
    abilities.push({
      id: `${card.id}-cycling-${abilityIndex++}`,
      label: `Cycle ${cyclingMatch[1]}`,
      description: 'Discard this card: Draw a card',
      cost: cyclingMatch[1],
      effect: 'Discard this card, then draw a card',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: cyclingMatch[1],
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== THOUSAND-YEAR ELIXIR DETECTION ========
  // Special handling for cards that grant haste for tap abilities
  // This is handled separately in the context, but we note it here for completeness
  
  return abilities;
}

/**
 * Check if a card grants "haste for tap abilities" effect (like Thousand-Year Elixir)
 */
export function grantsHasteForTapAbilities(card: KnownCardRef): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  const name = (card.name || '').toLowerCase();
  
  // Thousand-Year Elixir and similar effects
  if (name.includes('thousand-year elixir')) {
    return true;
  }
  
  // Check for oracle text patterns that grant tap ability haste
  if (oracleText.includes('creatures you control') && 
      oracleText.includes('as though they had haste') &&
      oracleText.includes('tap')) {
    return true;
  }
  
  // Check for "can be activated as though this creature has haste"
  if (oracleText.includes('activated abilit') && 
      oracleText.includes('as though') &&
      oracleText.includes('haste')) {
    return true;
  }
  
  return false;
}

/**
 * Check if a permanent has the "untap" ability (like Thousand-Year Elixir)
 */
export function hasUntapAbility(card: KnownCardRef): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Check for untap ability patterns
  return /\{[^}]*\}.*:.*untap\s+(?:target\s+)?creature/i.test(oracleText) ||
         /untap\s+target\s+creature/i.test(oracleText);
}

/**
 * Get ability icon based on ability type
 */
export function getAbilityIcon(ability: ParsedActivatedAbility): string {
  if (ability.isManaAbility) return '💎';
  if (ability.isFetchAbility) return '🔍';
  if (ability.isLoyaltyAbility) {
    if (ability.loyaltyCost && ability.loyaltyCost > 0) return '⬆️';
    if (ability.loyaltyCost && ability.loyaltyCost < 0) return '⬇️';
    return '🔄';
  }
  if (ability.requiresSacrifice) return '💀';
  if (ability.requiresTap) return '↪️';
  if (ability.requiresTarget) return '🎯';
  return '✨';
}

/**
 * Format ability cost for display
 */
export function formatAbilityCost(ability: ParsedActivatedAbility): string {
  const parts: string[] = [];
  
  if (ability.manaCost) {
    parts.push(ability.manaCost);
  }
  if (ability.requiresTap) {
    parts.push('{T}');
  }
  if (ability.requiresUntap) {
    parts.push('{Q}');
  }
  if (ability.lifeCost) {
    parts.push(`Pay ${ability.lifeCost} life`);
  }
  if (ability.requiresSacrifice) {
    parts.push('Sacrifice');
  }
  if (ability.loyaltyCost !== undefined) {
    parts.push(ability.loyaltyCost > 0 ? `+${ability.loyaltyCost}` : `${ability.loyaltyCost}`);
  }
  if (ability.otherCosts) {
    parts.push(...ability.otherCosts);
  }
  
  return parts.join(', ') || 'Free';
}
