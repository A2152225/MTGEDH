/**
 * Scavenge keyword ability implementation
 * Rule 702.97 - "Scavenge" means exile this card from your graveyard and put counters on a creature
 */

/**
 * Scavenge ability - Rule 702.97
 * Allows exiling a creature card from graveyard to add +1/+1 counters
 */
export interface ScavengeAbility {
  readonly type: 'scavenge';
  readonly source: string;
  readonly scavengeCost: string;
  readonly powerToughness: readonly [number, number];
  readonly wasScavenged: boolean;
}

export interface ScavengeResolution {
  readonly source: string;
  readonly target: string;
  readonly countersAdded: number;
  readonly exiledFromGraveyard: boolean;
}

/**
 * Creates a scavenge ability.
 */
export function scavenge(
  source: string,
  scavengeCost: string,
  powerToughness: readonly [number, number]
): ScavengeAbility {
  return {
    type: 'scavenge',
    source,
    scavengeCost,
    powerToughness,
    wasScavenged: false,
  };
}

/**
 * Activates scavenge, exiling the card and adding counters.
 */
export function activateScavenge(ability: ScavengeAbility, target: string): ScavengeAbility {
  if (ability.wasScavenged) {
    throw new Error('Card has already been scavenged');
  }

  return {
    ...ability,
    wasScavenged: true,
  };
}

/**
 * Scavenge can be activated only from the graveyard, at sorcery speed, targeting a creature.
 */
export function canActivateScavenge(
  zone: 'graveyard' | 'hand' | 'battlefield' | 'exile',
  isSorcerySpeed: boolean,
  targetIsCreature: boolean
): boolean {
  return zone === 'graveyard' && isSorcerySpeed && targetIsCreature;
}

/**
 * Gets the number of +1/+1 counters to add.
 */
export function getScavengeCounters(ability: ScavengeAbility): number {
  return ability.powerToughness[0];
}

export function createScavengeResolution(
  ability: ScavengeAbility,
  target: string
): ScavengeResolution {
  return {
    source: ability.source,
    target,
    countersAdded: getScavengeCounters(ability),
    exiledFromGraveyard: true,
  };
}
