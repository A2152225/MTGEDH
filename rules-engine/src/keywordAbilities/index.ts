/**
 * Keyword Abilities (Rule 702)
 * 
 * This module provides implementations of all keyword abilities from the MTG Comprehensive Rules.
 * 
 * Part 1 (Rules 702.2-702.20): Basic keyword abilities
 * - Deathtouch (702.2)
 * - Defender (702.3)
 * - Double Strike (702.4)
 * - First Strike (702.7)
 * - Flash (702.8)
 * - Flying (702.9)
 * - Haste (702.10)
 * - Hexproof (702.11)
 * - Indestructible (702.12)
 * - Lifelink (702.15)
 * - Reach (702.17)
 * - Trample (702.19)
 * - Vigilance (702.20)
 */

// Export all keyword ability modules
export * from './deathtouch';
export * from './defender';
export * from './doubleStrike';
export * from './firstStrike';
export * from './flash';
export * from './flying';
export * from './haste';
export * from './hexproof';
export * from './indestructible';
export * from './lifelink';
export * from './reach';
export * from './trample';
export * from './vigilance';

/**
 * Union type of all keyword ability types
 */
export type KeywordAbility =
  | import('./deathtouch').DeathtouchAbility
  | import('./defender').DefenderAbility
  | import('./doubleStrike').DoubleStrikeAbility
  | import('./firstStrike').FirstStrikeAbility
  | import('./flash').FlashAbility
  | import('./flying').FlyingAbility
  | import('./haste').HasteAbility
  | import('./hexproof').HexproofAbility
  | import('./indestructible').IndestructibleAbility
  | import('./lifelink').LifelinkAbility
  | import('./reach').ReachAbility
  | import('./trample').TrampleAbility
  | import('./vigilance').VigilanceAbility;

/**
 * Helper function to check if an ability is a specific type
 */
export function isAbilityType<T extends KeywordAbility>(
  ability: KeywordAbility,
  type: T['type']
): ability is T {
  return ability.type === type;
}
