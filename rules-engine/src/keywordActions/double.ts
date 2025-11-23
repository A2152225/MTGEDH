/**
 * Rule 701.10: Double
 * 
 * Doubling a creature's power and/or toughness, a player's life total,
 * the number of counters, mana in a mana pool, or damage.
 * 
 * Reference: Rule 701.10
 */

export interface DoubleAction {
  readonly type: 'double';
  readonly targetType: 'power' | 'toughness' | 'power-toughness' | 'life' | 'counters' | 'mana' | 'damage';
  readonly targetId: string;
  readonly counterType?: string; // For counter doubling
  readonly manaType?: string; // For mana doubling
}

/**
 * Rule 701.10a: Doubling creates a continuous effect
 * 
 * Doubling a creature's power and/or toughness creates a continuous effect.
 * This effect modifies that creature's power and/or toughness but doesn't set
 * those characteristics to a specific value.
 */
export function doublePowerToughness(
  creatureId: string,
  target: 'power' | 'toughness' | 'power-toughness'
): DoubleAction {
  return {
    type: 'double',
    targetType: target,
    targetId: creatureId,
  };
}

/**
 * Rule 701.10b: Calculating doubled power/toughness
 * 
 * To double a creature's power, that creature gets +X/+0, where X is that
 * creature's power as the spell or ability that doubles its power resolves.
 * Similarly for toughness and both.
 */
export function calculateDoubledStat(currentValue: number): number {
  // Rule 701.10c: If value is negative, doubling means -X instead
  if (currentValue < 0) {
    return currentValue; // Gets -X/-0 where X is difference from 0
  }
  return currentValue; // Gets +X/+0 where X is the current value
}

/**
 * Rule 701.10d: Double a player's life total
 * 
 * To double a player's life total, the player gains or loses an amount of life
 * such that their new life total is twice its current value.
 */
export function doubleLifeTotal(playerId: string): DoubleAction {
  return {
    type: 'double',
    targetType: 'life',
    targetId: playerId,
  };
}

/**
 * Rule 701.10e: Double counters
 * 
 * To double the number of a kind of counters on a player or permanent,
 * give that player or permanent as many of those counters as that player
 * or permanent already has.
 */
export function doubleCounters(
  targetId: string,
  counterType: string
): DoubleAction {
  return {
    type: 'double',
    targetType: 'counters',
    targetId,
    counterType,
  };
}

/**
 * Rule 701.10f: Double mana in mana pool
 * 
 * To double the amount of a type of mana in a player's mana pool, that player
 * adds an amount of mana of that type equal to the amount they already have.
 */
export function doubleMana(playerId: string, manaType: string): DoubleAction {
  return {
    type: 'double',
    targetType: 'mana',
    targetId: playerId,
    manaType,
  };
}

/**
 * Rule 701.10g: Double damage (replacement effect)
 * 
 * To double an amount of damage a source would deal, that source instead deals
 * twice that much damage. This is a replacement effect.
 */
export function doubleDamage(sourceId: string): DoubleAction {
  return {
    type: 'double',
    targetType: 'damage',
    targetId: sourceId,
  };
}
