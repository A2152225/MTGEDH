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
import { parseSacrificeCost, parseNumberFromText, type SacrificeType } from '../../../shared/src/textUtils';

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
  sacrificeType?: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self' | 'artifact_or_creature';  // What to sacrifice
  sacrificeCount?: number;  // How many to sacrifice (default 1)
  mustBeOther?: boolean;  // Whether sacrifice must be "other" permanents (not the source)
  manaCost?: string;
  lifeCost?: number;
  loyaltyCost?: number;  // For planeswalker abilities
  otherCosts?: string[];
  // X cost support
  hasXCost?: boolean;  // Whether the cost contains {X}
  xCount?: number;  // Number of X symbols in cost (e.g., {X}{X} = 2)
  // Tap other permanents cost (e.g., "Tap an untapped Merfolk you control")
  tapOtherPermanentsCost?: TapOtherPermanentsCost;
  // Ability characteristics
  isManaAbility: boolean;
  isLoyaltyAbility: boolean;
  isFetchAbility: boolean;
  isMillAbility?: boolean;  // Mill abilities (target player mills cards)
  isCrewAbility?: boolean;  // Crew abilities for vehicles
  isStationAbility?: boolean;  // Station abilities for spacecraft
  crewPower?: number;  // Power required to crew
  stationThreshold?: number;  // Charge counters needed to become creature
  // Activation restrictions
  timingRestriction?: 'sorcery' | 'instant';
  oncePerTurn?: boolean;
  // For targeting
  requiresTarget?: boolean;
  targetDescription?: string;
  // Mill specific
  millCount?: number;  // Number of cards to mill
  millTargetType?: 'player' | 'self' | 'opponent' | 'any';  // Who mills
}

/**
 * Represents a cost that requires tapping other permanents
 * (e.g., Drowner of Secrets: "Tap an untapped Merfolk you control")
 */
export interface TapOtherPermanentsCost {
  count: number;  // How many permanents to tap (1, 2, etc.)
  filter: {
    types?: string[];  // Required types (e.g., ['Merfolk', 'creature'])
    controller?: 'you' | 'any';  // Who controls the permanents
    mustBeUntapped?: boolean;  // Must be untapped (always true for tap costs)
    notSelf?: boolean;  // Cannot be the source permanent itself ("another")
  };
  description: string;  // Human-readable description
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
 * Parse mill effects from oracle text
 * Returns mill count and target type if this is a mill ability
 * 
 * Patterns matched:
 * - "Target player mills X cards" / "target player puts the top X cards of their library into their graveyard"
 * - "Each player mills X cards"
 * - "Target opponent mills X cards"
 * - "Mill X cards" (self-mill)
 * - "You mill X cards"
 */
function parseMillEffect(effectText: string): { 
  isMillAbility: boolean; 
  millCount?: number; 
  millTargetType?: 'player' | 'self' | 'opponent' | 'any';
} | null {
  const lower = effectText.toLowerCase();
  
  // Pattern: "target player mills X cards" or "target player puts the top X cards...into...graveyard"
  const targetPlayerMillMatch = lower.match(/target\s+player\s+(?:mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)|puts?\s+the\s+top\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?\s+.*(?:into|in)\s+(?:their|his or her)\s+graveyard)/i);
  if (targetPlayerMillMatch) {
    const numStr = targetPlayerMillMatch[1] || targetPlayerMillMatch[2];
    const count = parseNumberFromText(numStr);
    return { isMillAbility: true, millCount: count, millTargetType: 'player' };
  }
  
  // Pattern: "target opponent mills X cards"
  const targetOpponentMillMatch = lower.match(/target\s+opponent\s+mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  if (targetOpponentMillMatch) {
    const numStr = targetOpponentMillMatch[1];
    const count = parseNumberFromText(numStr);
    return { isMillAbility: true, millCount: count, millTargetType: 'opponent' };
  }
  
  // Pattern: "each player mills X cards" or "each opponent mills X cards"
  const eachPlayerMillMatch = lower.match(/each\s+(?:player|opponent)\s+mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
  if (eachPlayerMillMatch) {
    const numStr = eachPlayerMillMatch[1];
    const count = parseNumberFromText(numStr);
    const targetType = lower.includes('each opponent') ? 'opponent' : 'any';
    return { isMillAbility: true, millCount: count, millTargetType: targetType };
  }
  
  // Pattern: self mill - "mill X cards" without target, or "you mill X cards"
  const selfMillMatch = lower.match(/(?:^|\.\s*|,\s*)(?:you\s+)?mills?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?/i);
  if (selfMillMatch && !lower.includes('target')) {
    const numStr = selfMillMatch[1];
    const count = parseNumberFromText(numStr);
    return { isMillAbility: true, millCount: count, millTargetType: 'self' };
  }
  
  return null;
}

/**
 * Check if a cost string indicates tapping the source permanent (vs. tapping other permanents)
 * 
 * Returns true for:
 * - {T} symbol
 * - "T" alone
 * 
 * Returns false for:
 * - "Tap an untapped [Type]" - this is tapping other permanents
 * - "Tap another" - this is tapping other permanents
 */
function isSelfTapCost(costStr: string): boolean {
  const lower = costStr.toLowerCase();
  
  // These patterns indicate tapping OTHER permanents, not self
  if (lower.includes('tap an untapped') || lower.includes('tap another')) {
    return false;
  }
  
  // Check for tap symbol
  return lower.includes('{t}') || lower === 't';
}

/**
 * Parse cost components from cost string
 */
function parseCostComponents(costStr: string): {
  requiresTap: boolean;
  requiresUntap: boolean;
  requiresSacrifice: boolean;
  sacrificeType?: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self' | 'artifact_or_creature';
  sacrificeCount?: number;
  manaCost?: string;
  lifeCost?: number;
  loyaltyCost?: number;
  otherCosts: string[];
  tapOtherPermanentsCost?: TapOtherPermanentsCost;
  hasXCost?: boolean;
  xCount?: number;
  mustBeOther?: boolean;
} {
  const result: {
    requiresTap: boolean;
    requiresUntap: boolean;
    requiresSacrifice: boolean;
    sacrificeType?: 'creature' | 'artifact' | 'enchantment' | 'land' | 'permanent' | 'self' | 'artifact_or_creature';
    sacrificeCount?: number;
    manaCost?: string;
    lifeCost?: number;
    loyaltyCost?: number;
    otherCosts: string[];
    tapOtherPermanentsCost?: TapOtherPermanentsCost;
    hasXCost?: boolean;
    xCount?: number;
    mustBeOther?: boolean;
  } = {
    requiresTap: false,
    requiresUntap: false,
    requiresSacrifice: false,
    sacrificeType: undefined,
    sacrificeCount: undefined,
    manaCost: undefined,
    lifeCost: undefined,
    loyaltyCost: undefined,
    otherCosts: [],
    tapOtherPermanentsCost: undefined,
    hasXCost: false,
    xCount: 0,
    mustBeOther: false,
  };

  const lowerCost = costStr.toLowerCase();
  
  // Check for self-tap cost using the helper function
  if (isSelfTapCost(costStr)) {
    result.requiresTap = true;
  }
  
  // Check for untap symbol (e.g., {Q})
  if (lowerCost.includes('{q}')) {
    result.requiresUntap = true;
  }
  
  // Check for sacrifice and parse what type using shared utility
  const sacrificeInfo = parseSacrificeCost(costStr);
  if (sacrificeInfo.requiresSacrifice) {
    result.requiresSacrifice = true;
    result.sacrificeType = sacrificeInfo.sacrificeType;
    result.sacrificeCount = sacrificeInfo.sacrificeCount;
    result.mustBeOther = sacrificeInfo.mustBeOther;
  }
  
  // Extract mana cost (including Phyrexian mana symbols like {W/P}, {U/P}, etc.)
  const manaSymbols = costStr.match(/\{[WUBRGC0-9X\/P]+\}/gi);
  if (manaSymbols) {
    // Filter out {T} and {Q}
    const manaPart = manaSymbols.filter(s => 
      s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}'
    ).join('');
    if (manaPart) {
      result.manaCost = manaPart;
      
      // Check for X in mana cost
      const xMatches = manaPart.match(/\{X\}/gi);
      if (xMatches) {
        result.hasXCost = true;
        result.xCount = xMatches.length;
      }
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
  
  // Parse tap-other-permanents cost (e.g., "Tap an untapped Merfolk you control")
  // Patterns:
  // - "Tap an untapped [Type] you control"
  // - "Tap another untapped [Type] you control"
  // - "Tap two untapped [Types] you control"
  const tapOtherMatch = costStr.match(/tap\s+(an(?:other)?|two|three|\d+)\s+untapped\s+([^:,]+?)(?:\s+you\s+control)?(?::|,|$)/i);
  if (tapOtherMatch) {
    const countWord = tapOtherMatch[1].toLowerCase();
    let count = 1;
    if (countWord === 'two') count = 2;
    else if (countWord === 'three') count = 3;
    else if (/^\d+$/.test(countWord)) count = parseInt(countWord, 10);
    
    const typeStr = tapOtherMatch[2].trim();
    const types = typeStr.split(/\s+/).filter(t => t.length > 0);
    const notSelf = countWord === 'another' || lowerCost.includes('another');
    
    result.tapOtherPermanentsCost = {
      count,
      filter: {
        types,
        controller: 'you',
        mustBeUntapped: true,
        notSelf,
      },
      description: tapOtherMatch[0].trim(),
    };
  }
  
  // Other costs
  const otherCostPatterns = [
    /discard\s+(?:a|an|one)\s+card/i,
    /exile\s+(?:a|an|one)\s+card/i,
    /remove\s+\d+\s+counters?/i,
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
    // Match planeswalker ability patterns: +N:, -N:, or 0: at start of line
    // Scryfall oracle text uses plain format without brackets (e.g., "+1: Effect text")
    // The pattern matches various dash characters: regular minus (-), en dash (–), em dash (—), and Unicode minus (−)
    const pwAbilityPattern = /^([+−–—-]?\d+):\s*(.+)/gm;
    let pwMatch;
    while ((pwMatch = pwAbilityPattern.exec(oracleText)) !== null) {
      const loyaltyCostStr = pwMatch[1].replace(/[−–—]/g, '-');
      const loyaltyCost = parseInt(loyaltyCostStr, 10);
      const abilityText = pwMatch[2].trim();
      const shortText = abilityText.length > 60 ? abilityText.slice(0, 57) + '...' : abilityText;
      
      const costLabel = loyaltyCost > 0 ? `+${loyaltyCost}` : `${loyaltyCost}`;
      
      abilities.push({
        id: `pw-ability-${abilityIndex++}`,
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
  // Parse "{cost}, {cost}: {effect}" patterns from oracle text
  // Standard MTG activated ability format: costs separated by commas, then colon, then effect
  // Examples:
  // - "{4}, {T}: Target creature can't be blocked this turn." (Rogue's Passage)
  // - "{T}: Add {C}." (Wastes)
  // - "{2}, {T}, Sacrifice CARDNAME: Draw two cards." (common)
  // The pattern looks for text starting with { that contains : followed by effect text
  
  // Pre-compile regex patterns for performance
  const activatedAbilityPattern = /^(\{[^}]+\}(?:,?\s*\{[^}]+\})*(?:,?\s*(?:Sacrifice[^:]*|Pay[^:]*|Discard[^:]*|Exile[^:]*|Remove[^:]*|Tap[^:]*|Untap[^:]*))?)\s*:\s*(.+)$/i;
  const triggeredAbilityPattern = /^(when|whenever|at)\b/i;
  
  // Split oracle text by newlines and process each line/sentence
  const sentences = oracleText.split(/\n/);
  for (const sentence of sentences) {
    // Match pattern: starts with mana/tap costs, followed by colon, then effect
    // This pattern captures: {cost}{cost}... or {cost}, {cost}, ... : effect
    const abilityMatch = sentence.match(activatedAbilityPattern);
    
    if (abilityMatch) {
      const costPart = abilityMatch[1].trim();
      const effectPart = abilityMatch[2].trim();
      
      // Skip if cost is empty or just whitespace
      if (!costPart) continue;
      
      // Skip if this looks like a triggered ability (starts with "when", "whenever", "at")
      if (triggeredAbilityPattern.test(effectPart)) continue;
      
      // Skip Channel abilities - these can only be activated from hand, not battlefield
      // Channel format: "Channel — {cost}, Discard this card: effect"
      // The ability cost will contain "Discard this card" or "Discard CARDNAME"
      const costLower = costPart.toLowerCase();
      if (costLower.includes('discard this card') || 
          costLower.includes('discard ' + name.toLowerCase()) ||
          sentence.toLowerCase().includes('channel —') ||
          sentence.toLowerCase().includes('channel -')) {
        continue;
      }
      
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
      
      // Check for timing restrictions in the full oracle text
      let timingRestriction: 'sorcery' | 'instant' | undefined;
      if (/activate\s+(?:this\s+ability\s+)?(?:only\s+)?(?:as\s+a\s+)?sorcery/i.test(oracleText)) {
        timingRestriction = 'sorcery';
      }
      
      // Check for once per turn
      const oncePerTurn = /activate\s+(?:this\s+ability\s+)?only\s+once\s+(?:each|per)\s+turn/i.test(oracleText);
      
      // Check for mill effect
      const millEffect = parseMillEffect(effectPart);
      const isMillAbility = millEffect?.isMillAbility || false;
      const millCount = millEffect?.millCount;
      const millTargetType = millEffect?.millTargetType;
      
      // Create a label - make it more descriptive
      let label: string;
      if (isManaAbility) {
        label = `Add ${manaProduced}`;
      } else if (isMillAbility && millCount) {
        // Mill ability label
        const targetStr = millTargetType === 'self' ? '' : 
                         millTargetType === 'opponent' ? 'opponent ' : 
                         millTargetType === 'player' ? 'target player ' : '';
        label = `Mill ${millCount} (${targetStr || 'self'})`;
      } else if (costComponents.requiresSacrifice) {
        // Try to get a better label from the effect
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = 'Sacrifice: ' + shortEffect.split(' ').slice(0, 2).join(' ') + '...';
        }
      } else if (requiresTarget) {
        // For targeting abilities, show what it does
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = targetDescription 
            ? `Target ${targetDescription.split(' ').slice(0, 2).join(' ')}...` 
            : 'Target';
        }
      } else {
        // Get first sentence or first few words
        const shortEffect = effectPart.split('.')[0];
        if (shortEffect.length <= 30) {
          label = shortEffect;
        } else {
          label = effectPart.split(' ').slice(0, 4).join(' ') + '...';
        }
      }
      
      abilities.push({
        id: `${card.id}-ability-${abilityIndex++}`,
        label,
        description: effectPart.length > 100 ? effectPart.slice(0, 97) + '...' : effectPart,
        cost: costPart,
        effect: effectPart,
        ...costComponents,
        isManaAbility,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        isMillAbility,
        millCount,
        millTargetType,
        timingRestriction,
        oncePerTurn,
        requiresTarget,
        targetDescription,
      });
    }
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
  // Equipment can have multiple equip abilities:
  // - "Equip {7}" - standard equip cost
  // - "Equip legendary creature {3}" - conditional equip with cheaper cost
  // - "Equip Knight {1}" - tribal equip
  if (typeLine.includes('equipment')) {
    // Pattern to match all equip abilities, including conditional ones
    // Examples: "Equip {7}", "Equip legendary creature {3}", "Equip Knight {1}", "Equip Soldier {2}"
    const equipRegex = /equip(?:\s+([a-z]+(?:\s+[a-z]+)?))?(?:\s+creature)?\s*(\{[^}]+\}(?:\{[^}]+\})*|\d+)/gi;
    let equipMatch;
    
    while ((equipMatch = equipRegex.exec(oracleText)) !== null) {
      const conditionalType = equipMatch[1]?.trim(); // "legendary", "Knight", "Soldier", etc.
      const costRaw = equipMatch[2];
      const equipCost = costRaw.startsWith('{') ? costRaw : `{${costRaw}}`;
      
      // Build label based on whether it's conditional
      let label = `Equip ${equipCost}`;
      let targetDescription = 'creature you control';
      
      if (conditionalType) {
        // Conditional equip - cheaper cost but restricted target
        label = `Equip ${conditionalType} ${equipCost}`;
        targetDescription = `${conditionalType} creature you control`;
      }
      
      abilities.push({
        id: `${card.id}-equip-${abilityIndex++}`,
        label,
        description: `Attach to target ${targetDescription}`,
        cost: equipCost,
        effect: `Attach to target ${targetDescription}`,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        manaCost: equipCost,
        isManaAbility: false,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        timingRestriction: 'sorcery',
        requiresTarget: true,
        targetDescription,
      });
    }
  }
  
  // ======== RECONFIGURE ABILITIES ========
  // Reconfigure [cost] - Equipment with reconfigure can attach/unattach at sorcery speed
  // When attached, it's not a creature. When unattached, it's a creature.
  // Check for reconfigure keyword in oracle text and Equipment in type line
  const reconfigureMatch = oracleText.match(/reconfigure\s*(\{[^}]+\}|\d+)/i);
  if (reconfigureMatch && typeLine.includes('equipment')) {
    const reconfigureCost = reconfigureMatch[1].startsWith('{') ? reconfigureMatch[1] : `{${reconfigureMatch[1]}}`;
    
    // Two abilities: attach and unattach
    // Attach ability
    abilities.push({
      id: `${card.id}-reconfigure-attach-${abilityIndex++}`,
      label: `Reconfigure ${reconfigureCost} (Attach)`,
      description: 'Attach to target creature you control (stops being a creature)',
      cost: reconfigureCost,
      effect: 'Attach to target creature you control',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: reconfigureCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery',
      requiresTarget: true,
      targetDescription: 'creature you control',
    });
    
    // Unattach ability
    abilities.push({
      id: `${card.id}-reconfigure-unattach-${abilityIndex++}`,
      label: `Reconfigure ${reconfigureCost} (Unattach)`,
      description: 'Unattach (becomes a creature again)',
      cost: reconfigureCost,
      effect: 'Unattach this Equipment',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: reconfigureCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery',
      requiresTarget: false,
    });
  }
  
  // ======== CREW ABILITIES (Vehicles) ========
  // Crew N: Tap any number of creatures you control with total power N or more
  if (typeLine.includes('vehicle')) {
    const crewMatch = oracleText.match(/crew\s*(\d+)/i);
    if (crewMatch) {
      const crewPower = parseInt(crewMatch[1], 10);
      abilities.push({
        id: `${card.id}-crew-${abilityIndex++}`,
        label: `Crew ${crewPower}`,
        description: `Tap creatures with total power ${crewPower}+ to make this a creature`,
        cost: '',
        effect: `This Vehicle becomes an artifact creature until end of turn`,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: false,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        isCrewAbility: true,
        crewPower,
        timingRestriction: undefined, // Can crew at instant speed
      });
    }
  }
  
  // ======== STATION ABILITIES (Spacecraft) ========
  // Station N (Rule 702.184a): Tap another untapped creature you control: Put charge counters
  // equal to that creature's power on this permanent
  if (typeLine.includes('spacecraft') || lowerOracle.includes('station')) {
    const stationMatch = oracleText.match(/station\s*(\d+)/i);
    if (stationMatch) {
      const stationThreshold = parseInt(stationMatch[1], 10);
      abilities.push({
        id: `${card.id}-station-${abilityIndex++}`,
        label: `Station ${stationThreshold}`,
        description: `Tap a creature to add counters equal to its power. Creature at ${stationThreshold}+ counters.`,
        cost: 'Tap another creature',
        effect: `Tap another untapped creature: Put charge counters on this equal to that creature's power. Becomes a creature at ${stationThreshold}+ counters.`,
        requiresTap: false,
        requiresUntap: false,
        requiresSacrifice: false,
        isManaAbility: false,
        isLoyaltyAbility: false,
        isFetchAbility: false,
        isStationAbility: true,
        stationThreshold,
        timingRestriction: 'sorcery', // Station is sorcery speed (Rule 702.184a)
      });
    }
  }
  
  // ======== LEVEL UP ABILITIES (Rule 702.87) ========
  // "Level up [cost]" means "[Cost]: Put a level counter on this permanent. Activate only as a sorcery."
  const levelUpMatch = oracleText.match(/level\s+up\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (levelUpMatch) {
    const levelUpCost = levelUpMatch[1];
    abilities.push({
      id: `${card.id}-level-up-${abilityIndex++}`,
      label: `Level Up ${levelUpCost}`,
      description: 'Put a level counter on this permanent (sorcery speed)',
      cost: levelUpCost,
      effect: 'Put a level counter on this permanent',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: levelUpCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery', // Level up is sorcery speed only
    });
  }
  
  // ======== OUTLAST ABILITIES (Rule 702.107) ========
  // "Outlast [cost]" means "[Cost], {T}: Put a +1/+1 counter on this creature. Activate only as a sorcery."
  // Example oracle text: "Outlast {W} ({W}, {T}: Put a +1/+1 counter on this creature. Outlast only as a sorcery.)"
  const outlastMatch = oracleText.match(/outlast\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (outlastMatch) {
    const outlastCost = outlastMatch[1];
    abilities.push({
      id: `${card.id}-outlast-${abilityIndex++}`,
      label: `Outlast ${outlastCost}`,
      description: 'Put a +1/+1 counter on this creature (sorcery speed, tap)',
      cost: `${outlastCost}, {T}`,
      effect: 'Put a +1/+1 counter on this creature',
      requiresTap: true,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: outlastCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery', // Outlast is sorcery speed only (Rule 702.107a)
    });
  }
  
  // ======== BOAST ABILITIES (Rule 702.142) ========
  // "Boast — [Cost]: [Effect]" - Activate only if creature attacked this turn and only once each turn
  // Example: "Boast — {1}{R}: Create a Treasure token."
  const boastMatch = oracleText.match(/boast\s*[—-]\s*(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*([^.]+)/i);
  if (boastMatch) {
    const boastCost = boastMatch[1];
    const boastEffect = boastMatch[2].trim();
    abilities.push({
      id: `${card.id}-boast-${abilityIndex++}`,
      label: `Boast ${boastCost}`,
      description: `${boastEffect} (only if attacked this turn, once per turn)`,
      cost: boastCost,
      effect: boastEffect,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: boastCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      oncePerTurn: true,
    });
  }
  
  // ======== MONSTROSITY ABILITIES (Rule 702.94) ========
  // "{cost}: Monstrosity N" - Put N +1/+1 counters on this creature (if not monstrous)
  // Example: "Monstrosity 3" or "{5}{G}{G}: Monstrosity 3"
  const monstrosityMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*monstrosity\s+(\d+)/i);
  if (monstrosityMatch) {
    const monstrosityCost = monstrosityMatch[1];
    const monstrosityN = parseInt(monstrosityMatch[2], 10);
    abilities.push({
      id: `${card.id}-monstrosity-${abilityIndex++}`,
      label: `Monstrosity ${monstrosityN}`,
      description: `Put ${monstrosityN} +1/+1 counter${monstrosityN !== 1 ? 's' : ''} on ${name} (can only be activated if not monstrous)`,
      cost: monstrosityCost,
      effect: `Put ${monstrosityN} +1/+1 counter${monstrosityN !== 1 ? 's' : ''} on this creature. It becomes monstrous.`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: monstrosityCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== ADAPT ABILITIES (Rule 702.140) ========
  // "{cost}: Adapt N" - Put N +1/+1 counters if no +1/+1 counters on it
  // Example: "{1}{G}{U}: Adapt 2"
  const adaptMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*adapt\s+(\d+)/i);
  if (adaptMatch) {
    const adaptCost = adaptMatch[1];
    const adaptN = parseInt(adaptMatch[2], 10);
    abilities.push({
      id: `${card.id}-adapt-${abilityIndex++}`,
      label: `Adapt ${adaptN}`,
      description: `Put ${adaptN} +1/+1 counter${adaptN !== 1 ? 's' : ''} on ${name} (only if it has no +1/+1 counters)`,
      cost: adaptCost,
      effect: `Put ${adaptN} +1/+1 counter${adaptN !== 1 ? 's' : ''} on this creature if it has no +1/+1 counters on it.`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: adaptCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== FORTIFY ABILITIES (Rule 702.67) ========
  // "Fortify {cost}" - Attach Fortification to target land you control (sorcery speed)
  // Example: "Fortify {3}"
  const fortifyMatch = oracleText.match(/fortify\s+(\{[^}]+\}(?:\{[^}]+\})*)/i);
  if (fortifyMatch && typeLine.toLowerCase().includes('fortification')) {
    const fortifyCost = fortifyMatch[1];
    abilities.push({
      id: `${card.id}-fortify-${abilityIndex++}`,
      label: `Fortify ${fortifyCost}`,
      description: 'Attach to target land you control (sorcery speed)',
      cost: fortifyCost,
      effect: 'Attach this Fortification to target land you control',
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: false,
      manaCost: fortifyCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      timingRestriction: 'sorcery',
      requiresTarget: true,
      targetDescription: 'land you control',
    });
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
  
  // ======== DOMINUS INDESTRUCTIBLE COUNTER ABILITIES ========
  // Pattern: "{mana}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on [CARDNAME]."
  // This handles Mondrak, Glory Dominus and similar Phyrexian Dominus cards
  // These abilities have Phyrexian mana symbols like {W/P} which can be paid with life
  // 
  // Regex breakdown:
  //   (\{[^}]+\}(?:\{[^}]+\})*) - Capture mana cost (one or more mana symbols)
  //   ,?\s*                      - Optional comma and whitespace
  //   sacrifice\s+               - "sacrifice" keyword
  //   (two|three|\d+)            - Count word or number
  //   \s+other\s+                - "other" keyword (required for these abilities)
  //   (artifacts?...)            - Type combination (artifact and/or creature variants)
  //   :\s*put\s+an?\s+           - Colon separator and "put a/an"
  //   indestructible\s+counter   - The effect being detected
  const dominusMatch = oracleText.match(
    /(\{[^}]+\}(?:\{[^}]+\})*),?\s*sacrifice\s+(two|three|\d+)\s+other\s+(artifacts?\s+and\/or\s+creatures?|creatures?\s+and\/or\s+artifacts?):\s*put\s+an?\s+indestructible\s+counter/i
  );
  if (dominusMatch) {
    const manaCost = dominusMatch[1];
    const sacrificeCountStr = dominusMatch[2];
    const sacrificeCount = parseNumberFromText(sacrificeCountStr);
    
    abilities.push({
      id: `${card.id}-dominus-indestructible-${abilityIndex++}`,
      label: `Indestructible (${manaCost})`,
      description: `Pay ${manaCost} and sacrifice ${sacrificeCount} other artifacts and/or creatures to put an indestructible counter on ${name}`,
      cost: `${manaCost}, Sacrifice ${sacrificeCount} other artifacts and/or creatures`,
      effect: `Put an indestructible counter on ${name}`,
      requiresTap: false,
      requiresUntap: false,
      requiresSacrifice: true,
      sacrificeType: 'artifact_or_creature',
      sacrificeCount,
      mustBeOther: true,
      manaCost,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
    });
  }
  
  // ======== THOUSAND-YEAR ELIXIR DETECTION ========
  // Special handling for cards that grant haste for tap abilities
  // This is handled separately in the context, but we note it here for completeness
  
  // ======== GENERIC ACTIVATED ABILITIES ========
  // Parse any remaining "cost: effect" patterns that weren't caught by specific parsers
  // This handles cards like Mite Overseer with token creation abilities
  // Pattern: {cost}{cost}...: effect text
  // Must contain at least one mana symbol or "{T}" and have an effect
  const genericAbilityPattern = /(\{[^}]+\}(?:\{[^}]+\})*)\s*:\s*([^.]+(?:\.[^.]*)?)/gi;
  let genericMatch;
  while ((genericMatch = genericAbilityPattern.exec(oracleText)) !== null) {
    const cost = genericMatch[1].trim();
    const effect = genericMatch[2].trim();
    
    // Skip if we already have this ability parsed (by checking similar effect text)
    const alreadyParsed = abilities.some(a => 
      a.effect.toLowerCase().includes(effect.toLowerCase().slice(0, 30)) ||
      (a.cost.toLowerCase() === cost.toLowerCase() && a.isManaAbility)
    );
    if (alreadyParsed) continue;
    
    // Skip mana abilities (already handled)
    const effectLower = effect.toLowerCase();
    if (/^add\s+\{[wubrgc]\}/i.test(effect) || /^add\s+(one|two|three|\d+)\s+mana/i.test(effect)) {
      continue;
    }
    
    // Skip if it's a keyword ability definition (not an activated ability)
    if (/^\([^)]+\)$/.test(effect)) continue;
    
    // Parse costs
    const requiresTap = /\{t\}/i.test(cost);
    const requiresUntap = /\{q\}/i.test(cost);
    const manaSymbolsMatch = cost.match(/\{[WUBRGC0-9X\/P]+\}/gi);
    const manaOnly = manaSymbolsMatch
      ? manaSymbolsMatch.filter(s => s.toUpperCase() !== '{T}' && s.toUpperCase() !== '{Q}').join('')
      : '';
    
    // Parse sacrifice from cost
    const sacrificeInfo = parseSacrificeCost(cost);
    
    // Check for life payment in cost
    const lifeCostMatch = cost.match(/pay\s+(\d+)\s+life/i);
    const lifeCost = lifeCostMatch ? parseInt(lifeCostMatch[1], 10) : undefined;
    
    // Check for X in cost
    const hasXCost = /\{x\}/i.test(cost);
    const xCount = hasXCost ? (cost.match(/\{x\}/gi) || []).length : 0;
    
    // Build ability ID based on effect type
    let abilityType = 'ability';
    if (effectLower.includes('create') && effectLower.includes('token')) {
      abilityType = 'token';
    } else if (effectLower.includes('deal') && effectLower.includes('damage')) {
      abilityType = 'damage';
    } else if (effectLower.includes('draw')) {
      abilityType = 'draw';
    } else if (effectLower.includes('counter')) {
      abilityType = 'counter';
    } else if (effectLower.includes('search')) {
      abilityType = 'search';
    }
    
    // Create short label
    let label = `${cost}: ...`;
    if (effectLower.includes('create') && effectLower.includes('token')) {
      const tokenMatch = effect.match(/create\s+(?:a\s+)?(\d+\/\d+\s+)?[^.]+\s+token/i);
      if (tokenMatch) {
        label = `${cost}: Create token`;
      }
    } else if (effect.length <= 50) {
      label = `${cost}: ${effect}`;
    }
    
    abilities.push({
      id: `${card.id}-${abilityType}-${abilityIndex++}`,
      label,
      description: effect,
      cost,
      effect,
      requiresTap,
      requiresUntap,
      requiresSacrifice: sacrificeInfo.requiresSacrifice,
      sacrificeType: sacrificeInfo.sacrificeType,
      sacrificeCount: sacrificeInfo.sacrificeCount,
      mustBeOther: sacrificeInfo.mustBeOther,
      manaCost: manaOnly || undefined,
      lifeCost,
      hasXCost: hasXCost || undefined,
      xCount: xCount > 0 ? xCount : undefined,
      isManaAbility: false,
      isLoyaltyAbility: false,
      isFetchAbility: false,
      requiresTarget: effectLower.includes('target'),
      targetDescription: effectLower.includes('target') ? effect : undefined,
    });
  }
  
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
  if (oracleText.includes('activated abilities') && 
      oracleText.includes('as though') &&
      oracleText.includes('haste')) {
    return true;
  }
  
  // Also check for singular form
  if (oracleText.includes('activated ability') && 
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
  if (ability.isMillAbility) return '📚';  // Mill icon (books/library)
  if (ability.isLoyaltyAbility) {
    if (ability.loyaltyCost && ability.loyaltyCost > 0) return '⬆️';
    if (ability.loyaltyCost && ability.loyaltyCost < 0) return '⬇️';
    return '🔄';
  }
  if (ability.requiresSacrifice) return '💀';
  if (ability.tapOtherPermanentsCost) return '👆';  // Tap other permanents
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
  if (ability.tapOtherPermanentsCost) {
    parts.push(ability.tapOtherPermanentsCost.description);
  }
  if (ability.otherCosts) {
    parts.push(...ability.otherCosts);
  }
  
  return parts.join(', ') || 'Free';
}
