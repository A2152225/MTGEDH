/**
 * Reconfigure keyword ability (Rule 702.151)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.151. Reconfigure
 * 702.151a Reconfigure represents two activated abilities. Reconfigure [cost] means "[Cost]: 
 * Attach this permanent to another target creature you control. Activate only as a sorcery" and 
 * "[Cost]: Unattach this permanent. Activate only if this permanent is attached to a creature 
 * and only as a sorcery."
 * 702.151b Attaching an Equipment with reconfigure to another creature causes the Equipment to 
 * stop being a creature until it becomes unattached from that creature.
 */

export interface ReconfigureAbility {
  readonly type: 'reconfigure';
  readonly source: string;
  readonly reconfigureCost: string;
  readonly isAttached: boolean;
  readonly attachedTo?: string;
  readonly isCreature: boolean;
}

export interface ReconfigureSummary {
  readonly source: string;
  readonly reconfigureCost: string;
  readonly attachedTo?: string;
  readonly isCreature: boolean;
  readonly canAttach: boolean;
  readonly canUnattach: boolean;
}

function extractKeywordCost(oracleText: string, keyword: string): string | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const pattern = new RegExp(`\\b${keyword}\\s+([^.;,()]+)`, 'i');
  const match = normalized.match(pattern);
  if (!match) {
    return null;
  }

  const cost = String(match[1] || '').trim();
  return cost || null;
}

/**
 * Create a reconfigure ability
 * Rule 702.151a
 * @param source - The Equipment with reconfigure
 * @param reconfigureCost - Cost to attach or unattach
 * @returns Reconfigure ability object
 */
export function reconfigure(source: string, reconfigureCost: string): ReconfigureAbility {
  return {
    type: 'reconfigure',
    source,
    reconfigureCost,
    isAttached: false,
    isCreature: true,
  };
}

/**
 * Attach Equipment with reconfigure to a creature
 * Rule 702.151a - Activate only as a sorcery
 * Rule 702.151b - Stops being a creature when attached
 * @param ability - Reconfigure ability
 * @param targetCreature - ID of creature to attach to
 * @returns Updated ability
 */
export function attachWithReconfigure(
  ability: ReconfigureAbility,
  targetCreature: string
): ReconfigureAbility {
  return {
    ...ability,
    isAttached: true,
    attachedTo: targetCreature,
    isCreature: false,
  };
}

/**
 * Unattach Equipment with reconfigure
 * Rule 702.151a - Becomes a creature again when unattached
 * @param ability - Reconfigure ability
 * @returns Updated ability
 */
export function unattachWithReconfigure(ability: ReconfigureAbility): ReconfigureAbility {
  return {
    ...ability,
    isAttached: false,
    attachedTo: undefined,
    isCreature: true,
  };
}

/**
 * Check if Equipment is a creature
 * Rule 702.151b
 * @param ability - Reconfigure ability
 * @returns True if is a creature (not attached)
 */
export function isReconfigureCreature(ability: ReconfigureAbility): boolean {
  return ability.isCreature && !ability.isAttached;
}

/**
 * Get reconfigure cost
 * @param ability - Reconfigure ability
 * @returns Reconfigure cost string
 */
export function getReconfigureCost(ability: ReconfigureAbility): string {
  return ability.reconfigureCost;
}

/**
 * Reconfigure attach can only happen as a sorcery onto another creature you control.
 */
export function canAttachWithReconfigure(
  targetCreatureId: string,
  sourceId: string,
  isSorcerySpeed: boolean,
): boolean {
  return isSorcerySpeed && String(targetCreatureId || '') !== '' && String(targetCreatureId) !== String(sourceId || '');
}

/**
 * Reconfigure unattach can only happen as a sorcery while attached.
 */
export function canUnattachWithReconfigure(ability: ReconfigureAbility, isSorcerySpeed: boolean): boolean {
  return isSorcerySpeed && ability.isAttached;
}

/**
 * Return the creature currently attached by reconfigure.
 */
export function getReconfigureAttachedTo(ability: ReconfigureAbility): string | undefined {
  return ability.attachedTo;
}

/**
 * Parse a reconfigure cost from oracle text.
 */
export function parseReconfigureCost(oracleText: string): string | null {
  return extractKeywordCost(oracleText, 'reconfigure');
}

/**
 * Multiple instances of reconfigure are not redundant
 * @param abilities - Array of reconfigure abilities
 * @returns False
 */
export function hasRedundantReconfigure(abilities: readonly ReconfigureAbility[]): boolean {
  return false;
}

export function createReconfigureSummary(
  ability: ReconfigureAbility,
  targetCreatureId: string,
  isSorcerySpeed: boolean,
): ReconfigureSummary {
  return {
    source: ability.source,
    reconfigureCost: ability.reconfigureCost,
    attachedTo: ability.attachedTo,
    isCreature: ability.isCreature,
    canAttach: canAttachWithReconfigure(targetCreatureId, ability.source, isSorcerySpeed),
    canUnattach: canUnattachWithReconfigure(ability, isSorcerySpeed),
  };
}
