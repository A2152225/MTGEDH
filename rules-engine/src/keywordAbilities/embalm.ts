/**
 * Embalm keyword ability (Rule 702.128)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.128. Embalm
 * 702.128a Embalm is an activated ability that functions while the card with embalm is in a 
 * graveyard. "Embalm [cost]" means "[Cost], Exile this card from your graveyard: Create a token 
 * that's a copy of this card, except it's white, it has no mana cost, and it's a Zombie in 
 * addition to its other types. Activate only as a sorcery."
 * 702.128b A token is "embalmed" if it's created by a resolving embalm ability.
 */

export interface EmbalmAbility {
  readonly type: 'embalm';
  readonly source: string;
  readonly embalmCost: string;
  readonly hasBeenEmbalmed: boolean;
  readonly tokenId?: string;
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
 * Create an embalm ability
 * Rule 702.128a
 * @param source - The card with embalm
 * @param embalmCost - Cost to activate embalm
 * @returns Embalm ability object
 */
export function embalm(source: string, embalmCost: string): EmbalmAbility {
  return {
    type: 'embalm',
    source,
    embalmCost,
    hasBeenEmbalmed: false,
  };
}

/**
 * Activate embalm from graveyard
 * Rule 702.128a - Create white Zombie token copy
 * @param ability - Embalm ability
 * @param tokenId - ID of created token
 * @returns Updated ability
 */
export function activateEmbalm(ability: EmbalmAbility, tokenId: string): EmbalmAbility {
  return {
    ...ability,
    hasBeenEmbalmed: true,
    tokenId,
  };
}

/**
 * Check if token was embalmed
 * Rule 702.128b
 * @param ability - Embalm ability
 * @returns True if token was created by embalm
 */
export function isEmbalmed(ability: EmbalmAbility): boolean {
  return ability.hasBeenEmbalmed;
}

/**
 * Get embalmed token
 * @param ability - Embalm ability
 * @returns Token ID or undefined
 */
export function getEmbalmToken(ability: EmbalmAbility): string | undefined {
  return ability.tokenId;
}

/**
 * Embalm activates only from the graveyard and only as a sorcery.
 */
export function canActivateEmbalm(zone: string, isSorcerySpeed: boolean): boolean {
  return String(zone || '').trim().toLowerCase() === 'graveyard' && isSorcerySpeed;
}

/**
 * Create the white Zombie token copy used by embalm.
 */
export function createEmbalmToken(tokenId: string, controllerId: string, originalCard: any): any {
  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: true,
    counters: {},
    attachments: [],
    modifiers: [],
    isToken: true,
    basePower: Number(originalCard.power || 0),
    baseToughness: Number(originalCard.toughness || 0),
    card: {
      ...originalCard,
      id: tokenId,
      colors: ['W'],
      mana_cost: '',
      type_line: `${String(originalCard.type_line || '').trim()} Zombie`.trim(),
    },
  };
}

/**
 * Parse an embalm cost from oracle text.
 */
export function parseEmbalmCost(oracleText: string): string | null {
  return extractKeywordCost(oracleText, 'embalm');
}

/**
 * Multiple instances of embalm are not redundant
 * @param abilities - Array of embalm abilities
 * @returns False
 */
export function hasRedundantEmbalm(abilities: readonly EmbalmAbility[]): boolean {
  return false;
}
