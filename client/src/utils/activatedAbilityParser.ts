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

import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type {
  ActivationContext,
  ParsedActivatedAbility,
} from './activatedAbilityParser-handlers/activatedAbilityParserTypes';
import { parseActivatedAbilities as parseActivatedAbilitiesFromOracle } from './activatedAbilityParser-handlers/parseActivatedAbilities';
import { stampAnyPlayerMayActivate } from './activatedAbilityParser-handlers/stampAnyPlayerMayActivate';
import { parseStationThreshold } from './activatedAbilityParser-handlers/parseStationAndThresholdHelpers';
import { parseTimingRestrictionFromText } from './activatedAbilityParser-handlers/parseTimingRestrictionFromText';

export type {
  ActivationContext,
  ParsedActivatedAbility,
  TapOtherPermanentsCost,
} from './activatedAbilityParser-handlers/activatedAbilityParserTypes';
export { parseStationThreshold, parseTimingRestrictionFromText };

export function parseActivatedAbilities(
  ...args: Parameters<typeof parseActivatedAbilitiesFromOracle>
): ReturnType<typeof parseActivatedAbilitiesFromOracle> {
  const [card, grantedAbilities] = args;
  const oracleForStamp = [card?.oracle_text, ...(grantedAbilities || [])]
    .filter(Boolean)
    .join('\n');
  return stampAnyPlayerMayActivate(parseActivatedAbilitiesFromOracle(...args), oracleForStamp);
}

const COLOR_SYMBOL_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

export function getThresholdActivationStatus(
  ability: Pick<ParsedActivatedAbility, 'isStationAbility' | 'stationThreshold'>,
  permanent?: { counters?: Record<string, number> | undefined }
): { canActivate: boolean; reason?: string } {
  if (ability.isStationAbility || typeof ability.stationThreshold !== 'number') {
    return { canActivate: true };
  }

  const currentChargeCounters = Number(permanent?.counters?.charge || 0);
  if (currentChargeCounters >= ability.stationThreshold) {
    return { canActivate: true };
  }

  return {
    canActivate: false,
    reason: `Needs ${ability.stationThreshold}+ charge counters`,
  };
}

/**
 * Check if a creature can activate tap abilities considering summoning sickness and haste effects
 */


function isUpkeepStep(step?: string): boolean {
  const s = String(step || '').toUpperCase();
  return s.includes('UPKEEP');
}

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

function getCardColorSymbols(card?: KnownCardRef): string[] {
  const colors = new Set<string>();

  if (Array.isArray(card?.colors)) {
    for (const color of card.colors) {
      const normalized = String(color || '').toUpperCase();
      if ((COLOR_SYMBOL_ORDER as readonly string[]).includes(normalized)) {
        colors.add(normalized);
      }
    }
  }

  if (colors.size === 0) {
    const manaCost = String(card?.mana_cost || '').toUpperCase();
    const manaTokens = manaCost.match(/\{([^}]+)\}/g) || [];
    for (const token of manaTokens) {
      for (const symbol of COLOR_SYMBOL_ORDER) {
        if (token.includes(symbol)) {
          colors.add(symbol);
        }
      }
    }
  }

  return COLOR_SYMBOL_ORDER.filter((color) => colors.has(color));
}

function getMoxAmberAvailableColors(
  battlefield: readonly BattlefieldPermanent[] | undefined,
  controllerId: string,
): string[] {
  const colors = new Set<string>();

  for (const permanent of battlefield || []) {
    if (!permanent || String(permanent.controller || '') !== String(controllerId)) continue;

    const typeLine = String((permanent.card as KnownCardRef | undefined)?.type_line || '').toLowerCase();
    const isQualifyingCreature = typeLine.includes('legendary') && typeLine.includes('creature');
    const isQualifyingPlaneswalker = typeLine.includes('planeswalker');
    if (!isQualifyingCreature && !isQualifyingPlaneswalker) continue;

    for (const color of getCardColorSymbols(permanent.card as KnownCardRef)) {
      colors.add(color);
    }
  }

  return COLOR_SYMBOL_ORDER.filter((color) => colors.has(color));
}

export function getConditionalManaAbilityStatus(
  ability: Pick<ParsedActivatedAbility, 'isManaAbility' | 'effect'>,
  permanent: BattlefieldPermanent,
  battlefield?: readonly BattlefieldPermanent[],
): { canActivate: boolean; reason?: string } {
  if (!ability.isManaAbility) {
    return { canActivate: true };
  }

  const sourceName = String((permanent.card as KnownCardRef | undefined)?.name || '').toLowerCase();
  const effectText = String(ability.effect || '').toLowerCase();
  const isMoxAmber = sourceName === 'mox amber' || effectText.includes('among legendary creatures and planeswalkers you control');

  if (!isMoxAmber) {
    return { canActivate: true };
  }

  const availableColors = getMoxAmberAvailableColors(battlefield, permanent.controller);
  if (availableColors.length === 0) {
    return {
      canActivate: false,
      reason: 'Needs a colored legendary creature or planeswalker',
    };
  }

  return { canActivate: true };
}

/**
 * Shared activation gating for context menus, ability buttons, and tap routing.
 */
export function getActivatedAbilityActivationStatus(
  ability: ParsedActivatedAbility,
  permanent: BattlefieldPermanent,
  context: ActivationContext,
  battlefield?: readonly BattlefieldPermanent[],
): { canActivate: boolean; reason?: string } {
  const tapCheck = canActivateTapAbility(ability.requiresTap, context, ability.isManaAbility);
  const thresholdCheck = getThresholdActivationStatus(ability, permanent);
  const conditionalManaCheck = getConditionalManaAbilityStatus(ability, permanent, battlefield);

  let canActivateAbility = tapCheck.canActivate && thresholdCheck.canActivate && conditionalManaCheck.canActivate;
  let reason = conditionalManaCheck.reason || thresholdCheck.reason || tapCheck.reason;

  if (ability.isLoyaltyAbility) {
    if (!context.isMainPhase) {
      canActivateAbility = false;
      reason = 'Only during main phase';
    } else if (!context.isOwnTurn) {
      canActivateAbility = false;
      reason = 'Only on your turn';
    } else if (!context.stackEmpty) {
      canActivateAbility = false;
      reason = 'Stack must be empty';
    } else if (ability.loyaltyCost !== undefined && context.loyaltyCounters !== undefined) {
      if (ability.loyaltyCost < 0 && context.loyaltyCounters < Math.abs(ability.loyaltyCost)) {
        canActivateAbility = false;
        reason = 'Not enough loyalty';
      }
    }
  }

  if (ability.timingRestriction === 'sorcery') {
    if (!context.isMainPhase || !context.isOwnTurn || !context.stackEmpty) {
      canActivateAbility = false;
      reason = 'Sorcery timing required';
    }
  }

  if (ability.timingRestriction === 'upkeep') {
    if (!context.isOwnTurn || !isUpkeepStep(context.currentStep)) {
      canActivateAbility = false;
      reason = 'Only during your upkeep';
    }
  }

  if (ability.timingRestriction === 'your_turn') {
    if (!context.isOwnTurn) {
      canActivateAbility = false;
      reason = 'Only during your turn';
    }
  }

  if (!ability.isManaAbility && !context.controllerHasPriority) {
    canActivateAbility = false;
    reason = 'No priority';
  }

  return { canActivate: canActivateAbility, reason };
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
