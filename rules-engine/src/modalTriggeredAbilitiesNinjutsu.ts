import type { PlayerID } from '../../shared/src';

/**
 * Unblocked attacker that can be returned for Ninjutsu
 */
export interface NinjutsuTarget {
  readonly creatureId: string;
  readonly creatureName: string;
  readonly controllerId: PlayerID;
  readonly isUnblocked: boolean;
  readonly isAttacking: boolean;
  readonly isValid: boolean;
  readonly invalidReason?: string;
}

/**
 * Ninjutsu activation choice
 * Rule 702.49a - Return an unblocked attacking creature you control to hand,
 * put this card onto the battlefield tapped and attacking
 */
export interface NinjutsuActivationChoice {
  readonly type: 'ninjutsu_activation';
  readonly ninjaCardId: string;
  readonly ninjaCardName: string;
  readonly ninjutsuCost: string;
  readonly controllerId: PlayerID;
  readonly validTargets: readonly NinjutsuTarget[];
  readonly description: string;
}

export function getValidNinjutsuTargets(
  attackingCreatures: readonly {
    id: string;
    name: string;
    controllerId: PlayerID;
    isBlocked: boolean;
  }[],
  controllerId: PlayerID
): readonly NinjutsuTarget[] {
  return attackingCreatures.map(creature => {
    const isControlled = creature.controllerId === controllerId;
    const isUnblocked = !creature.isBlocked;
    const isValid = isControlled && isUnblocked;

    let invalidReason: string | undefined;
    if (!isControlled) {
      invalidReason = 'You must control the attacking creature';
    } else if (!isUnblocked) {
      invalidReason = 'Creature must be unblocked';
    }

    return {
      creatureId: creature.id,
      creatureName: creature.name,
      controllerId: creature.controllerId,
      isUnblocked,
      isAttacking: true,
      isValid,
      invalidReason,
    };
  }).filter(target => target.isValid);
}

export function canActivateNinjutsu(
  attackingCreatures: readonly {
    id: string;
    name: string;
    controllerId: PlayerID;
    isBlocked: boolean;
  }[],
  controllerId: PlayerID,
  currentStep: string
): {
  canActivate: boolean;
  reason?: string;
  validTargetCount: number;
} {
  const validSteps = ['declare_blockers', 'combat_damage', 'end_of_combat'];
  const stepLower = currentStep.toLowerCase().replace(/\s+/g, '_');

  if (!validSteps.some(s => stepLower.includes(s))) {
    return {
      canActivate: false,
      reason: 'Ninjutsu can only be activated after blockers are declared',
      validTargetCount: 0,
    };
  }

  const validTargets = getValidNinjutsuTargets(attackingCreatures, controllerId);

  if (validTargets.length === 0) {
    return {
      canActivate: false,
      reason: 'No unblocked attacking creatures you control',
      validTargetCount: 0,
    };
  }

  return {
    canActivate: true,
    validTargetCount: validTargets.length,
  };
}

export function createNinjutsuActivationChoice(
  ninjaCardId: string,
  ninjaCardName: string,
  ninjutsuCost: string,
  controllerId: PlayerID,
  attackingCreatures: readonly {
    id: string;
    name: string;
    controllerId: PlayerID;
    isBlocked: boolean;
  }[]
): NinjutsuActivationChoice {
  const validTargets = getValidNinjutsuTargets(attackingCreatures, controllerId);

  return {
    type: 'ninjutsu_activation',
    ninjaCardId,
    ninjaCardName,
    ninjutsuCost,
    controllerId,
    validTargets,
    description: `Activate Ninjutsu for ${ninjaCardName} (${ninjutsuCost}). Choose an unblocked attacking creature to return to your hand.`,
  };
}

export function validateNinjutsuTarget(
  choice: NinjutsuActivationChoice,
  selectedCreatureId: string
): {
  isValid: boolean;
  error?: string;
  selectedTarget?: NinjutsuTarget;
} {
  const target = choice.validTargets.find(t => t.creatureId === selectedCreatureId);

  if (!target) {
    return {
      isValid: false,
      error: 'Selected creature is not a valid target for Ninjutsu',
    };
  }

  if (!target.isValid) {
    return {
      isValid: false,
      error: target.invalidReason || 'Invalid target',
    };
  }

  return {
    isValid: true,
    selectedTarget: target,
  };
}

/**
 * Result of Ninjutsu activation
 */
export interface NinjutsuActivationResult {
  readonly ninjaCardId: string;
  readonly ninjaCardName: string;
  readonly returnedCreatureId: string;
  readonly returnedCreatureName: string;
  readonly defendingPlayerId?: PlayerID;
  readonly log: readonly string[];
}

export function processNinjutsuActivation(
  choice: NinjutsuActivationChoice,
  selectedCreatureId: string,
  defendingPlayerId?: PlayerID
): NinjutsuActivationResult | { error: string } {
  const validation = validateNinjutsuTarget(choice, selectedCreatureId);

  if (!validation.isValid || !validation.selectedTarget) {
    return { error: validation.error || 'Invalid target' };
  }

  const target = validation.selectedTarget;

  return {
    ninjaCardId: choice.ninjaCardId,
    ninjaCardName: choice.ninjaCardName,
    returnedCreatureId: target.creatureId,
    returnedCreatureName: target.creatureName,
    defendingPlayerId,
    log: [
      `${choice.controllerId} activates Ninjutsu for ${choice.ninjaCardName}`,
      `Paying ${choice.ninjutsuCost}`,
      `Returning ${target.creatureName} to hand`,
      `${choice.ninjaCardName} enters the battlefield tapped and attacking`,
    ],
  };
}
