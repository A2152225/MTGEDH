/**
 * Cipher keyword ability implementation
 * Rule 702.99 - "Cipher" means exile and encode on a creature, cast copy when it deals combat damage
 */

/**
 * Cipher ability - Rule 702.99
 * Allows encoding a spell onto a creature to cast copies when it deals combat damage
 */
export interface CipherAbility {
  readonly type: 'cipher';
  readonly source: string;
  readonly encodedOn?: string;
  readonly isEncoded: boolean;
}

/**
 * Creates a cipher ability
 * @param source - The spell with cipher
 * @returns Cipher ability
 */
export function cipher(source: string): CipherAbility {
  return {
    type: 'cipher',
    source,
    isEncoded: false,
  };
}

/**
 * Encodes the spell onto a creature
 * @param ability - The cipher ability
 * @param target - The creature to encode onto
 * @returns Updated cipher ability
 */
export function encodeOnCreature(ability: CipherAbility, target: string): CipherAbility {
  return {
    ...ability,
    encodedOn: target,
    isEncoded: true,
  };
}

/**
 * Triggers cipher when encoded creature deals combat damage
 * @param ability - The cipher ability
 * @returns Copy of the encoded spell
 */
export function triggerCipher(ability: CipherAbility): CipherAbility {
  if (!ability.isEncoded) {
    throw new Error('Spell is not encoded on a creature');
  }
  return ability;
}

/**
 * Checks if cipher is encoded
 * @param ability - The cipher ability
 * @returns True if the spell is encoded
 */
export function isEncoded(ability: CipherAbility): boolean {
  return ability.isEncoded;
}
