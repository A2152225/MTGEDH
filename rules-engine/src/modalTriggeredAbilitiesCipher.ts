import type { PlayerID } from '../../shared/src';

/**
 * Cipher encoded spell tracking
 * Rule 702.99 - Cipher encodes a spell onto a creature
 */
export interface CipherEncodedSpell {
  readonly spellId: string;
  readonly spellName: string;
  readonly spellOracleText: string;
  readonly encodedOnCreatureId: string;
  readonly encodedOnCreatureName: string;
  readonly controllerId: PlayerID;
  readonly timestamp: number;
}

/**
 * Cipher registry for tracking encoded spells
 */
export interface CipherRegistry {
  readonly encodedSpells: readonly CipherEncodedSpell[];
}

/**
 * Valid creature for cipher encoding
 */
export interface CipherEncodingTarget {
  readonly creatureId: string;
  readonly creatureName: string;
  readonly controllerId: PlayerID;
  readonly isValid: boolean;
  readonly invalidReason?: string;
}

/**
 * Cipher encoding choice event
 * Rule 702.99a - "you may exile this spell card encoded on a creature you control"
 */
export interface CipherEncodingChoice {
  readonly type: 'cipher_encoding';
  readonly spellId: string;
  readonly spellName: string;
  readonly controllerId: PlayerID;
  readonly validTargets: readonly CipherEncodingTarget[];
  readonly isMay: true;
  readonly description: string;
}

export function createCipherRegistry(): CipherRegistry {
  return {
    encodedSpells: [],
  };
}

export function getValidCipherTargets(
  creatures: readonly { id: string; name: string; controllerId: PlayerID }[],
  controllerId: PlayerID
): readonly CipherEncodingTarget[] {
  return creatures.map(creature => {
    const isControlled = creature.controllerId === controllerId;

    return {
      creatureId: creature.id,
      creatureName: creature.name,
      controllerId: creature.controllerId,
      isValid: isControlled,
      invalidReason: isControlled ? undefined : 'You must control the creature',
    };
  }).filter(target => target.isValid);
}

export function createCipherEncodingChoice(
  spellId: string,
  spellName: string,
  controllerId: PlayerID,
  creatures: readonly { id: string; name: string; controllerId: PlayerID }[]
): CipherEncodingChoice {
  const validTargets = getValidCipherTargets(creatures, controllerId);

  return {
    type: 'cipher_encoding',
    spellId,
    spellName,
    controllerId,
    validTargets,
    isMay: true,
    description: `${spellName} has cipher. You may exile it encoded on a creature you control.`,
  };
}

export function validateCipherEncodingTarget(
  choice: CipherEncodingChoice,
  selectedCreatureId: string | null
): {
  isValid: boolean;
  error?: string;
  skipEncoding: boolean;
} {
  if (selectedCreatureId === null) {
    return {
      isValid: true,
      skipEncoding: true,
    };
  }

  const target = choice.validTargets.find(t => t.creatureId === selectedCreatureId);

  if (!target) {
    return {
      isValid: false,
      error: 'Selected creature is not a valid target for cipher encoding',
      skipEncoding: false,
    };
  }

  if (!target.isValid) {
    return {
      isValid: false,
      error: target.invalidReason || 'Invalid target',
      skipEncoding: false,
    };
  }

  return {
    isValid: true,
    skipEncoding: false,
  };
}

export function encodeSpellOntoCreature(
  registry: CipherRegistry,
  spellId: string,
  spellName: string,
  spellOracleText: string,
  creatureId: string,
  creatureName: string,
  controllerId: PlayerID
): CipherRegistry {
  const encodedSpell: CipherEncodedSpell = {
    spellId,
    spellName,
    spellOracleText,
    encodedOnCreatureId: creatureId,
    encodedOnCreatureName: creatureName,
    controllerId,
    timestamp: Date.now(),
  };

  return {
    encodedSpells: [...registry.encodedSpells, encodedSpell],
  };
}

export function getEncodedSpells(
  registry: CipherRegistry,
  creatureId: string
): readonly CipherEncodedSpell[] {
  return registry.encodedSpells.filter(s => s.encodedOnCreatureId === creatureId);
}

export function removeEncodedSpells(
  registry: CipherRegistry,
  creatureId: string
): CipherRegistry {
  return {
    encodedSpells: registry.encodedSpells.filter(s => s.encodedOnCreatureId !== creatureId),
  };
}

export function checkCipherTriggers(
  registry: CipherRegistry,
  creatureId: string,
  damagedPlayerId: PlayerID
): readonly {
  encodedSpell: CipherEncodedSpell;
  triggerId: string;
  description: string;
}[] {
  const encodedSpells = getEncodedSpells(registry, creatureId);

  return encodedSpells.map(spell => ({
    encodedSpell: spell,
    triggerId: `cipher-trigger-${spell.spellId}-${Date.now()}`,
    description: `${spell.encodedOnCreatureName} dealt combat damage to a player. You may cast a copy of ${spell.spellName} without paying its mana cost.`,
  }));
}

export function createCipherCastEvent(
  playerId: PlayerID,
  encodedSpell: CipherEncodedSpell
): {
  type: 'cipher_cast';
  playerId: PlayerID;
  spellName: string;
  spellOracleText: string;
  creatureName: string;
  isMay: true;
} {
  return {
    type: 'cipher_cast',
    playerId,
    spellName: encodedSpell.spellName,
    spellOracleText: encodedSpell.spellOracleText,
    creatureName: encodedSpell.encodedOnCreatureName,
    isMay: true,
  };
}
