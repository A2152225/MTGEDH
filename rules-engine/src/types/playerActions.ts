/**
 * Rules 119-122: Player Actions
 * Life, Damage, Drawing Cards, and Counters
 */

import { ObjectID, ControllerID } from './objects';

/**
 * Rule 119: Life
 * Each player has a life total
 */

/**
 * Rule 119.1 - Starting life total
 */
export interface LifeTotal {
  readonly playerId: ControllerID;
  readonly current: number;
  readonly starting: number;
}

/**
 * Variant game starting life totals
 */
export enum GameVariantLife {
  STANDARD = 20,           // Rule 119.1
  TWO_HEADED_GIANT = 30,   // Rule 119.1a
  COMMANDER = 40,          // Rule 119.1c
  BRAWL_MULTIPLAYER = 30,  // Rule 119.1d
  BRAWL_TWO_PLAYER = 25,   // Rule 119.1d
  ARCHENEMY = 40           // Rule 119.1e (for archenemy)
}

/**
 * Rule 119.2 - Damage causes life loss
 * Rule 119.3 - Effects can cause life gain/loss
 */
export interface LifeChange {
  readonly playerId: ControllerID;
  readonly amount: number;  // Positive for gain, negative for loss
  readonly source?: ObjectID;  // What caused the change
  readonly isDamage: boolean;  // Rule 119.2 vs 119.3
}

/**
 * Rule 119.4 - Paying life
 * Can only pay if life total >= amount
 */
export function canPayLife(lifeTotal: number, amount: number): boolean {
  // Rule 119.4b - Can always pay 0 life
  if (amount === 0) {
    return true;
  }
  
  // Rule 119.4 - Must have enough life
  return lifeTotal >= amount;
}

/**
 * Rule 119.5 - Set life total to specific number
 */
export function setLifeTotal(current: number, newTotal: number): LifeChange {
  const difference = newTotal - current;
  return {
    playerId: '', // Would be filled in by caller
    amount: difference,
    isDamage: false
  };
}

/**
 * Rule 119.6 - If player has 0 or less life, they lose (state-based action)
 */
export function hasLostDueToLife(lifeTotal: number): boolean {
  return lifeTotal <= 0;
}

/**
 * Rule 119.7 - "Can't gain life" effect
 */
export interface CantGainLifeEffect {
  readonly affectedPlayer: ControllerID;
  readonly active: boolean;
}

/**
 * Rule 119.8 - "Can't lose life" effect
 */
export interface CantLoseLifeEffect {
  readonly affectedPlayer: ControllerID;
  readonly active: boolean;
}

/**
 * Rule 120: Damage
 * Objects can deal damage to creatures, planeswalkers, battles, and players
 */

/**
 * Rule 120.1 - Damage recipients
 */
export enum DamageRecipient {
  PLAYER = 'player',
  CREATURE = 'creature',
  PLANESWALKER = 'planeswalker',
  BATTLE = 'battle'
}

/**
 * Rule 120.2 - Any object can deal damage
 */
export interface DamageEvent {
  readonly source: ObjectID;
  readonly recipientId: ObjectID | ControllerID;
  readonly recipientType: DamageRecipient;
  readonly amount: number;
  readonly isCombatDamage: boolean;  // Rule 120.2a
  readonly characteristics: DamageCharacteristics;
}

/**
 * Damage characteristics (keywords that affect damage)
 */
export interface DamageCharacteristics {
  readonly hasInfect: boolean;      // Rule 120.3b, 120.3d
  readonly hasWither: boolean;      // Rule 120.3d
  readonly hasLifelink: boolean;
  readonly hasDeathtouch: boolean;
  readonly hasDoubleStrike: boolean;
  readonly hasFirstStrike: boolean;
  readonly hasTrample: boolean;
}

/**
 * Rule 120.3 - Damage results
 */
export enum DamageResult {
  LIFE_LOSS = 'life_loss',              // Rule 120.3a - Normal damage to player
  POISON_COUNTERS = 'poison_counters',  // Rule 120.3b - Infect damage to player
  LOYALTY_LOSS = 'loyalty_loss',        // Rule 120.3c - Damage to planeswalker
  MINUS_COUNTERS = 'minus_counters',    // Rule 120.3d - Wither/infect to creature
  MARKED_DAMAGE = 'marked_damage'       // Normal damage to creature
}

/**
 * Rule 120.3a - Damage to player without infect causes life loss
 */
export function damageToPlayerCausesLifeLoss(
  damage: DamageEvent,
  hasInfect: boolean
): boolean {
  return damage.recipientType === DamageRecipient.PLAYER && !hasInfect;
}

/**
 * Rule 120.3b - Damage with infect to player causes poison counters
 */
export function damageWithInfectCausesPoisonCounters(
  damage: DamageEvent
): boolean {
  return damage.recipientType === DamageRecipient.PLAYER && 
         damage.characteristics.hasInfect;
}

/**
 * Rule 120.3c - Damage to planeswalker removes loyalty counters
 */
export function damageToPlaneswalkerRemovesLoyalty(
  damage: DamageEvent
): boolean {
  return damage.recipientType === DamageRecipient.PLANESWALKER;
}

/**
 * Rule 121: Drawing a Card
 */

/**
 * Rule 121.1 - Player draws a card
 */
export interface DrawCardEvent {
  readonly playerId: ControllerID;
  readonly count: number;
  readonly source?: ObjectID;  // What caused the draw
}

/**
 * Rule 121.2 - Cards are drawn one at a time
 */
export function drawCardsOneAtATime(count: number): DrawCardEvent[] {
  const events: DrawCardEvent[] = [];
  for (let i = 0; i < count; i++) {
    events.push({
      playerId: '', // Filled by caller
      count: 1,
      source: undefined
    });
  }
  return events;
}

/**
 * Rule 121.2a - If instruction causes multiple players to draw
 * Apply APNAP order (active player, then nonactive players in turn order)
 */
export interface MultiPlayerDraw {
  readonly draws: Map<ControllerID, number>;
  readonly apnapOrder: readonly ControllerID[];
}

/**
 * Rule 121.3 - If player can't draw (empty library), they lose
 * This is a state-based action
 */
export function canDrawCard(librarySize: number): boolean {
  return librarySize > 0;
}

/**
 * Rule 122: Counters
 * Objects can have counters on them
 */

/**
 * Rule 122.1 - Counter is a marker on object or player
 */
export interface Counter {
  readonly type: CounterType | string;  // Predefined or custom
  readonly count: number;
}

/**
 * Common counter types
 */
export enum CounterType {
  // Creature counters
  PLUS_ONE_PLUS_ONE = '+1/+1',
  MINUS_ONE_MINUS_ONE = '-1/-1',
  
  // Player counters
  POISON = 'poison',
  ENERGY = 'energy',
  EXPERIENCE = 'experience',
  
  // Planeswalker
  LOYALTY = 'loyalty',
  
  // Other common types
  CHARGE = 'charge',
  QUEST = 'quest',
  LEVEL = 'level',
  AGE = 'age',
  FADE = 'fade',
  TIME = 'time',
  VERSE = 'verse',
  LORE = 'lore'
}

/**
 * Rule 122.1a - Counters on object
 */
export interface ObjectWithCounters {
  readonly objectId: ObjectID;
  readonly counters: ReadonlyMap<string, number>;
}

/**
 * Rule 122.1a - Counters on player
 */
export interface PlayerWithCounters {
  readonly playerId: ControllerID;
  readonly counters: ReadonlyMap<string, number>;
}

/**
 * Rule 122.3 - +1/+1 and -1/-1 counters cancel each other
 * State-based action
 */
export function cancelPlusMinusCounters(
  plusOneCounters: number,
  minusOneCounters: number
): { plusOne: number; minusOne: number } {
  const toRemove = Math.min(plusOneCounters, minusOneCounters);
  return {
    plusOne: plusOneCounters - toRemove,
    minusOne: minusOneCounters - toRemove
  };
}

/**
 * Rule 122.4 - Can't put counters on object in wrong zone
 */
export function canPutCounterOnObject(
  counterType: string,
  objectType: string,
  zone: string
): boolean {
  // Most counters only work on battlefield
  // Some exceptions exist (suspend counters in exile, etc.)
  if (zone !== 'battlefield') {
    // Special cases for counters in other zones
    return counterType === 'time' && zone === 'exile' || // Suspend
           counterType === 'verse' && zone === 'exile';   // Saga-like effects
  }
  return true;
}

/**
 * Rule 122.6 - Moving object between zones loses counters
 * Except for specific cases
 */
export function objectLosesCountersOnZoneChange(
  fromZone: string,
  toZone: string
): boolean {
  // Generally, counters are lost when changing zones
  // Exceptions noted in comprehensive rules
  if (fromZone === 'battlefield' && toZone === 'battlefield') {
    return false; // Phasing, etc.
  }
  return true;
}

/**
 * Add counter to object
 */
export function addCounter(
  currentCounters: ReadonlyMap<string, number>,
  counterType: string,
  amount: number
): Map<string, number> {
  const newCounters = new Map(currentCounters);
  const current = newCounters.get(counterType) || 0;
  newCounters.set(counterType, current + amount);
  return newCounters;
}

/**
 * Remove counter from object
 */
export function removeCounter(
  currentCounters: ReadonlyMap<string, number>,
  counterType: string,
  amount: number
): Map<string, number> | null {
  const current = currentCounters.get(counterType) || 0;
  if (current < amount) {
    return null; // Can't remove more than exist
  }
  
  const newCounters = new Map(currentCounters);
  const remaining = current - amount;
  if (remaining === 0) {
    newCounters.delete(counterType);
  } else {
    newCounters.set(counterType, remaining);
  }
  return newCounters;
}

/**
 * Get counter count
 */
export function getCounterCount(
  counters: ReadonlyMap<string, number>,
  counterType: string
): number {
  return counters.get(counterType) || 0;
}
