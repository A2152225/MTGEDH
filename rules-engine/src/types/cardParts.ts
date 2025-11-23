/**
 * Rules 200-209: Parts of a Card
 * Characteristics that define what a card is and how it functions
 */

import { Color } from './colors';
import { ManaType, ManaCost } from './mana';
import { CardType, Subtype, Supertype } from './objects';

/**
 * Rule 200: General
 * Parts of a card and their relationship to characteristics
 */

/**
 * Rule 200.1 - Parts of a card
 * All possible parts that can appear on a Magic card
 */
export interface CardParts {
  readonly name: string;
  readonly manaCost?: ManaCost;              // Rule 202
  readonly colorIndicator?: readonly Color[]; // Rule 204
  readonly typeLine: TypeLine;                // Rule 205
  readonly textBox: string;                   // Rule 207
  readonly powerToughness?: PowerToughness;   // Rule 208
  readonly loyalty?: number;                  // Rule 209
  readonly defense?: number;                  // For battles
  readonly handModifier?: number;             // For vanguard cards
  readonly lifeModifier?: number;             // For vanguard cards
}

/**
 * Rule 201: Name
 */

/**
 * Rule 201.1 - Card name
 */
export interface CardName {
  readonly primary: string;          // The main name
  readonly alternateName?: string;   // Rule 201.6 - Secondary title bar
  readonly englishName: string;      // Rule 201.2 - Always English
}

/**
 * Rule 201.2a - Same name comparison
 */
export function haveSameName(
  name1: string | string[] | null,
  name2: string | string[] | null
): boolean {
  // Objects with no name don't have the same name as anything
  if (name1 === null || name2 === null) {
    return false;
  }
  
  const names1 = Array.isArray(name1) ? name1 : [name1];
  const names2 = Array.isArray(name2) ? name2 : [name2];
  
  // Two objects have the same name if they have at least one name in common
  return names1.some(n1 => names2.includes(n1));
}

/**
 * Rule 201.2b - Different names (all must be different)
 */
export function haveDifferentNames(names: (string | string[] | null)[]): boolean {
  // Each object must have at least one name
  if (names.some(n => n === null)) {
    return false;
  }
  
  // No two objects can have a name in common
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (haveSameName(names[i], names[j])) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Rule 201.2c - One object has different name than others
 */
export function hasDifferentNameThan(
  name: string | string[] | null,
  otherNames: (string | string[] | null)[]
): boolean {
  // First object must have at least one name
  if (name === null) {
    return false;
  }
  
  // Must have no names in common with any other object
  return !otherNames.some(other => haveSameName(name, other));
}

/**
 * Rule 201.3 - Interchangeable names
 */
export interface InterchangeableNames {
  readonly names: readonly string[];  // All names that are interchangeable
}

/**
 * Rule 201.4 - Choosing a card name
 */
export interface ChooseCardNameConstraints {
  readonly mustBeInOracle: boolean;        // Rule 201.4
  readonly canChooseToken: boolean;        // Only if also a card name
  readonly requiredCharacteristics?: {     // Rule 201.4a
    readonly cardTypes?: readonly CardType[];
    readonly colors?: readonly Color[];
    readonly manaCost?: ManaCost;
  };
}

/**
 * Rule 201.5 - Text referring to object by name
 */
export function nameRefersToSelf(
  sourceObjectId: string,
  nameInText: string,
  sourceObjectName: string
): boolean {
  // Text that refers to the object by name means just that particular object
  return nameInText === sourceObjectName;
}

/**
 * Rule 202: Mana Cost and Color
 */

/**
 * Rule 202.1b - No mana cost
 */
export function hasNoManaCost(manaCost: ManaCost | undefined): boolean {
  return manaCost === undefined || manaCost === null;
}

/**
 * Rule 202.2 - Object color from mana cost
 */
export function getColorFromManaCost(manaCost: ManaCost | undefined): readonly Color[] {
  if (!manaCost) {
    return []; // Colorless
  }
  
  const colors: Color[] = [];
  
  if (manaCost.white && manaCost.white > 0) colors.push(Color.WHITE);
  if (manaCost.blue && manaCost.blue > 0) colors.push(Color.BLUE);
  if (manaCost.black && manaCost.black > 0) colors.push(Color.BLACK);
  if (manaCost.red && manaCost.red > 0) colors.push(Color.RED);
  if (manaCost.green && manaCost.green > 0) colors.push(Color.GREEN);
  
  return colors;
}

/**
 * Rule 202.2b - Colorless (no colored mana symbols)
 */
export function isColorlessFromManaCost(manaCost: ManaCost | undefined): boolean {
  return getColorFromManaCost(manaCost).length === 0;
}

/**
 * Rule 202.2c - Multicolored (two or more colors)
 */
export function isMulticoloredFromManaCost(manaCost: ManaCost | undefined): boolean {
  return getColorFromManaCost(manaCost).length >= 2;
}

/**
 * Rule 202.3 - Mana value
 * Calculated in numbers.ts, but referenced here
 */

/**
 * Rule 204: Color Indicator
 */

/**
 * Rule 204.1 - Color indicator to the left of type line
 */
export interface ColorIndicator {
  readonly colors: readonly Color[];  // One or more colors
}

/**
 * Rule 205: Type Line
 */

/**
 * Rule 205.1 - Type line structure
 */
export interface TypeLine {
  readonly supertypes: readonly Supertype[];  // Before card types
  readonly cardTypes: readonly CardType[];     // Main types
  readonly subtypes: readonly Subtype[];       // After the dash
}

/**
 * Rule 205.1a - Type line format with em dash
 */
export function formatTypeLine(typeLine: TypeLine): string {
  const parts: string[] = [];
  
  if (typeLine.supertypes.length > 0) {
    parts.push(typeLine.supertypes.join(' '));
  }
  
  // Card types are lowercase in enum but should be capitalized in display
  const formattedTypes = typeLine.cardTypes.map(t => 
    t.charAt(0).toUpperCase() + t.slice(1)
  );
  parts.push(formattedTypes.join(' '));
  
  if (typeLine.subtypes.length > 0) {
    return `${parts.join(' ')} — ${typeLine.subtypes.join(' ')}`;
  }
  
  return parts.join(' ');
}

/**
 * Rule 205.2 - Card Types
 * Defined in objects.ts but enumerated here
 */

/**
 * Rule 205.3 - Subtypes
 */

/**
 * Rule 205.3a - Subtypes printed after dash
 */
export function getSubtypesFromTypeLine(typeLineText: string): string[] {
  const dashIndex = typeLineText.indexOf('—');
  if (dashIndex === -1) {
    return [];
  }
  
  return typeLineText
    .substring(dashIndex + 1)
    .trim()
    .split(/\s+/)
    .filter(s => s.length > 0);
}

/**
 * Rule 205.3c - Subtype correlation to card type
 */
export interface SubtypeCorrelation {
  readonly subtype: Subtype;
  readonly correspondingCardType: CardType;
}

/**
 * Rule 205.3d - Can't gain inappropriate subtype
 */
export function canGainSubtype(
  objectCardTypes: readonly CardType[],
  subtype: Subtype,
  subtypeCardType: CardType
): boolean {
  return objectCardTypes.includes(subtypeCardType);
}

/**
 * Rule 205.3e - Choosing a subtype
 */
export interface ChooseSubtypeConstraints {
  readonly cardType: CardType;          // Which card type the subtype must be for
  readonly mustBeExisting: boolean;     // Must be a real subtype
  readonly onlyOne: boolean;            // Can only choose one
}

/**
 * Rule 205.3g - Artifact types
 */
export enum ArtifactType {
  ATTRACTION = 'Attraction',
  BLOOD = 'Blood',
  BOBBLEHEAD = 'Bobblehead',
  CLUE = 'Clue',
  CONTRAPTION = 'Contraption',
  EQUIPMENT = 'Equipment',
  FOOD = 'Food',
  FORTIFICATION = 'Fortification',
  GOLD = 'Gold',
  INCUBATOR = 'Incubator',
  INFINITY = 'Infinity',
  JUNK = 'Junk',
  LANDER = 'Lander',
  MAP = 'Map',
  POWERSTONE = 'Powerstone',
  SPACECRAFT = 'Spacecraft',
  STONE = 'Stone',
  TREASURE = 'Treasure',
  VEHICLE = 'Vehicle'
}

/**
 * Rule 205.3h - Enchantment types
 */
export enum EnchantmentType {
  AURA = 'Aura',
  BACKGROUND = 'Background',
  CARTOUCHE = 'Cartouche',
  CASE = 'Case',
  CLASS = 'Class',
  CURSE = 'Curse',
  ROLE = 'Role',
  ROOM = 'Room',
  RUNE = 'Rune',
  SAGA = 'Saga',
  SHARD = 'Shard',
  SHRINE = 'Shrine'
}

/**
 * Rule 205.3i - Land types
 */
export enum LandType {
  CAVE = 'Cave',
  DESERT = 'Desert',
  FOREST = 'Forest',     // Basic
  GATE = 'Gate',
  ISLAND = 'Island',     // Basic
  LAIR = 'Lair',
  LOCUS = 'Locus',
  MINE = 'Mine',
  MOUNTAIN = 'Mountain', // Basic
  PLAINS = 'Plains',     // Basic
  PLANET = 'Planet',
  POWER_PLANT = 'Power-Plant',
  SPHERE = 'Sphere',
  SWAMP = 'Swamp',       // Basic
  TOWER = 'Tower',
  TOWN = 'Town',
  URZAS = "Urza's"
}

/**
 * Rule 205.3i - Basic land types
 */
export const BASIC_LAND_TYPES: readonly LandType[] = [
  LandType.FOREST,
  LandType.ISLAND,
  LandType.MOUNTAIN,
  LandType.PLAINS,
  LandType.SWAMP
];

/**
 * Check if land type is basic
 */
export function isBasicLandType(landType: LandType): boolean {
  return BASIC_LAND_TYPES.includes(landType);
}

/**
 * Rule 205.3k - Spell types (instant/sorcery)
 */
export enum SpellType {
  ADVENTURE = 'Adventure',
  ARCANE = 'Arcane',
  LESSON = 'Lesson',
  OMEN = 'Omen',
  TRAP = 'Trap'
}

/**
 * Rule 205.4 - Supertypes
 * (Defined in objects.ts, re-exported here for convenience)
 */

/**
 * Rule 205.4c - Basic land
 */
export function isBasicLand(supertypes: readonly Supertype[]): boolean {
  return supertypes.includes(Supertype.BASIC);
}

/**
 * Rule 205.4d - Legendary permanent (subject to legend rule)
 */
export function isLegendary(supertypes: readonly Supertype[]): boolean {
  return supertypes.includes(Supertype.LEGENDARY);
}

/**
 * Rule 205.4e - Legendary spell (casting restriction)
 */
export interface LegendarySpellRestriction {
  readonly canCast: boolean;  // Only if controlling legendary creature or planeswalker
  readonly controlsLegendaryCreature: boolean;
  readonly controlsLegendaryPlaneswalker: boolean;
}

/**
 * Rule 205.4f - World permanent (subject to world rule)
 */
export function isWorldPermanent(supertypes: readonly Supertype[]): boolean {
  return supertypes.includes(Supertype.WORLD);
}

/**
 * Rule 205.4g - Snow permanent
 */
export function isSnowPermanent(supertypes: readonly Supertype[]): boolean {
  return supertypes.includes(Supertype.SNOW);
}

/**
 * Rule 207: Text Box
 */

/**
 * Rule 207.1 - Text box contains abilities and flavor text
 */
export interface TextBox {
  readonly abilityText: string;    // Rules text
  readonly flavorText?: string;     // Italicized flavor text
  readonly reminderText?: string;   // Parenthesized reminder text
}

/**
 * Rule 207.2 - Text box parts
 */
export interface TextBoxParts {
  readonly abilities: readonly string[];  // Separate abilities (paragraph breaks)
  readonly flavorText?: string;
}

/**
 * Rule 208: Power/Toughness
 */

/**
 * Rule 208.1 - Power and toughness for creatures
 */
export interface PowerToughness {
  readonly power: number | '*';      // Can be * for characteristic-defining
  readonly toughness: number | '*';  // Can be * for characteristic-defining
}

/**
 * Rule 208.2 - Printed in lower right corner
 */
export function formatPowerToughness(pt: PowerToughness): string {
  return `${pt.power}/${pt.toughness}`;
}

/**
 * Rule 208.3 - Characteristic-defining ability with *
 */
export function hasCharacteristicDefiningPT(pt: PowerToughness): boolean {
  return pt.power === '*' || pt.toughness === '*';
}

/**
 * Rule 209: Loyalty
 */

/**
 * Rule 209.1 - Loyalty for planeswalkers
 */
export interface Loyalty {
  readonly startingLoyalty: number;  // Printed in lower right corner
}

/**
 * Rule 209.2 - Planeswalker enters with loyalty counters equal to printed loyalty
 */
export function getStartingLoyaltyCounters(loyalty: Loyalty): number {
  return loyalty.startingLoyalty;
}

/**
 * Complete card characteristics
 */
export interface CardCharacteristics {
  readonly name: CardName;
  readonly manaCost?: ManaCost;
  readonly colors: readonly Color[];        // From mana cost and color indicator
  readonly colorIndicator?: ColorIndicator;
  readonly typeLine: TypeLine;
  readonly textBox: TextBox;
  readonly powerToughness?: PowerToughness;
  readonly loyalty?: Loyalty;
  readonly defense?: number;                // For battles
}
