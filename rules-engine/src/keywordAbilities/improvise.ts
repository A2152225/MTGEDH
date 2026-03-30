/**
 * Improvise keyword ability (Rule 702.126)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.126. Improvise
 * 702.126a Improvise is a static ability that functions while the spell with improvise is on 
 * the stack. "Improvise" means "For each generic mana in this spell's total cost, you may tap 
 * an untapped artifact you control rather than pay that mana."
 * 702.126b The improvise ability isn't an additional or alternative cost and applies only after 
 * the total cost of the spell with improvise is determined.
 * 702.126c Multiple instances of improvise on the same spell are redundant.
 */

export interface ImproviseAbility {
  readonly type: 'improvise';
  readonly source: string;
  readonly artifactsTapped: readonly string[];
}

export interface ImproviseSummary {
  readonly source: string;
  readonly tappedArtifactCount: number;
  readonly manaValue: number;
  readonly reducedCost: string;
}

type ImproviseArtifactLike = {
  readonly controller?: string;
  readonly tapped?: boolean;
  readonly isTapped?: boolean;
  readonly type_line?: string;
  readonly card?: {
    readonly type_line?: string;
  };
};

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

function isArtifactLike(candidate: ImproviseArtifactLike): boolean {
  const typeLine = String(candidate.type_line || candidate.card?.type_line || '').toLowerCase();
  return typeLine.includes('artifact');
}

/**
 * Create an improvise ability
 * Rule 702.126a
 * @param source - The spell with improvise
 * @returns Improvise ability object
 */
export function improvise(source: string): ImproviseAbility {
  return {
    type: 'improvise',
    source,
    artifactsTapped: [],
  };
}

/**
 * Tap artifacts to pay for spell with improvise
 * Rule 702.126a - Each artifact pays for {1}
 * @param ability - Improvise ability
 * @param artifactIds - IDs of artifacts to tap
 * @returns Updated ability
 */
export function tapArtifactsForImprovise(
  ability: ImproviseAbility,
  artifactIds: readonly string[]
): ImproviseAbility {
  return {
    ...ability,
    artifactsTapped: artifactIds,
  };
}

/**
 * Get artifacts tapped for improvise
 * @param ability - Improvise ability
 * @returns IDs of tapped artifacts
 */
export function getImprovisedArtifacts(ability: ImproviseAbility): readonly string[] {
  return ability.artifactsTapped;
}

/**
 * Calculate mana paid via improvise
 * Rule 702.126a - Each artifact pays for {1} generic mana
 * @param ability - Improvise ability
 * @returns Amount of generic mana paid
 */
export function getImproviseManaValue(ability: ImproviseAbility): number {
  return ability.artifactsTapped.length;
}

/**
 * Check whether an artifact can be tapped to pay improvise.
 */
export function canTapForImprovise(candidate: ImproviseArtifactLike, controllerId: string): boolean {
  const isTapped = candidate.tapped === true || candidate.isTapped === true;
  return String(candidate.controller || '') === String(controllerId || '') && !isTapped && isArtifactLike(candidate);
}

/**
 * Reduce only generic mana in a cost by the improvise contribution.
 */
export function getImprovisedCost(cost: string, tappedArtifacts: number): string {
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

  const reducedGeneric = Math.max(0, generic - Math.max(0, tappedArtifacts));
  return formatCost([
    ...(reducedGeneric > 0 ? [String(reducedGeneric)] : []),
    ...nonGeneric,
  ]);
}

/**
 * Multiple instances of improvise are redundant
 * Rule 702.126c
 * @param abilities - Array of improvise abilities
 * @returns True if more than one instance
 */
export function hasRedundantImprovise(abilities: readonly ImproviseAbility[]): boolean {
  return abilities.length > 1;
}

export function createImproviseSummary(ability: ImproviseAbility, originalCost: string): ImproviseSummary {
  return {
    source: ability.source,
    tappedArtifactCount: ability.artifactsTapped.length,
    manaValue: getImproviseManaValue(ability),
    reducedCost: getImprovisedCost(originalCost, ability.artifactsTapped.length),
  };
}
