/**
 * Undaunted keyword ability (Rule 702.125)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.125. Undaunted
 * 702.125a Undaunted is a static ability that functions while the spell with undaunted is on 
 * the stack. Undaunted means "This spell costs {1} less to cast for each opponent you have."
 * 702.125b Players who have left the game are not counted when determining how many opponents 
 * you have.
 * 702.125c If a spell has multiple instances of undaunted, each of them applies.
 */

export interface UndauntedAbility {
  readonly type: 'undaunted';
  readonly source: string;
  readonly costReduction: number;
}

function tokenizeCost(cost: string): string[] {
  const raw = String(cost || '').trim();
  if (!raw) {
    return [];
  }

  const braced = [...raw.matchAll(/\{([^}]+)\}/g)].map((match) => String(match[1] || '').trim().toUpperCase()).filter(Boolean);
  if (braced.length > 0) {
    return braced;
  }

  const compact = raw.replace(/\s+/g, '').toUpperCase();
  const tokens: string[] = [];
  for (let index = 0; index < compact.length;) {
    if (/\d/.test(compact[index])) {
      let nextIndex = index + 1;
      while (nextIndex < compact.length && /\d/.test(compact[nextIndex])) {
        nextIndex += 1;
      }
      tokens.push(compact.slice(index, nextIndex));
      index = nextIndex;
      continue;
    }

    tokens.push(compact[index]);
    index += 1;
  }

  return tokens;
}

function formatCost(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    return '{0}';
  }

  return tokens.map((token) => `{${token}}`).join('');
}

/**
 * Create an undaunted ability
 * Rule 702.125a
 * @param source - The spell with undaunted
 * @returns Undaunted ability object
 */
export function undaunted(source: string): UndauntedAbility {
  return {
    type: 'undaunted',
    source,
    costReduction: 0,
  };
}

/**
 * Calculate cost reduction from undaunted
 * Rule 702.125a - Costs {1} less per opponent
 * @param numberOfOpponents - Number of opponents (excluding those who left)
 * @returns Cost reduction amount
 */
export function calculateUndauntedReduction(numberOfOpponents: number): number {
  return numberOfOpponents;
}

/**
 * Apply undaunted cost reduction
 * Rule 702.125a
 * @param ability - Undaunted ability
 * @param numberOfOpponents - Number of opponents
 * @returns Updated ability with cost reduction
 */
export function applyUndaunted(ability: UndauntedAbility, numberOfOpponents: number): UndauntedAbility {
  return {
    ...ability,
    costReduction: calculateUndauntedReduction(numberOfOpponents),
  };
}

/**
 * Get total cost reduction
 * @param ability - Undaunted ability
 * @returns Cost reduction amount
 */
export function getUndauntedReduction(ability: UndauntedAbility): number {
  return ability.costReduction;
}

/**
 * Reduce only generic mana in a cost by the undaunted amount.
 */
export function getReducedUndauntedCost(cost: string, reduction: number): string {
  const tokens = tokenizeCost(cost);
  let generic = 0;
  const nonGeneric: string[] = [];

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      generic += Number.parseInt(token, 10);
    } else {
      nonGeneric.push(token);
    }
  }

  const reducedGeneric = Math.max(0, generic - Math.max(0, reduction));
  return formatCost([
    ...(reducedGeneric > 0 ? [String(reducedGeneric)] : []),
    ...nonGeneric,
  ]);
}

/**
 * Count only opponents still in the game.
 */
export function countActiveOpponents(opponentsStillInGame: readonly boolean[]): number {
  return opponentsStillInGame.filter(Boolean).length;
}

/**
 * Multiple instances of undaunted each apply
 * Rule 702.125c
 * @param abilities - Array of undaunted abilities
 * @returns False - each instance applies
 */
export function hasRedundantUndaunted(abilities: readonly UndauntedAbility[]): boolean {
  return false; // Each instance applies separately
}
