/**
 * Rules 111-112, 114: Tokens, Spells, and Emblems
 */

import { ObjectID, OwnerID, ControllerID, ObjectCharacteristics, CardType } from './objects';

/**
 * Rule 111 - Tokens
 * Not cards, but can be permanents
 */

/**
 * Rule 111.2 - Token ownership and control
 * The player who creates a token is its owner and it enters under their control
 */
export interface TokenDefinition extends ObjectCharacteristics {
  readonly id: ObjectID;
  readonly owner: OwnerID;
  readonly isToken: true;
  readonly isCopy: boolean; // Can be a copy of another object
}

/**
 * Rule 111.3 - Token characteristics defined by creating spell/ability
 */
export interface TokenCreationSpec {
  readonly name?: string; // If not specified, uses subtype + "Token"
  readonly colors?: string[];
  readonly types: CardType[];
  readonly subtypes: string[];
  readonly supertypes?: string[];
  readonly power?: number;
  readonly toughness?: number;
  readonly abilities?: string[];
  readonly rulesText?: string;
}

/**
 * Rule 111.10 - Predefined tokens
 * Common token types with standard characteristics
 */
export enum PredefinedTokenType {
  TREASURE = 'treasure',     // 111.10a - Colorless artifact with tap/sac for mana
  FOOD = 'food',            // 111.10b - Colorless artifact with pay/tap/sac for life
  GOLD = 'gold',            // 111.10c - Colorless artifact with sac for mana
  WALKER = 'walker',        // 111.10d - 2/2 black Zombie named Walker
  SHARD = 'shard',          // 111.10e - Colorless enchantment
  CLUE = 'clue',            // 111.10f - Colorless artifact with pay/sac for draw
  BLOOD = 'blood',          // 111.10g - Colorless artifact
  POWERSTONE = 'powerstone', // 111.10h - Colorless artifact for colorless mana
  // Add others as needed from 111.10i onwards
}

/**
 * Get predefined token characteristics
 */
export function getPredefinedToken(type: PredefinedTokenType): TokenCreationSpec {
  switch (type) {
    case PredefinedTokenType.TREASURE:
      return {
        name: 'Treasure',
        types: [CardType.ARTIFACT],
        subtypes: ['Treasure'],
        colors: [],
        abilities: ['{T}, Sacrifice this token: Add one mana of any color.']
      };
    case PredefinedTokenType.CLUE:
      return {
        name: 'Clue',
        types: [CardType.ARTIFACT],
        subtypes: ['Clue'],
        colors: [],
        abilities: ['{2}, Sacrifice this token: Draw a card.']
      };
    case PredefinedTokenType.FOOD:
      return {
        name: 'Food',
        types: [CardType.ARTIFACT],
        subtypes: ['Food'],
        colors: [],
        abilities: ['{2}, {T}, Sacrifice this token: You gain 3 life.']
      };
    // Add other predefined tokens as needed
    default:
      throw new Error(`Unknown predefined token type: ${type}`);
  }
}

/**
 * Rule 111.7 - Tokens cease to exist when they leave the battlefield
 * This is a state-based action
 */
export function tokenCeasesToExist(tokenId: ObjectID): boolean {
  // This would be called by state-based action processing
  // Returns true if token is not on battlefield
  return true;
}

/**
 * Rule 112 - Spells
 * A card on the stack
 */

/**
 * Rule 112.1 - A spell is a card on the stack
 */
export interface Spell {
  readonly id: ObjectID;
  readonly cardId: ObjectID; // The card this spell represents
  readonly owner: OwnerID;
  readonly controller: ControllerID;
  readonly characteristics: ObjectCharacteristics;
  readonly targets?: SpellTarget[];
  readonly modes?: string[]; // Modal spells can have multiple modes
  readonly xValue?: number; // Value chosen for X costs
  readonly timestamp: number; // When it was put on the stack
  readonly isCopy: boolean; // Rule 112.1a - Copies of spells
}

/**
 * Spell targets
 */
export interface SpellTarget {
  readonly type: 'permanent' | 'player' | 'spell' | 'card';
  readonly id: ObjectID | OwnerID;
  readonly isValid: boolean; // Can become invalid if target is removed
}

/**
 * Rule 112.2 - Spell ownership and control
 */
export interface SpellOwnership {
  readonly owner: OwnerID;
  readonly controller: ControllerID;
}

/**
 * Rule 114 - Emblems
 * Objects in command zone with abilities
 */

/**
 * Rule 114.1 - Some effects create emblems
 * Emblems are objects in the command zone
 */
export interface Emblem {
  readonly id: ObjectID;
  readonly owner: OwnerID; // Rule 109.4c - Controlled by the player who put it in command zone
  readonly name: string;
  readonly abilities: string[]; // Ability text
  readonly createdBy?: ObjectID; // What created this emblem
  readonly timestamp: number;
}

/**
 * Rule 114.2 - An emblem has no characteristics other than abilities
 */
export interface EmblemCreationSpec {
  readonly name: string;
  readonly abilities: string[];
}

/**
 * Rule 114.3 - Emblems function in the command zone
 */
export function createEmblem(owner: OwnerID, spec: EmblemCreationSpec): Emblem {
  return {
    id: `emblem-${Date.now()}-${Math.random()}`,
    owner,
    name: spec.name,
    abilities: spec.abilities,
    timestamp: Date.now()
  };
}

/**
 * Check if an emblem's ability is active
 * Emblems always function in the command zone
 */
export function isEmblemAbilityActive(emblem: Emblem): boolean {
  return true; // Emblems are always active in command zone
}
