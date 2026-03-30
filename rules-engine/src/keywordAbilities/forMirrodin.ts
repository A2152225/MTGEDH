/**
 * For Mirrodin! keyword ability (Rule 702.163)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.163. For Mirrodin!
 * 702.163a For Mirrodin! is a triggered ability. "For Mirrodin!" means "When this Equipment 
 * enters, create a 2/2 red Rebel creature token, then attach this Equipment to it."
 */

export interface ForMirrodinAbility {
  readonly type: 'for-mirrodin';
  readonly source: string;
  readonly hasTriggered: boolean;
  readonly tokenId?: string;
}

export interface ForMirrodinSummary {
  readonly source: string;
  readonly enteredBattlefield: boolean;
  readonly shouldTrigger: boolean;
  readonly hasTriggered: boolean;
  readonly tokenId?: string;
}

export const FOR_MIRRODIN_REBEL_TOKEN = {
  name: 'Rebel',
  colors: ['R'] as string[],
  typeLine: 'Token Creature — Rebel',
  power: 2,
  toughness: 2,
};

/**
 * Create a For Mirrodin! ability
 * Rule 702.163a
 * @param source - The Equipment with For Mirrodin!
 * @returns For Mirrodin! ability object
 */
export function forMirrodin(source: string): ForMirrodinAbility {
  return {
    type: 'for-mirrodin',
    source,
    hasTriggered: false,
  };
}

/**
 * Trigger For Mirrodin! when Equipment enters
 * Rule 702.163a - Create 2/2 Rebel token, attach to it
 * @param ability - For Mirrodin! ability
 * @param tokenId - ID of created Rebel token
 * @returns Updated ability
 */
export function triggerForMirrodin(ability: ForMirrodinAbility, tokenId: string): ForMirrodinAbility {
  return {
    ...ability,
    hasTriggered: true,
    tokenId,
  };
}

/**
 * Get created Rebel token
 * @param ability - For Mirrodin! ability
 * @returns Token ID or undefined
 */
export function getForMirrodinToken(ability: ForMirrodinAbility): string | undefined {
  return ability.tokenId;
}

/**
 * For Mirrodin! triggers when the Equipment enters the battlefield.
 */
export function shouldTriggerForMirrodin(enteredBattlefield: boolean): boolean {
  return enteredBattlefield;
}

/**
 * Create the Rebel token associated with For Mirrodin!.
 */
export function createForMirrodinRebelToken(tokenId: string, controllerId: string): any {
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
    basePower: FOR_MIRRODIN_REBEL_TOKEN.power,
    baseToughness: FOR_MIRRODIN_REBEL_TOKEN.toughness,
    card: {
      id: tokenId,
      name: FOR_MIRRODIN_REBEL_TOKEN.name,
      type_line: FOR_MIRRODIN_REBEL_TOKEN.typeLine,
      oracle_text: '',
      colors: FOR_MIRRODIN_REBEL_TOKEN.colors,
      mana_cost: '',
      cmc: 0,
    },
  };
}

/**
 * Multiple instances of For Mirrodin! are not redundant
 * @param abilities - Array of For Mirrodin! abilities
 * @returns False
 */
export function hasRedundantForMirrodin(abilities: readonly ForMirrodinAbility[]): boolean {
  return false;
}

export function createForMirrodinSummary(
  ability: ForMirrodinAbility,
  enteredBattlefield: boolean,
): ForMirrodinSummary {
  return {
    source: ability.source,
    enteredBattlefield,
    shouldTrigger: shouldTriggerForMirrodin(enteredBattlefield),
    hasTriggered: ability.hasTriggered,
    tokenId: ability.tokenId,
  };
}
