/**
 * Keyword Abilities (Rule 702)
 * 
 * This module provides implementations of all keyword abilities from the MTG Comprehensive Rules.
 * 
 * Part 1 (Rules 702.2-702.20): Basic keyword abilities
 * - Deathtouch (702.2), Defender (702.3), Double Strike (702.4), First Strike (702.7)
 * - Flash (702.8), Flying (702.9), Haste (702.10), Hexproof (702.11)
 * - Indestructible (702.12), Lifelink (702.15), Reach (702.17), Trample (702.19), Vigilance (702.20)
 * 
 * Part 2 (Rules 702.21-702.37): Classic keyword abilities
 * - Ward (702.21), Banding (702.22), Rampage (702.23), Cumulative Upkeep (702.24)
 * - Flanking (702.25), Phasing (702.26), Buyback (702.27), Shadow (702.28)
 * - Cycling (702.29), Echo (702.30), Horsemanship (702.31), Fading (702.32)
 * - Kicker (702.33), Flashback (702.34), Madness (702.35), Fear (702.36), Morph (702.37)
 */

// Part 1: Export all keyword ability modules
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

// Part 2: Export classic keyword abilities
export * from './ward';
export * from './banding';
export * from './rampage';
export * from './cumulativeUpkeep';
export * from './flanking';
export * from './phasing';
export * from './buyback';
export * from './shadow';
export * from './cycling';
export * from './echo';
export * from './horsemanship';
export * from './fading';
export * from './kicker';
export * from './flashback';
export * from './madness';
export * from './fear';
export * from './morph';

/**
 * Union type of all keyword ability types
 */
export type KeywordAbility =
  // Part 1
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
  | import('./vigilance').VigilanceAbility
  // Part 2
  | import('./ward').WardAbility
  | import('./banding').BandingAbility
  | import('./rampage').RampageAbility
  | import('./cumulativeUpkeep').CumulativeUpkeepAbility
  | import('./flanking').FlankingAbility
  | import('./phasing').PhasingAbility
  | import('./buyback').BuybackAbility
  | import('./shadow').ShadowAbility
  | import('./cycling').CyclingAbility
  | import('./cycling').TypecyclingAbility
  | import('./echo').EchoAbility
  | import('./horsemanship').HorsemanshipAbility
  | import('./fading').FadingAbility
  | import('./kicker').KickerAbility
  | import('./kicker').MultikickerAbility
  | import('./flashback').FlashbackAbility
  | import('./madness').MadnessAbility
  | import('./fear').FearAbility
  | import('./morph').MorphAbility
  | import('./morph').MegamorphAbility;

/**
 * Helper function to check if an ability is a specific type
 */
export function isAbilityType<T extends KeywordAbility>(
  ability: KeywordAbility,
  type: T['type']
): ability is T {
  return ability.type === type;
}
