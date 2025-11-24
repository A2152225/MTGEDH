/**
 * Rule 701.39: Bolster
 * 
 * "Bolster N" means "Choose a creature you control with the least toughness or
 * tied for least toughness among creatures you control. Put N +1/+1 counters on
 * that creature."
 * 
 * Reference: Rule 701.39
 */

export interface BolsterAction {
  readonly type: 'bolster';
  readonly playerId: string;
  readonly n: number; // Number of +1/+1 counters
  readonly targetCreatureId?: string; // Creature with least toughness
}

/**
 * Rule 701.39a: Bolster N
 * 
 * "Bolster N" means "Choose a creature you control with the least toughness or
 * tied for least toughness among creatures you control. Put N +1/+1 counters on
 * that creature."
 */
export function bolster(playerId: string, n: number): BolsterAction {
  return {
    type: 'bolster',
    playerId,
    n,
  };
}

/**
 * Complete bolster with chosen creature
 */
export function completeBolster(
  playerId: string,
  n: number,
  targetCreatureId: string
): BolsterAction {
  return {
    type: 'bolster',
    playerId,
    n,
    targetCreatureId,
  };
}

/**
 * Find creatures with least toughness
 */
export function findCreaturesWithLeastToughness(
  creatures: readonly { id: string; toughness: number }[]
): readonly string[] {
  if (creatures.length === 0) return [];
  
  const minToughness = Math.min(...creatures.map(c => c.toughness));
  return creatures
    .filter(c => c.toughness === minToughness)
    .map(c => c.id);
}

/**
 * Check if bolster can be performed
 */
export function canBolster(controlledCreatures: readonly unknown[]): boolean {
  return controlledCreatures.length > 0;
}

/**
 * Bolster result
 */
export interface BolsterResult {
  readonly bolstered: boolean;
  readonly creatureId: string | null;
  readonly countersAdded: number;
}

export function createBolsterResult(
  creatureId: string | null,
  n: number
): BolsterResult {
  return {
    bolstered: creatureId !== null,
    creatureId,
    countersAdded: creatureId !== null ? n : 0,
  };
}
