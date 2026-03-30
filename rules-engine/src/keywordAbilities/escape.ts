/**
 * Escape keyword ability (Rule 702.138)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.138. Escape
 * 702.138a Escape represents a static ability that functions while the card with escape is in 
 * a player's graveyard. "Escape [cost]" means "You may cast this card from your graveyard by 
 * paying [cost] rather than paying its mana cost." Casting a spell using its escape ability 
 * follows the rules for paying alternative costs in rules 601.2b and 601.2f–h.
 * 702.138b A spell or permanent "escaped" if that spell or the spell that became that permanent 
 * as it resolved was cast from a graveyard with an escape ability.
 * 702.138c An ability that reads "[This permanent] escapes with [one or more of a kind of counter]" 
 * means "If this permanent escaped, it enters with [those counters]"
 * 702.138d An ability that reads "[This permanent] escapes with [ability]" means "If this 
 * permanent escaped, it has [ability]."
 */

export interface EscapeAbility {
  readonly type: 'escape';
  readonly source: string;
  readonly escapeCost: string;
  readonly hasEscaped: boolean;
  readonly escapesWithCounters?: string; // e.g., "two +1/+1 counters"
  readonly escapesWithAbility?: string;
}

export interface EscapeSummary {
  readonly source: string;
  readonly escapeCost: string;
  readonly canCastFromGraveyard: boolean;
  readonly hasEscaped: boolean;
  readonly escapedWithCounters?: string;
  readonly escapedWithAbility?: string;
}

function extractKeywordCost(oracleText: string, keyword: string): string | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const pattern = new RegExp(`\\b${keyword}\\s+([^.;,()]+)`, 'i');
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const cost = String(match[1] || '').trim();
  return cost || null;
}

/**
 * Create an escape ability
 * Rule 702.138a
 * @param source - The card with escape
 * @param escapeCost - Cost to cast from graveyard
 * @param escapesWithCounters - Optional counter description
 * @param escapesWithAbility - Optional ability description
 * @returns Escape ability object
 */
export function escape(
  source: string,
  escapeCost: string,
  escapesWithCounters?: string,
  escapesWithAbility?: string
): EscapeAbility {
  return {
    type: 'escape',
    source,
    escapeCost,
    hasEscaped: false,
    escapesWithCounters,
    escapesWithAbility,
  };
}

/**
 * Cast spell from graveyard with escape
 * Rule 702.138a
 * @param ability - Escape ability
 * @returns Updated ability
 */
export function castWithEscape(ability: EscapeAbility): EscapeAbility {
  return {
    ...ability,
    hasEscaped: true,
  };
}

/**
 * Check if spell/permanent escaped
 * Rule 702.138b
 * @param ability - Escape ability
 * @returns True if escaped
 */
export function hasEscaped(ability: EscapeAbility): boolean {
  return ability.hasEscaped;
}

/**
 * Get escape cost
 * @param ability - Escape ability
 * @returns Escape cost string
 */
export function getEscapeCost(ability: EscapeAbility): string {
  return ability.escapeCost;
}

/**
 * Check if escapes with counters
 * Rule 702.138c
 * @param ability - Escape ability
 * @returns Counter description or undefined
 */
export function getEscapeCounters(ability: EscapeAbility): string | undefined {
  return ability.escapesWithCounters;
}

/**
 * Escape can only be used from the graveyard and with enough cards to exile for the additional cost.
 */
export function canCastWithEscape(zone: string, availableCardsToExile: number, requiredCardsToExile: number): boolean {
  return String(zone || '').trim().toLowerCase() === 'graveyard'
    && availableCardsToExile >= Math.max(0, requiredCardsToExile);
}

/**
 * Return the extra counter text that applies if the permanent escaped.
 */
export function getEscapedCounterText(ability: EscapeAbility): string | undefined {
  return ability.hasEscaped ? ability.escapesWithCounters : undefined;
}

/**
 * Return the extra ability text that applies if the permanent escaped.
 */
export function getEscapedAbilityText(ability: EscapeAbility): string | undefined {
  return ability.hasEscaped ? ability.escapesWithAbility : undefined;
}

/**
 * Parse an escape cost from oracle text.
 */
export function parseEscapeCost(oracleText: string): string | null {
  return extractKeywordCost(oracleText, 'escape');
}

/**
 * Multiple instances of escape are not redundant
 * @param abilities - Array of escape abilities
 * @returns False
 */
export function hasRedundantEscape(abilities: readonly EscapeAbility[]): boolean {
  return false;
}

export function createEscapeSummary(
  ability: EscapeAbility,
  zone: string,
  availableCardsToExile: number,
  requiredCardsToExile: number,
): EscapeSummary {
  return {
    source: ability.source,
    escapeCost: ability.escapeCost,
    canCastFromGraveyard: canCastWithEscape(zone, availableCardsToExile, requiredCardsToExile),
    hasEscaped: ability.hasEscaped,
    escapedWithCounters: getEscapedCounterText(ability),
    escapedWithAbility: getEscapedAbilityText(ability),
  };
}
