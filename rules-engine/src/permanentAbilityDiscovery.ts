/**
 * permanentAbilityDiscovery.ts
 * 
 * Unified ability discovery for permanents on the battlefield.
 * 
 * This module integrates the comprehensive oracleTextParser to dynamically
 * discover activated abilities from creature cards and other permanents,
 * providing a bridge between parsed ability data and the activation system.
 * 
 * Design Philosophy:
 * 1. Use oracleTextParser for comprehensive ability parsing
 * 2. Fall back to card-specific configurations for edge cases
 * 3. Convert parsed abilities to ActivatedAbility format for the rules engine
 * 4. Support both mana and non-mana activated abilities
 */

import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import type { ManaCost } from './types/mana';
import { CostType, type Cost } from './types/costs';
import {
  parseOracleText,
  parseActivatedAbility,
  hasActivatedAbility,
  AbilityType,
  type ParsedAbility,
  type OracleTextParseResult,
  type ChoiceRequirement,
} from './oracleTextParser';
import type { ActivatedAbility, ActivationRestriction } from './activatedAbilities';
import {
  hasSpecialActivatedAbility,
  getActivatedAbilityConfig,
  type ActivatedAbilityConfig,
} from './cards/activatedAbilityCards';

/**
 * Common counter types that can appear in cost text
 * Used for parsing "remove X counter(s)" costs
 */
const KNOWN_COUNTER_TYPES = [
  '+1/+1',
  '-1/-1',
  'charge',
  'loyalty',
  'time',
  'fade',
  'age',
  'divinity',
  'storage',
  'verse',
  'quest',
  'energy',
  'experience',
];

/**
 * Discovered ability from a permanent
 * 
 * This interface extends the basic ability information with parsed metadata
 * from the oracle text parser, enabling more sophisticated ability handling.
 * 
 * New fields from ParsedAbility (as of improved parser):
 * - isOptional: Indicates if the ability contains "you may" (player choice)
 * - modes: Array of mode text for modal abilities (e.g., "Choose one —")
 * - requiresChoice: Structured info about choice requirements (color, creature type, etc.)
 * 
 * These fields enable the UI and game engine to:
 * - Prompt players for optional ability activation
 * - Present mode selection for modal spells/abilities
 * - Handle ETB/cast choice requirements (e.g., "choose a color")
 */
export interface DiscoveredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly cost: string;
  readonly effect: string;
  readonly manaCost?: ManaCost;
  readonly additionalCosts?: readonly Cost[];
  readonly restrictions?: readonly ActivationRestriction[];
  readonly isManaAbility: boolean;
  readonly isLoyaltyAbility: boolean;
  readonly isKeywordAbility: boolean;
  readonly targets?: readonly string[];
  readonly isOptional?: boolean;
  readonly modes?: readonly string[];
  readonly requiresChoice?: ChoiceRequirement;
  readonly rawParsedAbility?: ParsedAbility;
}

/**
 * Result of ability discovery for a permanent
 * 
 * Provides a comprehensive analysis of a permanent's abilities including
 * convenient boolean flags for quick filtering.
 * 
 * New convenience flags (as of improved parser):
 * - hasModes: True if any ability (activated or otherwise) has modal choices
 * - hasChoiceRequirements: True if any ability requires a choice (color, creature type, etc.)
 * 
 * These flags are calculated from both activated abilities and the full parseResult,
 * ensuring that replacement effects and other non-activated abilities are also considered.
 */
export interface AbilityDiscoveryResult {
  readonly permanentId: string;
  readonly permanentName: string;
  readonly controllerId: string;
  readonly abilities: readonly DiscoveredAbility[];
  readonly hasActivatedAbilities: boolean;
  readonly hasManaAbilities: boolean;
  readonly hasLoyaltyAbilities: boolean;
  readonly hasModes: boolean;
  readonly hasChoiceRequirements: boolean;
  readonly parseResult?: OracleTextParseResult;
}

/**
 * Parse mana cost from cost text
 * Extracts mana symbols and returns a ManaCost structure
 */
function parseManaCostFromCostText(costText: string): ManaCost | undefined {
  if (!costText) return undefined;
  
  let generic = 0;
  let white = 0;
  let blue = 0;
  let black = 0;
  let red = 0;
  let green = 0;
  let colorless = 0;
  
  // Match mana symbols like {1}, {W}, {U}, {B}, {R}, {G}, {C}
  const manaPattern = /\{([0-9]+|[wubrgcWUBRGC])\}/gi;
  let match;
  
  while ((match = manaPattern.exec(costText)) !== null) {
    const symbol = match[1].toUpperCase();
    
    if (/^\d+$/.test(symbol)) {
      generic += parseInt(symbol, 10);
    } else {
      switch (symbol) {
        case 'W': white++; break;
        case 'U': blue++; break;
        case 'B': black++; break;
        case 'R': red++; break;
        case 'G': green++; break;
        case 'C': colorless++; break;
        default:
          // Unknown mana symbol - treat as generic 1 for flexibility
          // This handles edge cases like hybrid mana or other special symbols
          break;
      }
    }
  }
  
  // Only return if we found any mana symbols
  if (generic || white || blue || black || red || green || colorless) {
    return { generic, white, blue, black, red, green, colorless };
  }
  
  return undefined;
}

/**
 * Parse additional costs from cost text (tap, sacrifice, discard, etc.)
 */
function parseAdditionalCosts(costText: string): Cost[] {
  const costs: Cost[] = [];
  const text = costText.toLowerCase();
  
  // Check for tap symbol
  if (text.includes('{t}') || (text.includes('tap') && !text.includes('untap'))) {
    costs.push({
      type: CostType.TAP,
      description: 'Tap this permanent',
      isOptional: false,
      isMandatory: true,
    });
  }
  
  // Check for untap symbol
  if (text.includes('{q}') || text.includes('untap this')) {
    costs.push({
      type: CostType.UNTAP,
      description: 'Untap this permanent',
      isOptional: false,
      isMandatory: true,
    });
  }
  
  // Check for sacrifice costs
  const sacrificeMatch = text.match(/sacrifice (?:a |an |this )?(\w+)?/i);
  if (sacrificeMatch) {
    costs.push({
      type: CostType.SACRIFICE,
      description: `Sacrifice ${sacrificeMatch[1] || 'this permanent'}`,
      isOptional: false,
      isMandatory: true,
    });
  }
  
  // Check for discard costs
  const discardMatch = text.match(/discard (?:a card|(\d+) cards?)/i);
  if (discardMatch) {
    costs.push({
      type: CostType.DISCARD,
      description: `Discard ${discardMatch[1] || '1'} card(s)`,
      isOptional: false,
      isMandatory: true,
    });
  }
  
  // Check for pay life costs
  const lifeMatch = text.match(/pay (\d+) life/i);
  if (lifeMatch) {
    costs.push({
      type: CostType.LIFE,
      description: `Pay ${lifeMatch[1]} life`,
      isOptional: false,
      isMandatory: true,
    });
  }
  
  // Check for exile costs
  if (text.includes('exile') && !text.includes('you may exile')) {
    costs.push({
      type: CostType.EXILE,
      description: 'Exile a card',
      isOptional: false,
      isMandatory: true,
    });
  }
  
  // Check for remove counter costs
  // Build regex pattern from known counter types for better extensibility
  // Escape special regex characters properly (including backslash) to avoid injection
  const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const counterTypesPattern = KNOWN_COUNTER_TYPES.map(escapeRegex).join('|');
  const counterRegex = new RegExp(`remove (?:a |an |(\\d+) )?(${counterTypesPattern}|\\w+) counters?`, 'i');
  const counterMatch = text.match(counterRegex);
  if (counterMatch) {
    costs.push({
      type: CostType.REMOVE_COUNTER,
      description: `Remove ${counterMatch[1] || '1'} ${counterMatch[2]} counter(s)`,
      isOptional: false,
      isMandatory: true,
    });
  }
  
  return costs;
}

/**
 * Parse activation restrictions from effect text
 */
function parseRestrictions(effectText: string): ActivationRestriction[] {
  const restrictions: ActivationRestriction[] = [];
  const text = effectText.toLowerCase();
  
  // Sorcery speed restriction
  if (text.includes('activate only as a sorcery') || 
      text.includes('only any time you could cast a sorcery')) {
    restrictions.push({
      type: 'timing',
      description: 'Activate only as a sorcery',
      requiresSorceryTiming: true,
    });
  }
  
  // Once per turn restriction
  if (text.includes('activate only once') || 
      text.includes('activate this ability only once')) {
    restrictions.push({
      type: 'frequency',
      description: 'Activate only once each turn',
      maxPerTurn: 1,
    });
  }
  
  // Combat restriction
  if (text.includes('only during combat')) {
    restrictions.push({
      type: 'timing',
      description: 'Activate only during combat',
      requiresCombat: true,
    });
  }
  
  // Own turn restriction
  if (text.includes('only during your turn')) {
    restrictions.push({
      type: 'timing',
      description: 'Activate only during your turn',
      requiresOwnTurn: true,
    });
  }
  
  return restrictions;
}

/**
 * Convert a ParsedAbility from oracleTextParser to a DiscoveredAbility
 */
function convertParsedAbility(
  parsedAbility: ParsedAbility,
  permanentId: string,
  cardName: string,
  controllerId: string,
  abilityIndex: number,
  globalRestrictions?: ActivationRestriction[]
): DiscoveredAbility | null {
  // Only convert activated abilities and keyword abilities with costs
  if (parsedAbility.type !== AbilityType.ACTIVATED && 
      parsedAbility.type !== AbilityType.KEYWORD) {
    return null;
  }
  
  const cost = parsedAbility.cost || '';
  const effect = parsedAbility.effect || '';
  // Use the full text for restriction parsing since restrictions can appear after the effect
  const fullText = parsedAbility.text || '';
  
  // Combine restrictions from the ability text and global restrictions
  const abilityRestrictions = parseRestrictions(fullText);
  const allRestrictions = [...abilityRestrictions];
  
  // Add global restrictions that aren't already present
  if (globalRestrictions) {
    for (const gr of globalRestrictions) {
      const isDuplicate = allRestrictions.some(
        r => r.type === gr.type && r.description === gr.description
      );
      if (!isDuplicate) {
        allRestrictions.push(gr);
      }
    }
  }
  
  return {
    id: `${permanentId}-ability-${abilityIndex}`,
    sourceId: permanentId,
    sourceName: cardName,
    controllerId,
    cost,
    effect,
    manaCost: parseManaCostFromCostText(cost),
    additionalCosts: parseAdditionalCosts(cost),
    restrictions: allRestrictions.length > 0 ? allRestrictions : undefined,
    isManaAbility: parsedAbility.isManaAbility || false,
    isLoyaltyAbility: parsedAbility.isLoyaltyAbility || false,
    isKeywordAbility: parsedAbility.type === AbilityType.KEYWORD,
    targets: parsedAbility.targets,
    isOptional: parsedAbility.isOptional,
    modes: parsedAbility.modes,
    requiresChoice: parsedAbility.requiresChoice,
    rawParsedAbility: parsedAbility,
  };
}

/**
 * Convert card-specific config to DiscoveredAbility
 */
function convertConfigToAbility(
  config: ActivatedAbilityConfig,
  permanentId: string,
  controllerId: string
): DiscoveredAbility[] {
  const abilities: DiscoveredAbility[] = [];
  
  if (config.grantedAbility) {
    abilities.push({
      id: `${permanentId}-granted-ability`,
      sourceId: permanentId,
      sourceName: config.cardName,
      controllerId,
      cost: config.grantedAbility.cost,
      effect: config.grantedAbility.effect,
      manaCost: parseManaCostFromCostText(config.grantedAbility.cost),
      additionalCosts: parseAdditionalCosts(config.grantedAbility.cost),
      restrictions: [],
      isManaAbility: false,
      isLoyaltyAbility: false,
      isKeywordAbility: false,
    });
  }
  
  if (config.tapAbility) {
    abilities.push({
      id: `${permanentId}-tap-ability`,
      sourceId: permanentId,
      sourceName: config.cardName,
      controllerId,
      cost: config.tapAbility.cost,
      effect: config.tapAbility.effect,
      additionalCosts: [{
        type: CostType.TAP,
        description: config.tapAbility.cost,
        isOptional: false,
        isMandatory: true,
      }],
      restrictions: [],
      isManaAbility: false,
      isLoyaltyAbility: false,
      isKeywordAbility: false,
    });
  }
  
  return abilities;
}

/**
 * Discover all activated abilities on a permanent
 * 
 * This function uses the comprehensive oracleTextParser to extract
 * activated abilities from a permanent's oracle text, and also checks
 * for any card-specific configurations.
 * 
 * Priority:
 * 1. Card-specific configurations (for edge cases and special handling)
 * 2. Parsed abilities from oracle text (comprehensive parsing)
 */
export function discoverPermanentAbilities(
  permanent: BattlefieldPermanent,
  controllerId: string
): AbilityDiscoveryResult {
  const card = permanent.card as KnownCardRef;
  const cardName = card?.name || 'Unknown';
  const oracleText = card?.oracle_text || '';
  
  const abilities: DiscoveredAbility[] = [];
  
  // Step 1: Check for card-specific configurations
  if (hasSpecialActivatedAbility(cardName)) {
    const config = getActivatedAbilityConfig(cardName);
    if (config) {
      abilities.push(...convertConfigToAbility(config, permanent.id, controllerId));
    }
  }
  
  // Step 2: Parse abilities from oracle text using the comprehensive parser
  const parseResult = parseOracleText(oracleText, cardName);
  
  // Check for restriction clauses in the full oracle text that apply to activated abilities
  // These are often separate sentences like "Activate only as a sorcery."
  const globalRestrictions = parseRestrictions(oracleText);
  
  let abilityIndex = 0;
  for (const parsedAbility of parseResult.abilities) {
    const converted = convertParsedAbility(
      parsedAbility,
      permanent.id,
      cardName,
      controllerId,
      abilityIndex,
      globalRestrictions
    );
    
    if (converted) {
      // Avoid duplicates from card-specific config
      const isDuplicate = abilities.some(
        a => a.cost === converted.cost && a.effect === converted.effect
      );
      
      if (!isDuplicate) {
        abilities.push(converted);
        abilityIndex++;
      }
    }
  }
  
  return {
    permanentId: permanent.id,
    permanentName: cardName,
    controllerId,
    abilities,
    hasActivatedAbilities: abilities.length > 0,
    hasManaAbilities: abilities.some(a => a.isManaAbility),
    hasLoyaltyAbilities: abilities.some(a => a.isLoyaltyAbility),
    hasModes: parseResult.hasModes || abilities.some(a => a.modes && a.modes.length > 0),
    hasChoiceRequirements: parseResult.abilities.some(a => a.requiresChoice !== undefined),
    parseResult,
  };
}

/**
 * Discover all activated abilities on all permanents controlled by a player
 */
export function discoverPlayerAbilities(
  permanents: readonly BattlefieldPermanent[],
  playerId: string
): Map<string, AbilityDiscoveryResult> {
  const results = new Map<string, AbilityDiscoveryResult>();
  
  for (const permanent of permanents) {
    if (permanent.controller === playerId) {
      const result = discoverPermanentAbilities(permanent, playerId);
      results.set(permanent.id, result);
    }
  }
  
  return results;
}

/**
 * Get all mana abilities from a permanent
 */
export function getManaAbilitiesFromPermanent(
  permanent: BattlefieldPermanent,
  controllerId: string
): DiscoveredAbility[] {
  const result = discoverPermanentAbilities(permanent, controllerId);
  return result.abilities.filter(a => a.isManaAbility);
}

/**
 * Get all non-mana activated abilities from a permanent
 */
export function getNonManaAbilitiesFromPermanent(
  permanent: BattlefieldPermanent,
  controllerId: string
): DiscoveredAbility[] {
  const result = discoverPermanentAbilities(permanent, controllerId);
  return result.abilities.filter(a => !a.isManaAbility);
}

/**
 * Convert a DiscoveredAbility to the ActivatedAbility format used by the rules engine
 * This provides compatibility with the existing activation system
 */
export function toActivatedAbility(discovered: DiscoveredAbility): ActivatedAbility {
  return {
    id: discovered.id,
    sourceId: discovered.sourceId,
    sourceName: discovered.sourceName,
    controllerId: discovered.controllerId,
    manaCost: discovered.manaCost,
    additionalCosts: discovered.additionalCosts,
    effect: discovered.effect,
    targets: discovered.targets,
    restrictions: discovered.restrictions ? [...discovered.restrictions] : undefined,
    isManaAbility: discovered.isManaAbility,
    isLoyaltyAbility: discovered.isLoyaltyAbility,
  };
}

/**
 * Quick check if a permanent has any activated abilities
 * Uses both oracleTextParser and card-specific config
 */
export function permanentHasActivatedAbilities(
  permanent: BattlefieldPermanent
): boolean {
  const card = permanent.card as KnownCardRef;
  const cardName = card?.name || '';
  const oracleText = card?.oracle_text || '';
  
  // Check card-specific config first (fast path)
  if (hasSpecialActivatedAbility(cardName)) {
    return true;
  }
  
  // Use oracleTextParser's quick check
  return hasActivatedAbility(oracleText);
}

/**
 * Quick check if a permanent has mana abilities
 */
export function permanentHasManaAbilities(
  permanent: BattlefieldPermanent
): boolean {
  const card = permanent.card as KnownCardRef;
  const oracleText = card?.oracle_text || '';
  
  // Quick pattern check for common mana ability patterns
  if (!oracleText.includes(':')) return false;
  
  const text = oracleText.toLowerCase();
  
  // Check for explicit mana production patterns
  if (text.includes('add {')) return true;
  if (text.includes('add') && text.includes('mana')) return true;
  if (text.includes('mana of any color')) return true;
  
  return false;
}
