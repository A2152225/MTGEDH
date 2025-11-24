/**
 * Rule 701.21: Sacrifice
 * 
 * To sacrifice a permanent, its controller moves it from the battlefield directly
 * to its owner's graveyard. A player can't sacrifice something that isn't a
 * permanent, or something that's a permanent they don't control.
 * 
 * Reference: Rule 701.21
 */

export interface SacrificeAction {
  readonly type: 'sacrifice';
  readonly permanentId: string;
  readonly controllerId: string;
}

/**
 * Rule 701.21a: Move from battlefield to graveyard
 * 
 * To sacrifice a permanent, its controller moves it from the battlefield directly
 * to its owner's graveyard.
 */
export function sacrificePermanent(
  permanentId: string,
  controllerId: string
): SacrificeAction {
  return {
    type: 'sacrifice',
    permanentId,
    controllerId,
  };
}

/**
 * Rule 701.21b: Sacrifice restrictions
 * 
 * A player can't sacrifice something that isn't a permanent, or something that's
 * a permanent they don't control. Some effects offer a player a choice to
 * sacrifice a permanent and perform some action only if they do. That player
 * can't choose to perform the action if they have nothing to sacrifice.
 */
export function canSacrifice(
  permanent: { id: string; controllerId: string } | null,
  playerId: string
): boolean {
  if (!permanent) return false;
  return permanent.controllerId === playerId;
}

/**
 * Rule 701.21c: Sacrifice is not destruction
 * 
 * Sacrificing a permanent doesn't destroy it, so regeneration or other effects
 * that replace destruction can't affect this action.
 */
export const SACRIFICE_IS_NOT_DESTRUCTION = true;

/**
 * Rule 701.21d: Sacrifice and state-based actions
 * 
 * If a permanent that's being sacrificed has indestructible, it's still
 * sacrificed. Indestructible only prevents destruction, not sacrifice.
 */
export function canBeSacrificed(hasIndestructible: boolean): boolean {
  return true; // Indestructible doesn't prevent sacrifice
}
