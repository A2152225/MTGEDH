/**
 * Fortify keyword ability (Rule 702.67)
 * 
 * @module keywordAbilities/fortify
 */

/**
 * Represents a fortify ability on a Fortification permanent.
 * Rule 702.67: Fortify is an activated ability of Fortification cards. "Fortify [cost]" 
 * means "[Cost]: Attach this Fortification to target land you control. Activate only 
 * as a sorcery."
 */
export interface FortifyAbility {
  readonly type: 'fortify';
  readonly cost: string;
  readonly source: string;
  readonly attachedTo?: string;
}

/**
 * Creates a fortify ability.
 * 
 * @param source - The source Fortification with fortify
 * @param cost - The fortify cost
 * @returns A fortify ability
 * 
 * @example
 * ```typescript
 * const ability = fortify('Darksteel Garrison', '{3}');
 * ```
 */
export function fortify(source: string, cost: string): FortifyAbility {
  return {
    type: 'fortify',
    cost,
    source
  };
}

/**
 * Attaches the fortification to a land.
 * 
 * @param ability - The fortify ability
 * @param landId - ID of the land to fortify
 * @returns Updated ability
 */
export function attachFortification(ability: FortifyAbility, landId: string): FortifyAbility {
  return {
    ...ability,
    attachedTo: landId
  };
}

/**
 * Detaches the fortification.
 * 
 * @param ability - The fortify ability
 * @returns Updated ability
 */
export function detachFortification(ability: FortifyAbility): FortifyAbility {
  return {
    ...ability,
    attachedTo: undefined
  };
}

/**
 * Checks whether fortify can be activated under normal timing restrictions.
 * Fortify may be activated only as a sorcery while the Fortification is on the battlefield.
 *
 * @param ability - The fortify ability
 * @param zone - The fortification's current zone
 * @param isSorcerySpeed - Whether the player currently has sorcery-speed timing
 * @returns True if fortify can be activated now
 */
export function canActivateFortifyAbility(
  ability: FortifyAbility,
  zone: string,
  isSorcerySpeed: boolean
): boolean {
  return zone === 'battlefield' && isSorcerySpeed;
}

/**
 * Creates the attachment summary for a fortify activation.
 *
 * @param ability - The fortify ability
 * @param zone - The fortification's current zone
 * @param isSorcerySpeed - Whether the player currently has sorcery-speed timing
 * @param targetLand - The chosen land to fortify
 * @returns Attachment summary, or null if fortify cannot be activated now
 */
export function createFortifyAttachmentResult(
  ability: FortifyAbility,
  zone: string,
  isSorcerySpeed: boolean,
  targetLand?: string
): {
  source: string;
  attachedTo: string;
  costPaid: string;
} | null {
  if (!targetLand || !canActivateFortifyAbility(ability, zone, isSorcerySpeed)) {
    return null;
  }

  return {
    source: ability.source,
    attachedTo: targetLand,
    costPaid: ability.cost,
  };
}
