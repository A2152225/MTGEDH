/**
 * Encore keyword ability (Rule 702.141)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.141. Encore
 * 702.141a Encore is an activated ability that functions while the card with encore is in a 
 * graveyard. "Encore [cost]" means "[Cost], Exile this card from your graveyard: For each 
 * opponent, create a token that's a copy of this card that attacks that opponent this turn if 
 * able. The tokens gain haste. Sacrifice them at the beginning of the next end step. Activate 
 * only as a sorcery."
 */

export interface EncoreAbility {
  readonly type: 'encore';
  readonly source: string;
  readonly encoreCost: string;
  readonly hasBeenEncored: boolean;
  readonly tokenIds: readonly string[];
}

export interface EncoreSummary {
  readonly source: string;
  readonly canActivate: boolean;
  readonly encoreCost: string;
  readonly hasBeenEncored: boolean;
  readonly tokenCount: number;
  readonly opponentCount: number;
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
 * Create an encore ability
 * Rule 702.141a
 * @param source - The card with encore
 * @param encoreCost - Cost to activate encore
 * @returns Encore ability object
 */
export function encore(source: string, encoreCost: string): EncoreAbility {
  return {
    type: 'encore',
    source,
    encoreCost,
    hasBeenEncored: false,
    tokenIds: [],
  };
}

/**
 * Activate encore from graveyard
 * Rule 702.141a - Create token copies that attack each opponent
 * @param ability - Encore ability
 * @param tokenIds - IDs of created tokens (one per opponent)
 * @returns Updated ability
 */
export function activateEncore(ability: EncoreAbility, tokenIds: readonly string[]): EncoreAbility {
  return {
    ...ability,
    hasBeenEncored: true,
    tokenIds,
  };
}

/**
 * Check if encore has been activated
 * @param ability - Encore ability
 * @returns True if encore was activated
 */
export function hasBeenEncored(ability: EncoreAbility): boolean {
  return ability.hasBeenEncored;
}

/**
 * Get encore tokens
 * Rule 702.141a - Tokens must attack, have haste, and are sacrificed at end step
 * @param ability - Encore ability
 * @returns IDs of encore tokens
 */
export function getEncoreTokens(ability: EncoreAbility): readonly string[] {
  return ability.tokenIds;
}

/**
 * Get encore cost
 * @param ability - Encore ability
 * @returns Encore cost string
 */
export function getEncoreCost(ability: EncoreAbility): string {
  return ability.encoreCost;
}

/**
 * Encore can only be activated from the graveyard at sorcery speed and only if opponents exist.
 */
export function canActivateEncore(zone: string, isSorcerySpeed: boolean, opponentCount: number): boolean {
  return String(zone || '').trim().toLowerCase() === 'graveyard' && isSorcerySpeed && opponentCount > 0;
}

/**
 * Pair each encore token with the opponent it must attack if able.
 */
export function getEncoreAttackAssignments(
  opponentIds: readonly string[],
  tokenIds: readonly string[],
): Record<string, string> {
  const assignments: Record<string, string> = {};
  opponentIds.forEach((opponentId, index) => {
    const tokenId = tokenIds[index];
    if (opponentId && tokenId) {
      assignments[opponentId] = tokenId;
    }
  });
  return assignments;
}

/**
 * Parse an encore cost from oracle text.
 */
export function parseEncoreCost(oracleText: string): string | null {
  return extractKeywordCost(oracleText, 'encore');
}

/**
 * Multiple instances of encore are not redundant
 * @param abilities - Array of encore abilities
 * @returns False
 */
export function hasRedundantEncore(abilities: readonly EncoreAbility[]): boolean {
  return false;
}

export function createEncoreSummary(
  ability: EncoreAbility,
  zone: string,
  isSorcerySpeed: boolean,
  opponentCount: number,
): EncoreSummary {
  return {
    source: ability.source,
    canActivate: canActivateEncore(zone, isSorcerySpeed, opponentCount),
    encoreCost: ability.encoreCost,
    hasBeenEncored: ability.hasBeenEncored,
    tokenCount: ability.tokenIds.length,
    opponentCount,
  };
}
