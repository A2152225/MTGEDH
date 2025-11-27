/**
 * Rule 602: Activating Activated Abilities
 * 
 * Activated abilities follow a process similar to casting spells.
 * Format: [Cost]: [Effect]. [Activation instructions (if any).]
 * 
 * Based on MagicCompRules 20251114.txt
 */

import type { ManaPool, ManaCost } from './types/mana';
import type { Cost } from './types/costs';
import type { StackObject } from './spellCasting';
import { payManaCost } from './spellCasting';

/**
 * Rule 602: Activated ability structure
 */
export interface ActivatedAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly manaCost?: ManaCost;
  readonly additionalCosts?: readonly Cost[];
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly restrictions?: ActivationRestriction[];
  readonly isManaAbility?: boolean;
  readonly isLoyaltyAbility?: boolean;
}

/**
 * Activation restrictions (Rule 602.5)
 */
export interface ActivationRestriction {
  readonly type: 'timing' | 'frequency' | 'condition';
  readonly description: string;
  readonly requiresSorceryTiming?: boolean;
  readonly maxPerTurn?: number;
  readonly requiresCombat?: boolean;
  readonly requiresOwnTurn?: boolean;
}

/**
 * Context for validating activation
 */
export interface ActivationContext {
  readonly hasPriority: boolean;
  readonly isMainPhase: boolean;
  readonly isOwnTurn: boolean;
  readonly stackEmpty: boolean;
  readonly isCombat: boolean;
  readonly activationsThisTurn: number;
  readonly sourceTapped: boolean;
}

/**
 * Result of ability activation
 */
export interface ActivationResult {
  readonly success: boolean;
  readonly error?: string;
  readonly stackObjectId?: string;
  readonly manaPoolAfter?: ManaPool;
  readonly log?: readonly string[];
}

/**
 * Rule 602.5: Validate activation restrictions
 */
export function validateActivationRestrictions(
  restrictions: readonly ActivationRestriction[] | undefined,
  context: ActivationContext
): { valid: boolean; reason?: string } {
  if (!restrictions || restrictions.length === 0) {
    return { valid: true };
  }
  
  for (const restriction of restrictions) {
    // Sorcery timing restriction
    if (restriction.requiresSorceryTiming) {
      if (!context.hasPriority) {
        return { valid: false, reason: 'You do not have priority' };
      }
      if (!context.isMainPhase) {
        return { valid: false, reason: 'Can only activate during main phase' };
      }
      if (!context.isOwnTurn) {
        return { valid: false, reason: 'Can only activate during your turn' };
      }
      if (!context.stackEmpty) {
        return { valid: false, reason: 'Can only activate when stack is empty' };
      }
    }
    
    // Combat restriction
    if (restriction.requiresCombat && !context.isCombat) {
      return { valid: false, reason: 'Can only activate during combat' };
    }
    
    // Own turn restriction
    if (restriction.requiresOwnTurn && !context.isOwnTurn) {
      return { valid: false, reason: 'Can only activate during your turn' };
    }
    
    // Frequency restriction
    if (restriction.maxPerTurn !== undefined) {
      if (context.activationsThisTurn >= restriction.maxPerTurn) {
        return {
          valid: false,
          reason: `Already activated ${restriction.maxPerTurn} time(s) this turn`,
        };
      }
    }
  }
  
  return { valid: true };
}

/**
 * Rule 602.5b: Loyalty abilities have special restrictions
 */
export function validateLoyaltyAbility(
  ability: ActivatedAbility,
  context: ActivationContext
): { valid: boolean; reason?: string } {
  if (!ability.isLoyaltyAbility) {
    return { valid: true };
  }
  
  // Loyalty abilities: main phase, stack empty, once per turn
  if (!context.hasPriority) {
    return { valid: false, reason: 'You do not have priority' };
  }
  if (!context.isMainPhase) {
    return { valid: false, reason: 'Loyalty abilities only during main phase' };
  }
  if (!context.isOwnTurn) {
    return { valid: false, reason: 'Loyalty abilities only during your turn' };
  }
  if (!context.stackEmpty) {
    return { valid: false, reason: 'Loyalty abilities only when stack is empty' };
  }
  if (context.activationsThisTurn > 0) {
    return { valid: false, reason: 'Already activated a loyalty ability this turn' };
  }
  
  return { valid: true };
}

/**
 * Rule 602.2: Activate an activated ability
 */
export function activateAbility(
  ability: ActivatedAbility,
  manaPool: Readonly<ManaPool>,
  context: ActivationContext
): ActivationResult {
  const logs: string[] = [];
  
  // Mana abilities handled separately (don't use stack)
  if (ability.isManaAbility) {
    return {
      success: false,
      error: 'Mana abilities should use activateManaAbility instead',
    };
  }
  
  // Check if player has priority
  if (!context.hasPriority) {
    return {
      success: false,
      error: 'You do not have priority',
    };
  }
  
  // Validate restrictions
  const restrictionValidation = validateActivationRestrictions(
    ability.restrictions,
    context
  );
  if (!restrictionValidation.valid) {
    return {
      success: false,
      error: restrictionValidation.reason,
    };
  }
  
  // Validate loyalty ability restrictions
  const loyaltyValidation = validateLoyaltyAbility(ability, context);
  if (!loyaltyValidation.valid) {
    return {
      success: false,
      error: loyaltyValidation.reason,
    };
  }
  
  logs.push(`${ability.sourceName}: Activating ability`);
  
  // Pay mana cost if present
  let updatedPool = manaPool;
  if (ability.manaCost) {
    const payment = payManaCost(manaPool, ability.manaCost);
    if (!payment.success) {
      return {
        success: false,
        error: payment.error,
      };
    }
    updatedPool = payment.remainingPool!;
    logs.push(`Paid mana cost: ${JSON.stringify(ability.manaCost)}`);
  }
  
  // Create stack object for the ability
  const stackObject: StackObject = {
    id: `ability-${Date.now()}-${ability.id}`,
    spellId: ability.id,
    cardName: `${ability.sourceName} ability`,
    controllerId: ability.controllerId,
    targets: ability.targets || [],
    timestamp: Date.now(),
    type: 'ability',
  };
  
  logs.push(`${ability.sourceName} ability added to stack`);
  
  return {
    success: true,
    stackObjectId: stackObject.id,
    manaPoolAfter: updatedPool,
    log: logs,
  };
}

/**
 * Create a simple activated ability
 */
export function createActivatedAbility(
  sourceId: string,
  sourceName: string,
  controllerId: string,
  manaCost: ManaCost | undefined,
  effect: string,
  restrictions?: ActivationRestriction[]
): ActivatedAbility {
  return {
    id: `${sourceId}-activated-${Date.now()}`,
    sourceId,
    sourceName,
    controllerId,
    manaCost,
    effect,
    restrictions,
  };
}

/**
 * Parsed cost component from oracle text
 */
export interface ParsedCostComponent {
  readonly type: 'mana' | 'tap' | 'untap' | 'sacrifice' | 'discard' | 'pay_life' | 'exile' | 'remove_counter' | 'other';
  readonly manaCost?: ManaCost;
  readonly sacrificeFilter?: string;
  readonly discardCount?: number;
  readonly lifeAmount?: number;
  readonly counterType?: string;
  readonly counterCount?: number;
  readonly description: string;
}

/**
 * Parsed activated ability from oracle text
 */
export interface ParsedActivatedAbility {
  readonly costs: ParsedCostComponent[];
  readonly effect: string;
  readonly requiresTap: boolean;
  readonly sorcerySpeed: boolean;
  readonly oncePerTurn: boolean;
  readonly isManaAbility: boolean;
}

/**
 * Parse activated abilities from oracle text
 * Format: "[Cost]: [Effect]"
 */
export function parseActivatedAbilitiesFromText(
  oracleText: string,
  permanentId: string,
  controllerId: string,
  cardName: string
): ActivatedAbility[] {
  const abilities: ActivatedAbility[] = [];
  const text = oracleText.toLowerCase();
  
  // Pattern to match activated ability format: "Cost: Effect"
  // The cost comes before the colon, effect after
  const abilityPattern = /([^.]+?):\s*([^.]+\.)/gi;
  
  let match;
  let index = 0;
  
  while ((match = abilityPattern.exec(text)) !== null) {
    const costText = match[1].trim();
    const effectText = match[2].trim();
    
    // Skip if this looks like a triggered ability (starts with when/whenever/at)
    if (/^(when|whenever|at\s+the\s+beginning)/i.test(costText)) {
      continue;
    }
    
    // Skip if this is reminder text (contains parentheses at start)
    if (costText.startsWith('(')) {
      continue;
    }
    
    const parsedCosts = parseCostComponents(costText);
    const parsed = analyzeActivatedAbility(costText, effectText);
    
    // Determine mana cost from parsed components
    let manaCost: ManaCost | undefined;
    for (const cost of parsedCosts) {
      if (cost.type === 'mana' && cost.manaCost) {
        manaCost = cost.manaCost;
        break;
      }
    }
    
    // Build restrictions
    const restrictions: ActivationRestriction[] = [];
    
    if (parsed.sorcerySpeed) {
      restrictions.push({
        type: 'timing',
        description: 'Activate only as a sorcery',
        requiresSorceryTiming: true,
      });
    }
    
    if (parsed.oncePerTurn) {
      restrictions.push({
        type: 'frequency',
        description: 'Activate only once each turn',
        maxPerTurn: 1,
      });
    }
    
    // Build additional costs
    const additionalCosts: Cost[] = parsedCosts
      .filter(c => c.type !== 'mana')
      .map(c => ({
        type: c.type,
        description: c.description,
      }));
    
    abilities.push({
      id: `${permanentId}-activated-${index}`,
      sourceId: permanentId,
      sourceName: cardName,
      controllerId,
      manaCost,
      additionalCosts: additionalCosts.length > 0 ? additionalCosts : undefined,
      effect: effectText,
      restrictions: restrictions.length > 0 ? restrictions : undefined,
      isManaAbility: parsed.isManaAbility,
    });
    
    index++;
  }
  
  return abilities;
}

/**
 * Parse cost components from a cost string
 */
function parseCostComponents(costText: string): ParsedCostComponent[] {
  const components: ParsedCostComponent[] = [];
  const text = costText.toLowerCase();
  
  // Check for tap symbol
  if (text.includes('{t}') || text.includes('tap') && !text.includes('untap')) {
    components.push({
      type: 'tap',
      description: 'Tap this permanent',
    });
  }
  
  // Check for untap symbol
  if (text.includes('{q}') || text.includes('untap this')) {
    components.push({
      type: 'untap',
      description: 'Untap this permanent',
    });
  }
  
  // Check for sacrifice costs
  const sacrificeMatch = text.match(/sacrifice (?:a |an |this )?(\w+)?/i);
  if (sacrificeMatch) {
    components.push({
      type: 'sacrifice',
      sacrificeFilter: sacrificeMatch[1] || 'this',
      description: `Sacrifice ${sacrificeMatch[1] || 'this permanent'}`,
    });
  }
  
  // Check for discard costs
  const discardMatch = text.match(/discard (?:a card|(\d+) cards?)/i);
  if (discardMatch) {
    components.push({
      type: 'discard',
      discardCount: discardMatch[1] ? parseInt(discardMatch[1]) : 1,
      description: `Discard ${discardMatch[1] || '1'} card(s)`,
    });
  }
  
  // Check for pay life costs
  const lifeMatch = text.match(/pay (\d+) life/i);
  if (lifeMatch) {
    components.push({
      type: 'pay_life',
      lifeAmount: parseInt(lifeMatch[1]),
      description: `Pay ${lifeMatch[1]} life`,
    });
  }
  
  // Check for exile costs
  if (text.includes('exile') && !text.includes('you may exile')) {
    components.push({
      type: 'exile',
      description: 'Exile a card',
    });
  }
  
  // Check for remove counter costs
  const counterMatch = text.match(/remove (?:a |an |(\d+) )?(\+1\/\+1|charge|loyalty|\w+) counters?/i);
  if (counterMatch) {
    components.push({
      type: 'remove_counter',
      counterCount: counterMatch[1] ? parseInt(counterMatch[1]) : 1,
      counterType: counterMatch[2],
      description: `Remove ${counterMatch[1] || '1'} ${counterMatch[2]} counter(s)`,
    });
  }
  
  // Parse mana cost (look for mana symbols)
  const manaCost = parseManaCostFromText(text);
  if (manaCost && (manaCost.generic || 0) + (manaCost.white || 0) + (manaCost.blue || 0) + 
      (manaCost.black || 0) + (manaCost.red || 0) + (manaCost.green || 0) + (manaCost.colorless || 0) > 0) {
    components.push({
      type: 'mana',
      manaCost,
      description: `Pay mana cost`,
    });
  }
  
  return components;
}

/**
 * Parse mana cost from text containing mana symbols
 */
function parseManaCostFromText(text: string): ManaCost {
  const cost: ManaCost = {
    generic: 0,
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };
  
  // Match mana symbols like {1}, {W}, {U}, {B}, {R}, {G}, {C}
  const manaPattern = /\{([0-9]+|[wubrgc])\}/gi;
  let match;
  
  while ((match = manaPattern.exec(text)) !== null) {
    const symbol = match[1].toUpperCase();
    
    if (/^\d+$/.test(symbol)) {
      cost.generic = (cost.generic || 0) + parseInt(symbol);
    } else {
      switch (symbol) {
        case 'W': cost.white = (cost.white || 0) + 1; break;
        case 'U': cost.blue = (cost.blue || 0) + 1; break;
        case 'B': cost.black = (cost.black || 0) + 1; break;
        case 'R': cost.red = (cost.red || 0) + 1; break;
        case 'G': cost.green = (cost.green || 0) + 1; break;
        case 'C': cost.colorless = (cost.colorless || 0) + 1; break;
      }
    }
  }
  
  return cost;
}

/**
 * Analyze activated ability for special properties
 */
function analyzeActivatedAbility(costText: string, effectText: string): ParsedActivatedAbility {
  const text = (costText + ' ' + effectText).toLowerCase();
  
  const requiresTap = costText.includes('{t}') || costText.includes('tap');
  const sorcerySpeed = effectText.includes('activate only as a sorcery') || 
                       effectText.includes('only any time you could cast a sorcery');
  const oncePerTurn = effectText.includes('activate only once') || 
                      effectText.includes('activate this ability only once');
  
  // Check if this is a mana ability
  // Mana abilities: add mana, don't target, don't use stack
  const isManaAbility = (effectText.includes('add') && 
                         (effectText.includes('{w}') || effectText.includes('{u}') ||
                          effectText.includes('{b}') || effectText.includes('{r}') ||
                          effectText.includes('{g}') || effectText.includes('{c}') ||
                          effectText.includes('mana'))) &&
                        !effectText.includes('target');
  
  return {
    costs: [], // Will be filled by parseCostComponents
    effect: effectText,
    requiresTap,
    sorcerySpeed,
    oncePerTurn,
    isManaAbility,
  };
}

/**
 * Check if a permanent has any activated abilities with tap cost
 */
export function hasTapAbility(oracleText: string): boolean {
  return oracleText.includes('{T}') || 
         oracleText.toLowerCase().includes('{t}:') ||
         /tap\s*:/i.test(oracleText);
}

/**
 * Check if a permanent has a mana ability
 */
export function hasManaAbility(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  return text.includes('add {') && 
         text.includes(':') &&
         !text.includes('target');
}

/**
 * Get all mana abilities from oracle text
 */
export function getManaAbilities(
  oracleText: string,
  permanentId: string,
  controllerId: string,
  cardName: string
): ActivatedAbility[] {
  const allAbilities = parseActivatedAbilitiesFromText(oracleText, permanentId, controllerId, cardName);
  return allAbilities.filter(a => a.isManaAbility);
}
