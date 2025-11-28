/**
 * Phasing keyword ability implementation
 * Rule 702.26
 * 
 * Phasing is a static ability that modifies the rules of the untap step.
 * Permanents with phasing phase out at the beginning of their controller's
 * untap step, and phased-out permanents phase back in.
 */

/**
 * Phasing ability
 * Rule 702.26a
 * 
 * During each player's untap step, before the active player untaps permanents,
 * all phased-in permanents with phasing that player controls phase out.
 * All phased-out permanents that had phased out under that player's control phase in.
 */
export interface PhasingAbility {
  readonly type: 'phasing';
  readonly source: string;
  readonly phasedOut: boolean;
  readonly phasedOutBy?: 'phasing' | 'effect'; // How it was phased out
  readonly phasedOutControllerId?: string; // Who controlled when phased out
}

/**
 * State of a phased-out permanent
 * Rule 702.26b - Phased-out permanents are treated as though they don't exist
 */
export interface PhasedOutState {
  readonly permanentId: string;
  readonly controllerId: string;
  readonly phasedOutAt: number;
  readonly phasedOutBy: 'phasing' | 'effect';
  readonly attachedPermanentIds: readonly string[]; // Auras/Equipment that phase out indirectly
  readonly counters: Record<string, number>; // Preserved counters
  readonly wasTapped: boolean;
}

/**
 * Result of phasing event
 */
export interface PhasingEventResult {
  readonly permanentId: string;
  readonly phasedIn: boolean;
  readonly phasedOut: boolean;
  readonly indirectlyPhased: readonly string[]; // Attached permanents
  readonly wasTriggered: boolean; // Whether "phases in/out" triggers should fire
}

/**
 * Creates a phasing ability
 * Rule 702.26a
 * 
 * @param source - The permanent with phasing
 * @returns Phasing ability
 */
export function phasing(source: string): PhasingAbility {
  return {
    type: 'phasing',
    source,
    phasedOut: false,
  };
}

/**
 * Phases a permanent out
 * Rule 702.26b - A phased-out permanent is treated as though it doesn't exist
 * 
 * @param ability - The phasing ability
 * @param phasedOutBy - What caused the phase out (keyword or effect)
 * @param controllerId - Controller when phased out
 * @returns Updated ability with phased out state
 */
export function phaseOut(
  ability: PhasingAbility,
  phasedOutBy: 'phasing' | 'effect' = 'phasing',
  controllerId?: string
): PhasingAbility {
  return {
    ...ability,
    phasedOut: true,
    phasedOutBy,
    phasedOutControllerId: controllerId,
  };
}

/**
 * Phases a permanent in
 * Rule 702.26c - When a permanent phases in, the game treats it as existing again
 * 
 * @param ability - The phasing ability
 * @returns Updated ability with phased in state
 */
export function phaseIn(ability: PhasingAbility): PhasingAbility {
  return {
    ...ability,
    phasedOut: false,
    phasedOutBy: undefined,
    phasedOutControllerId: undefined,
  };
}

/**
 * Checks if phased-out permanent is treated as non-existent
 * Rule 702.26d - A phased-out permanent is treated as though it doesn't exist
 * 
 * @param ability - The phasing ability
 * @returns True if permanent is phased out
 */
export function isPhasedOut(ability: PhasingAbility): boolean {
  return ability.phasedOut;
}

/**
 * Creates phased-out state record for a permanent
 * Rule 702.26e - Phased-out permanents preserve their state
 * 
 * @param permanentId - The permanent phasing out
 * @param controllerId - Current controller
 * @param phasedOutBy - How it phased out
 * @param attachedPermanentIds - Attached permanents (also phase out indirectly)
 * @param counters - Counters on the permanent
 * @param wasTapped - Whether the permanent was tapped
 * @returns Phased-out state record
 */
export function createPhasedOutState(
  permanentId: string,
  controllerId: string,
  phasedOutBy: 'phasing' | 'effect',
  attachedPermanentIds: readonly string[] = [],
  counters: Record<string, number> = {},
  wasTapped: boolean = false
): PhasedOutState {
  return {
    permanentId,
    controllerId,
    phasedOutAt: Date.now(),
    phasedOutBy,
    attachedPermanentIds,
    counters,
    wasTapped,
  };
}

/**
 * Gets permanents that should phase out indirectly
 * Rule 702.26e - Auras, Equipment, and Fortifications attached to a phasing permanent phase out indirectly
 * 
 * @param permanentId - The permanent phasing out
 * @param attachedPermanents - All permanents attached to this one
 * @returns IDs of permanents that phase out indirectly
 */
export function getIndirectlyPhasingPermanents(
  permanentId: string,
  attachedPermanents: readonly { id: string; attachedTo: string }[]
): string[] {
  return attachedPermanents
    .filter(p => p.attachedTo === permanentId)
    .map(p => p.id);
}

/**
 * Checks if a permanent should phase in during untap step
 * Rule 702.26a - Phased-out permanents phase in if they phased out under that player's control
 * 
 * @param phasedOutState - State of the phased-out permanent
 * @param activePlayerId - Current active player
 * @returns Whether the permanent should phase in
 */
export function shouldPhaseIn(
  phasedOutState: PhasedOutState,
  activePlayerId: string
): boolean {
  // Phases in during its controller's untap step
  return phasedOutState.controllerId === activePlayerId;
}

/**
 * Checks if a permanent with phasing should phase out during untap step
 * Rule 702.26a - Phased-in permanents with phasing phase out during untap step
 * 
 * @param ability - The phasing ability
 * @param controllerId - Current controller
 * @param activePlayerId - Active player
 * @returns Whether the permanent should phase out
 */
export function shouldPhaseOut(
  ability: PhasingAbility,
  controllerId: string,
  activePlayerId: string
): boolean {
  // Must be phased in, have phasing, and be during controller's untap step
  return !ability.phasedOut && controllerId === activePlayerId;
}

/**
 * Processes the untap step phasing events
 * Rule 702.26a - All phasing happens simultaneously before untapping
 * 
 * @param permanentsWithPhasing - Permanents with the phasing ability
 * @param phasedOutPermanents - Currently phased-out permanents
 * @param activePlayerId - The active player
 * @returns Results of all phasing events
 */
export function processUntapStepPhasing(
  permanentsWithPhasing: readonly {
    id: string;
    controllerId: string;
    ability: PhasingAbility;
    attachedPermanentIds: readonly string[];
    counters: Record<string, number>;
    tapped: boolean;
  }[],
  phasedOutPermanents: readonly PhasedOutState[],
  activePlayerId: string
): PhasingEventResult[] {
  const results: PhasingEventResult[] = [];
  
  // First, determine which permanents should phase out
  for (const perm of permanentsWithPhasing) {
    if (shouldPhaseOut(perm.ability, perm.controllerId, activePlayerId)) {
      const indirectlyPhased = perm.attachedPermanentIds;
      
      results.push({
        permanentId: perm.id,
        phasedIn: false,
        phasedOut: true,
        indirectlyPhased,
        wasTriggered: true,
      });
      
      // Add indirectly phasing permanents
      for (const attachedId of indirectlyPhased) {
        results.push({
          permanentId: attachedId,
          phasedIn: false,
          phasedOut: true,
          indirectlyPhased: [],
          wasTriggered: false, // Indirect phasing doesn't trigger
        });
      }
    }
  }
  
  // Then, determine which permanents should phase in
  for (const phasedOut of phasedOutPermanents) {
    if (shouldPhaseIn(phasedOut, activePlayerId)) {
      results.push({
        permanentId: phasedOut.permanentId,
        phasedIn: true,
        phasedOut: false,
        indirectlyPhased: phasedOut.attachedPermanentIds,
        wasTriggered: true,
      });
      
      // Add indirectly phasing-in permanents
      for (const attachedId of phasedOut.attachedPermanentIds) {
        results.push({
          permanentId: attachedId,
          phasedIn: true,
          phasedOut: false,
          indirectlyPhased: [],
          wasTriggered: false, // Indirect phasing doesn't trigger
        });
      }
    }
  }
  
  return results;
}

/**
 * Checks if a permanent is visible (not phased out)
 * Rule 702.26d - Phased-out permanents are treated as though they don't exist
 * 
 * @param ability - The phasing ability (if any)
 * @param phasedOutState - Phased-out state (if any)
 * @returns Whether the permanent should be treated as existing
 */
export function permanentExists(
  ability: PhasingAbility | undefined,
  phasedOutState: PhasedOutState | undefined
): boolean {
  if (ability?.phasedOut) return false;
  if (phasedOutState) return false;
  return true;
}

/**
 * Checks if phasing triggers should fire
 * Rule 702.26f - When a permanent phases in, abilities that trigger "when it enters" don't trigger
 * 
 * @param eventType - 'phases_in' or 'phases_out'
 * @param wasIndirect - Whether the phasing was indirect (attached permanent)
 * @returns Whether triggers should fire
 */
export function shouldPhasingTrigger(
  eventType: 'phases_in' | 'phases_out',
  wasIndirect: boolean
): boolean {
  // Indirect phasing doesn't cause triggers
  if (wasIndirect) return false;
  
  // Direct phasing does cause "phases in/out" triggers
  return true;
}

/**
 * Checks if multiple phasing abilities are redundant
 * Rule 702.26g - Multiple instances of phasing are redundant
 * 
 * @param abilities - Array of phasing abilities
 * @returns True (multiple phasing is redundant)
 */
export function hasRedundantPhasing(abilities: readonly PhasingAbility[]): boolean {
  return abilities.length > 1;
}
