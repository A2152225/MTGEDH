/**
 * Web-slinging keyword ability (Rule 702.188)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.188. Web-slinging
 * 702.188a Web-slinging is a static ability that functions while the spell with web-slinging is 
 * on the stack. "Web-slinging [cost]" means "You may cast this spell by paying [cost] and 
 * returning a tapped creature you control to its owner's hand rather than paying its mana cost."
 */

export interface WebSlingingAbility {
  readonly type: 'web-slinging';
  readonly source: string;
  readonly webSlingingCost: string;
  readonly wasWebSlung: boolean;
  readonly returnedCreature?: string;
}

export interface WebSlingingSummary {
  readonly source: string;
  readonly webSlingingCost: string;
  readonly canCastWithWebSlinging: boolean;
  readonly wasWebSlung: boolean;
  readonly returnedCreature?: string;
}

/**
 * Create a web-slinging ability
 * Rule 702.188a
 * @param source - The spell with web-slinging
 * @param webSlingingCost - Alternative cost
 * @returns Web-slinging ability object
 */
export function webSlinging(source: string, webSlingingCost: string): WebSlingingAbility {
  return {
    type: 'web-slinging',
    source,
    webSlingingCost,
    wasWebSlung: false,
  };
}

function normalizeZone(zone: string): string {
  return String(zone || '').trim().toLowerCase();
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

type WebSlingingReturnCandidate = {
  readonly controller?: string;
  readonly tapped?: boolean;
  readonly isTapped?: boolean;
  readonly isCreature?: boolean;
  readonly type_line?: string;
  readonly card?: {
    readonly type_line?: string;
  };
};

function isCreatureLike(candidate: WebSlingingReturnCandidate): boolean {
  if (candidate.isCreature === true) {
    return true;
  }

  const typeLine = String(candidate.type_line || candidate.card?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

/**
 * Cast with web-slinging
 * Rule 702.188a - Pay cost and return tapped creature
 * @param ability - Web-slinging ability
 * @param returnedCreature - ID of returned creature
 * @returns Updated ability
 */
export function castWithWebSlinging(
  ability: WebSlingingAbility,
  returnedCreature: string
): WebSlingingAbility {
  return {
    ...ability,
    wasWebSlung: true,
    returnedCreature,
  };
}

/**
 * Web-slinging can only be used from hand and requires a tapped creature you control.
 * Rule 702.188a
 */
export function canCastWithWebSlinging(hasTappedCreature: boolean, zone: string = 'hand'): boolean {
  return normalizeZone(zone) === 'hand' && hasTappedCreature;
}

/**
 * Validate a creature that can be returned for web-slinging.
 * Rule 702.188a
 */
export function canReturnForWebSlinging(
  creature: WebSlingingReturnCandidate,
  controllerId: string,
): boolean {
  const isTapped = creature.tapped === true || creature.isTapped === true;
  return String(creature.controller || '') === String(controllerId || '') && isTapped && isCreatureLike(creature);
}

/**
 * Check if spell was web-slung
 * @param ability - Web-slinging ability
 * @returns True if web-slung
 */
export function wasWebSlung(ability: WebSlingingAbility): boolean {
  return ability.wasWebSlung;
}

/**
 * Get returned creature
 * @param ability - Web-slinging ability
 * @returns Creature ID or undefined
 */
export function getReturnedCreature(ability: WebSlingingAbility): string | undefined {
  return ability.returnedCreature;
}

/**
 * Parse a web-slinging cost from oracle text.
 */
export function parseWebSlingingCost(oracleText: string): string | null {
  return extractKeywordCost(oracleText, 'web-slinging');
}

/**
 * Multiple instances of web-slinging with the same cost are redundant.
 * @param abilities - Array of web-slinging abilities
 * @returns True when duplicate costs appear
 */
export function hasRedundantWebSlinging(abilities: readonly WebSlingingAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }

  const costs = new Set(abilities.map((ability) => ability.webSlingingCost));
  return costs.size < abilities.length;
}

export function createWebSlingingSummary(
  ability: WebSlingingAbility,
  hasTappedCreature: boolean,
  zone: string,
): WebSlingingSummary {
  return {
    source: ability.source,
    webSlingingCost: ability.webSlingingCost,
    canCastWithWebSlinging: canCastWithWebSlinging(hasTappedCreature, zone),
    wasWebSlung: ability.wasWebSlung,
    returnedCreature: ability.returnedCreature,
  };
}
