/**
 * damageProcessing.ts
 * 
 * Comprehensive damage processing system that handles infect, wither, toxic,
 * poisonous, and other damage-modifying effects.
 * 
 * Rules Reference:
 * - Rule 120: Damage
 * - Rule 702.90: Infect
 * - Rule 702.80: Wither
 * - Rule 702.164: Toxic
 * - Rule 702.70: Poisonous
 * - Rule 704.5f: Zero or less toughness (state-based action)
 */

import type { PlayerID, BattlefieldPermanent, KnownCardRef } from '../../shared/src';

/**
 * Damage source characteristics
 */
export interface DamageSourceCharacteristics {
  readonly hasInfect: boolean;
  readonly hasWither: boolean;
  readonly hasToxic: boolean;
  readonly toxicValue: number;
  readonly hasPoisonous: boolean;
  readonly poisonousValue: number;
  readonly hasLifelink: boolean;
  readonly hasDeathtouch: boolean;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: PlayerID;
}

/**
 * Damage recipient types
 */
export enum DamageRecipientType {
  PLAYER = 'player',
  CREATURE = 'creature',
  PLANESWALKER = 'planeswalker',
  BATTLE = 'battle',
}

/**
 * Damage event
 */
export interface DamageEvent {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceControllerId: PlayerID;
  readonly recipientId: string;
  readonly recipientType: DamageRecipientType;
  readonly amount: number;
  readonly isCombatDamage: boolean;
  readonly characteristics: DamageSourceCharacteristics;
}

/**
 * Result of damage processing
 */
export interface DamageResult {
  readonly lifeChange: number; // Negative for loss, 0 if infect
  readonly poisonCounters: number;
  readonly minusCounters: number; // -1/-1 counters for wither/infect
  readonly loyaltyLoss: number;
  readonly defenseCounterLoss: number;
  readonly markedDamage: number; // Normal damage marked on creatures
  readonly lifelinkHealing: number;
  readonly deathtouch: boolean;
  readonly log: readonly string[];
}

/**
 * Parse damage-relevant abilities from oracle text
 */
export function parseDamageAbilities(
  oracleText: string | undefined | null,
  typeLine: string | undefined | null
): Partial<DamageSourceCharacteristics> {
  const text = (oracleText || '').toLowerCase();
  const type = (typeLine || '').toLowerCase();
  
  let toxicValue = 0;
  let poisonousValue = 0;
  
  // Check for toxic N
  const toxicMatch = text.match(/toxic\s+(\d+)/);
  if (toxicMatch) {
    toxicValue = parseInt(toxicMatch[1], 10);
  }
  
  // Check for poisonous N
  const poisonousMatch = text.match(/poisonous\s+(\d+)/);
  if (poisonousMatch) {
    poisonousValue = parseInt(poisonousMatch[1], 10);
  }
  
  return {
    hasInfect: text.includes('infect'),
    hasWither: text.includes('wither'),
    hasToxic: toxicValue > 0,
    toxicValue,
    hasPoisonous: poisonousValue > 0,
    poisonousValue,
    hasLifelink: text.includes('lifelink'),
    hasDeathtouch: text.includes('deathtouch'),
  };
}

/**
 * Create damage source characteristics from a permanent
 */
export function createDamageSourceFromPermanent(
  permanent: BattlefieldPermanent
): DamageSourceCharacteristics {
  const card = permanent.card as KnownCardRef;
  const abilities = parseDamageAbilities(card?.oracle_text, card?.type_line);
  
  // Also check granted abilities
  const grantedAbilities = permanent.grantedAbilities || [];
  const grantedText = grantedAbilities.join(' ').toLowerCase();
  
  return {
    hasInfect: abilities.hasInfect || grantedText.includes('infect'),
    hasWither: abilities.hasWither || grantedText.includes('wither'),
    hasToxic: abilities.hasToxic || grantedText.includes('toxic'),
    toxicValue: abilities.toxicValue || 0,
    hasPoisonous: abilities.hasPoisonous || grantedText.includes('poisonous'),
    poisonousValue: abilities.poisonousValue || 0,
    hasLifelink: abilities.hasLifelink || grantedText.includes('lifelink'),
    hasDeathtouch: abilities.hasDeathtouch || grantedText.includes('deathtouch'),
    sourceId: permanent.id,
    sourceName: card?.name || 'Unknown',
    controllerId: permanent.controller,
  };
}

/**
 * Process damage to a player
 * 
 * Rule 120.3a: Damage dealt to a player by a source without infect causes that player to lose that much life.
 * Rule 120.3b: Damage dealt to a player by a source with infect causes that source's controller to give 
 * that player that many poison counters.
 * Rule 702.164c: Combat damage from creature with toxic also gives poison counters equal to total toxic value.
 */
export function processDamageToPlayer(
  damage: DamageEvent
): DamageResult {
  const logs: string[] = [];
  let lifeChange = 0;
  let poisonCounters = 0;
  let lifelinkHealing = 0;
  
  // Rule 120.3b: Infect damage to player gives poison counters instead of life loss
  if (damage.characteristics.hasInfect) {
    poisonCounters += damage.amount;
    logs.push(`${damage.sourceName} deals ${damage.amount} infect damage to player, giving ${damage.amount} poison counters`);
  } else {
    // Normal damage causes life loss
    lifeChange = -damage.amount;
    logs.push(`${damage.sourceName} deals ${damage.amount} damage to player`);
    
    // Toxic adds poison counters IN ADDITION to life loss (combat only)
    if (damage.isCombatDamage && damage.characteristics.hasToxic && damage.characteristics.toxicValue > 0) {
      poisonCounters += damage.characteristics.toxicValue;
      logs.push(`${damage.sourceName}'s toxic ${damage.characteristics.toxicValue} gives ${damage.characteristics.toxicValue} poison counters`);
    }
  }
  
  // Poisonous triggers on combat damage (separate from toxic)
  if (damage.isCombatDamage && damage.characteristics.hasPoisonous && damage.characteristics.poisonousValue > 0) {
    poisonCounters += damage.characteristics.poisonousValue;
    logs.push(`${damage.sourceName}'s poisonous ${damage.characteristics.poisonousValue} triggers, giving ${damage.characteristics.poisonousValue} poison counters`);
  }
  
  // Lifelink heals the controller
  if (damage.characteristics.hasLifelink && damage.amount > 0) {
    lifelinkHealing = damage.amount;
    logs.push(`${damage.sourceName}'s lifelink heals controller for ${damage.amount}`);
  }
  
  return {
    lifeChange,
    poisonCounters,
    minusCounters: 0,
    loyaltyLoss: 0,
    defenseCounterLoss: 0,
    markedDamage: 0,
    lifelinkHealing,
    deathtouch: false,
    log: logs,
  };
}

/**
 * Process damage to a creature
 * 
 * Rule 120.3d: Damage dealt to a creature by a source with wither and/or infect 
 * causes that source's controller to put that many -1/-1 counters on that creature.
 * Rule 120.3e: Damage dealt to a creature by a source with neither wither nor infect 
 * is marked on that creature.
 */
export function processDamageToCreature(
  damage: DamageEvent,
  creatureToughness: number
): DamageResult {
  const logs: string[] = [];
  let minusCounters = 0;
  let markedDamage = 0;
  let lifelinkHealing = 0;
  const deathtouch = damage.characteristics.hasDeathtouch && damage.amount > 0;
  
  // Rule 120.3d: Wither and/or infect damage causes -1/-1 counters
  if (damage.characteristics.hasInfect || damage.characteristics.hasWither) {
    minusCounters = damage.amount;
    const abilityName = damage.characteristics.hasInfect ? 'infect' : 'wither';
    logs.push(`${damage.sourceName} deals ${damage.amount} ${abilityName} damage, placing ${damage.amount} -1/-1 counters`);
  } else {
    // Normal damage is marked
    markedDamage = damage.amount;
    logs.push(`${damage.sourceName} deals ${damage.amount} damage to creature`);
  }
  
  // Deathtouch
  if (deathtouch) {
    logs.push(`${damage.sourceName} has deathtouch`);
  }
  
  // Lifelink
  if (damage.characteristics.hasLifelink && damage.amount > 0) {
    lifelinkHealing = damage.amount;
    logs.push(`${damage.sourceName}'s lifelink heals controller for ${damage.amount}`);
  }
  
  return {
    lifeChange: 0,
    poisonCounters: 0,
    minusCounters,
    loyaltyLoss: 0,
    defenseCounterLoss: 0,
    markedDamage,
    lifelinkHealing,
    deathtouch,
    log: logs,
  };
}

/**
 * Process damage to a planeswalker
 * 
 * Rule 120.3c: Damage dealt to a planeswalker causes that many loyalty counters to be removed from it.
 */
export function processDamageToPlaneswalker(
  damage: DamageEvent
): DamageResult {
  const logs: string[] = [];
  let lifelinkHealing = 0;
  
  logs.push(`${damage.sourceName} deals ${damage.amount} damage to planeswalker, removing ${damage.amount} loyalty counters`);
  
  // Lifelink still applies
  if (damage.characteristics.hasLifelink && damage.amount > 0) {
    lifelinkHealing = damage.amount;
    logs.push(`${damage.sourceName}'s lifelink heals controller for ${damage.amount}`);
  }
  
  return {
    lifeChange: 0,
    poisonCounters: 0,
    minusCounters: 0,
    loyaltyLoss: damage.amount,
    defenseCounterLoss: 0,
    markedDamage: 0,
    lifelinkHealing,
    deathtouch: false,
    log: logs,
  };
}

/**
 * Process damage to a battle
 * 
 * Rule 120.3f: Damage dealt to a battle causes that many defense counters to be removed from it.
 */
export function processDamageToBattle(
  damage: DamageEvent
): DamageResult {
  const logs: string[] = [];
  let lifelinkHealing = 0;
  
  logs.push(`${damage.sourceName} deals ${damage.amount} damage to battle, removing ${damage.amount} defense counters`);
  
  if (damage.characteristics.hasLifelink && damage.amount > 0) {
    lifelinkHealing = damage.amount;
    logs.push(`${damage.sourceName}'s lifelink heals controller for ${damage.amount}`);
  }
  
  return {
    lifeChange: 0,
    poisonCounters: 0,
    minusCounters: 0,
    loyaltyLoss: 0,
    defenseCounterLoss: damage.amount,
    markedDamage: 0,
    lifelinkHealing,
    deathtouch: false,
    log: logs,
  };
}

/**
 * Process a damage event (dispatches to appropriate handler)
 */
export function processDamage(
  damage: DamageEvent,
  recipientInfo?: { toughness?: number }
): DamageResult {
  switch (damage.recipientType) {
    case DamageRecipientType.PLAYER:
      return processDamageToPlayer(damage);
      
    case DamageRecipientType.CREATURE:
      return processDamageToCreature(damage, recipientInfo?.toughness || 0);
      
    case DamageRecipientType.PLANESWALKER:
      return processDamageToPlaneswalker(damage);
      
    case DamageRecipientType.BATTLE:
      return processDamageToBattle(damage);
      
    default:
      return {
        lifeChange: 0,
        poisonCounters: 0,
        minusCounters: 0,
        loyaltyLoss: 0,
        defenseCounterLoss: 0,
        markedDamage: 0,
        lifelinkHealing: 0,
        deathtouch: false,
        log: ['Unknown damage recipient type'],
      };
  }
}

/**
 * Calculate effective toughness after counters and modifiers
 * 
 * This is the core calculation shared by multiple functions.
 * 
 * @param baseToughness - Creature's printed toughness
 * @param minusCounters - Number of -1/-1 counters
 * @param plusCounters - Number of +1/+1 counters (default 0)
 * @param modifiers - Other toughness modifiers from effects (default 0)
 * @returns The calculated effective toughness
 */
export function calculateEffectiveToughness(
  baseToughness: number,
  minusCounters: number,
  plusCounters: number = 0,
  modifiers: number = 0
): number {
  return baseToughness + plusCounters - minusCounters + modifiers;
}

/**
 * Check if a creature would die from -1/-1 counters (toughness <= 0)
 * Rule 704.5f: If a creature has toughness 0 or less, it's put into its owner's graveyard.
 * 
 * Uses calculateEffectiveToughness for the core calculation.
 */
export function wouldCreatureDieFromMinusCounters(
  baseToughness: number,
  existingMinusCounters: number,
  newMinusCounters: number,
  otherToughnessModifiers: number = 0
): boolean {
  const totalToughness = calculateEffectiveToughness(
    baseToughness,
    existingMinusCounters + newMinusCounters,
    0, // plusCounters
    otherToughnessModifiers
  );
  return totalToughness <= 0;
}

/**
 * Create a damage event
 */
export function createDamageEvent(
  source: BattlefieldPermanent,
  recipientId: string,
  recipientType: DamageRecipientType,
  amount: number,
  isCombatDamage: boolean
): DamageEvent {
  const characteristics = createDamageSourceFromPermanent(source);
  
  return {
    sourceId: source.id,
    sourceName: characteristics.sourceName,
    sourceControllerId: source.controller,
    recipientId,
    recipientType,
    amount,
    isCombatDamage,
    characteristics,
  };
}

export default {
  parseDamageAbilities,
  createDamageSourceFromPermanent,
  processDamageToPlayer,
  processDamageToCreature,
  processDamageToPlaneswalker,
  processDamageToBattle,
  processDamage,
  wouldCreatureDieFromMinusCounters,
  calculateEffectiveToughness,
  createDamageEvent,
  DamageRecipientType,
};
