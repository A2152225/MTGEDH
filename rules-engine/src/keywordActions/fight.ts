/**
 * Rule 701.14: Fight
 * 
 * A spell or ability may instruct a creature to fight another creature or it may
 * instruct two creatures to fight each other. Each of those creatures deals damage
 * equal to its power to the other creature.
 * 
 * Reference: Rule 701.14
 */

export interface FightAction {
  readonly type: 'fight';
  readonly creatureA: string;
  readonly creatureB: string;
}

/**
 * Rule 701.14a: Each creature deals damage equal to its power
 * 
 * A spell or ability may instruct a creature to fight another creature or it may
 * instruct two creatures to fight each other. Each of those creatures deals damage
 * equal to its power to the other creature.
 */
export function fightCreatures(creatureA: string, creatureB: string): FightAction {
  return {
    type: 'fight',
    creatureA,
    creatureB,
  };
}

/**
 * Rule 701.14b: Invalid fight targets
 * 
 * If one or both creatures instructed to fight are no longer on the battlefield
 * or are no longer creatures, neither of them fights or deals damage.
 */
export function canFight(
  creatureA: { onBattlefield: boolean; isCreature: boolean } | null,
  creatureB: { onBattlefield: boolean; isCreature: boolean } | null
): boolean {
  if (!creatureA || !creatureB) return false;
  return (
    creatureA.onBattlefield &&
    creatureA.isCreature &&
    creatureB.onBattlefield &&
    creatureB.isCreature
  );
}

/**
 * Rule 701.14c: Fighting itself
 * 
 * If a creature fights itself, it deals damage to itself equal to twice its power.
 */
export function fightSelf(creatureId: string): FightAction {
  return {
    type: 'fight',
    creatureA: creatureId,
    creatureB: creatureId,
  };
}

/**
 * Rule 701.14d: Fight damage is not combat damage
 * 
 * The damage dealt when a creature fights isn't combat damage.
 */
export const FIGHT_DAMAGE_IS_NOT_COMBAT = true;
