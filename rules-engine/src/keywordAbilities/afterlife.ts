/**
 * Afterlife keyword ability (Rule 702.135)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.135. Afterlife
 * 702.135a Afterlife is a triggered ability. "Afterlife N" means "When this permanent is put 
 * into a graveyard from the battlefield, create N 1/1 white and black Spirit creature tokens 
 * with flying."
 * 702.135b If a permanent has multiple instances of afterlife, each triggers separately.
 */

export interface AfterlifeAbility {
  readonly type: 'afterlife';
  readonly source: string;
  readonly afterlifeValue: number;
  readonly hasTriggered: boolean;
  readonly tokensCreated: readonly string[];
}

export interface AfterlifeSummary {
  readonly source: string;
  readonly afterlifeValue: number;
  readonly diesFromBattlefield: boolean;
  readonly canTrigger: boolean;
  readonly hasTriggered: boolean;
  readonly tokenCount: number;
}

export const AFTERLIFE_SPIRIT_TOKEN = {
  name: 'Spirit',
  colors: ['W', 'B'] as string[],
  typeLine: 'Token Creature — Spirit',
  power: 1,
  toughness: 1,
  oracleText: 'Flying',
};

function extractNumericKeywordValue(oracleText: string, keyword: string): number | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const pattern = new RegExp(`\\b${keyword}\\s+(\\d+)`, 'i');
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(String(match[1] || ''), 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Create an afterlife ability
 * Rule 702.135a
 * @param source - The permanent with afterlife
 * @param afterlifeValue - Number of Spirit tokens to create
 * @returns Afterlife ability object
 */
export function afterlife(source: string, afterlifeValue: number): AfterlifeAbility {
  return {
    type: 'afterlife',
    source,
    afterlifeValue,
    hasTriggered: false,
    tokensCreated: [],
  };
}

/**
 * Trigger afterlife when permanent dies
 * Rule 702.135a - Create N 1/1 Spirit tokens
 * @param ability - Afterlife ability
 * @param tokenIds - IDs of created Spirit tokens
 * @returns Updated ability
 */
export function triggerAfterlife(ability: AfterlifeAbility, tokenIds: readonly string[]): AfterlifeAbility {
  return {
    ...ability,
    hasTriggered: true,
    tokensCreated: tokenIds,
  };
}

/**
 * Get afterlife value (number of tokens)
 * @param ability - Afterlife ability
 * @returns Number of Spirit tokens to create
 */
export function getAfterlifeValue(ability: AfterlifeAbility): number {
  return ability.afterlifeValue;
}

/**
 * Get created Spirit tokens
 * @param ability - Afterlife ability
 * @returns IDs of Spirit tokens
 */
export function getAfterlifeTokens(ability: AfterlifeAbility): readonly string[] {
  return ability.tokensCreated;
}

/**
 * Check if afterlife has triggered.
 */
export function hasTriggeredAfterlife(ability: AfterlifeAbility): boolean {
  return ability.hasTriggered;
}

/**
 * Afterlife triggers only when the permanent dies from the battlefield.
 */
export function shouldTriggerAfterlife(diedFromBattlefield: boolean): boolean {
  return diedFromBattlefield;
}

/**
 * Create the Spirit tokens used by afterlife.
 */
export function createAfterlifeSpiritTokens(controllerId: string, tokenIds: readonly string[]): readonly any[] {
  return tokenIds.map((tokenId) => ({
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: true,
    counters: {},
    attachments: [],
    modifiers: [],
    isToken: true,
    basePower: AFTERLIFE_SPIRIT_TOKEN.power,
    baseToughness: AFTERLIFE_SPIRIT_TOKEN.toughness,
    card: {
      id: tokenId,
      name: AFTERLIFE_SPIRIT_TOKEN.name,
      type_line: AFTERLIFE_SPIRIT_TOKEN.typeLine,
      oracle_text: AFTERLIFE_SPIRIT_TOKEN.oracleText,
      colors: AFTERLIFE_SPIRIT_TOKEN.colors,
      mana_cost: '',
      cmc: 0,
    },
  }));
}

/**
 * Parse an afterlife value from oracle text.
 */
export function parseAfterlifeValue(oracleText: string): number | null {
  return extractNumericKeywordValue(oracleText, 'afterlife');
}

/**
 * Multiple instances of afterlife trigger separately
 * Rule 702.135b
 * @param abilities - Array of afterlife abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantAfterlife(abilities: readonly AfterlifeAbility[]): boolean {
  return false; // Each instance triggers separately
}

export function createAfterlifeSummary(
  ability: AfterlifeAbility,
  diedFromBattlefield: boolean,
): AfterlifeSummary {
  return {
    source: ability.source,
    afterlifeValue: ability.afterlifeValue,
    diesFromBattlefield: diedFromBattlefield,
    canTrigger: shouldTriggerAfterlife(diedFromBattlefield),
    hasTriggered: ability.hasTriggered,
    tokenCount: ability.tokensCreated.length,
  };
}
