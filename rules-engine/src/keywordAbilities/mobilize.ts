/**
 * Mobilize keyword ability (Rule 702.181)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.181. Mobilize
 * 702.181a Mobilize is a triggered ability. "Mobilize N" means "Whenever this creature attacks, 
 * create N 1/1 red Warrior creature tokens. Those tokens enter tapped and attacking. Sacrifice 
 * them at the beginning of the next end step."
 */

import type { BattlefieldPermanent, PlayerID } from '../../../shared/src';

export interface MobilizeAbility {
  readonly type: 'mobilize';
  readonly source: string;
  readonly mobilizeValue: number; // Number of tokens to create
  readonly tokenIds: readonly string[];
}

/**
 * Token characteristics for Mobilize Warrior tokens
 */
export const MOBILIZE_WARRIOR_TOKEN = {
  name: 'Warrior',
  colors: ['R'],
  types: ['Creature'],
  subtypes: ['Warrior'],
  power: 1,
  toughness: 1,
  abilities: [],
  entersTapped: true,
  entersAttacking: true,
  sacrificeAtEndStep: true,
};

/**
 * Create a mobilize ability
 * Rule 702.181a
 * @param source - The creature with mobilize
 * @param mobilizeValue - Number of Warrior tokens to create
 * @returns Mobilize ability object
 */
export function mobilize(source: string, mobilizeValue: number): MobilizeAbility {
  return {
    type: 'mobilize',
    source,
    mobilizeValue,
    tokenIds: [],
  };
}

/**
 * Simple UUID generator for token IDs
 */
function generateTokenId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Result of executing mobilize
 */
export interface MobilizeResult {
  readonly ability: MobilizeAbility;
  readonly tokens: BattlefieldPermanent[];
  readonly log: string;
}

/**
 * Execute mobilize when attacking - creates Warrior tokens that enter tapped and attacking
 * Rule 702.181a - Create tokens that enter tapped and attacking
 * @param source - The creature with mobilize
 * @param mobilizeValue - Number of Warrior tokens to create
 * @param controllerId - The player who controls the attacking creature
 * @returns Updated ability with tokens and the token permanents
 */
export function executeMobilize(
  source: string,
  mobilizeValue: number,
  controllerId: PlayerID
): MobilizeResult {
  const tokens: BattlefieldPermanent[] = [];
  const tokenIds: string[] = [];
  
  for (let i = 0; i < mobilizeValue; i++) {
    const tokenId = `token-${generateTokenId()}`;
    tokenIds.push(tokenId);
    
    const token: BattlefieldPermanent = {
      id: tokenId,
      controller: controllerId,
      owner: controllerId,
      tapped: true, // Enters tapped
      summoningSickness: false, // Attacking, so effectively no summoning sickness
      counters: {},
      attachedTo: undefined,
      attachments: [],
      modifiers: [],
      card: {
        id: tokenId,
        name: 'Warrior',
        type_line: 'Token Creature — Warrior',
        oracle_text: '',
        colors: ['R'],
        mana_cost: '',
        cmc: 0,
      } as any,
      basePower: 1,
      baseToughness: 1,
      isToken: true,
      // Mark for sacrifice at end step
      sacrificeAtEndStep: true,
      // Mark as attacking
      isAttacking: true,
    };
    
    tokens.push(token);
  }
  
  const ability: MobilizeAbility = {
    type: 'mobilize',
    source,
    mobilizeValue,
    tokenIds,
  };
  
  return {
    ability,
    tokens,
    log: `Mobilize ${mobilizeValue}: Created ${mobilizeValue} 1/1 red Warrior token${mobilizeValue !== 1 ? 's' : ''} tapped and attacking.`,
  };
}

/**
 * Trigger mobilize when attacking
 * Rule 702.181a - Create tokens that enter tapped and attacking
 * @param ability - Mobilize ability
 * @param tokenIds - IDs of created Warrior tokens
 * @returns Updated ability
 */
export function triggerMobilize(ability: MobilizeAbility, tokenIds: readonly string[]): MobilizeAbility {
  return {
    ...ability,
    tokenIds,
  };
}

/**
 * Get mobilize tokens
 * @param ability - Mobilize ability
 * @returns IDs of Warrior tokens
 */
export function getMobilizeTokens(ability: MobilizeAbility): readonly string[] {
  return ability.tokenIds;
}

/**
 * Get mobilize value
 * @param ability - Mobilize ability
 * @returns Number of tokens to create
 */
export function getMobilizeValue(ability: MobilizeAbility): number {
  return ability.mobilizeValue;
}

/**
 * Multiple instances of mobilize are not redundant
 * @param abilities - Array of mobilize abilities
 * @returns False
 */
export function hasRedundantMobilize(abilities: readonly MobilizeAbility[]): boolean {
  return false;
}

/**
 * Parse mobilize value from oracle text
 * @param oracleText - The oracle text of a card
 * @returns The mobilize value, or null if not found
 */
export function parseMobilizeValue(oracleText: string): number | null {
  const match = oracleText.match(/mobilize\s+(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}
