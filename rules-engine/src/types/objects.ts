/**
 * Rules 108-110: Cards, Objects, and Permanents
 * Core type definitions for game objects
 */

import { ObjectColor } from './colors';
import { ManaSymbol } from './numbers';

/**
 * Rule 108.3 - Card owner
 * The player who started the game with it in their deck
 */
export type OwnerID = string;

/**
 * Rule 108.4, 109.4 - Controller
 * Only objects on stack or battlefield have a controller
 */
export type ControllerID = string;

/**
 * Unique identifier for any object in the game
 */
export type ObjectID = string;

/**
 * Rule 109.3 - Object characteristics
 * name, mana cost, color, color indicator, card type, subtype, supertype,
 * rules text, abilities, power, toughness, loyalty, defense, hand/life modifiers
 */
export interface ObjectCharacteristics {
  readonly name: string;
  readonly manaCost?: ManaSymbol[];
  readonly colors: ObjectColor;
  readonly colorIndicator?: ObjectColor;
  readonly types: CardType[];
  readonly subtypes: string[];
  readonly supertypes: Supertype[];
  readonly rulesText: string;
  readonly power?: number;      // For creatures
  readonly toughness?: number;  // For creatures
  readonly loyalty?: number;    // For planeswalkers
  readonly defense?: number;    // For battles
  readonly handModifier?: number;  // For vanguards
  readonly lifeModifier?: number;  // For vanguards
}

/**
 * Rule 110.4 - Six permanent types
 * Rule 304-307 - Instant and sorcery can't be permanents
 */
export enum CardType {
  ARTIFACT = 'artifact',
  BATTLE = 'battle',
  CREATURE = 'creature',
  ENCHANTMENT = 'enchantment',
  LAND = 'land',
  PLANESWALKER = 'planeswalker',
  INSTANT = 'instant',
  SORCERY = 'sorcery',
  KINDRED = 'kindred',
  DUNGEON = 'dungeon',
  PLANE = 'plane',
  PHENOMENON = 'phenomenon',
  VANGUARD = 'vanguard',
  SCHEME = 'scheme',
  CONSPIRACY = 'conspiracy'
}

// Rule 110.4a - Permanent card types
export const PERMANENT_CARD_TYPES: readonly CardType[] = [
  CardType.ARTIFACT,
  CardType.BATTLE,
  CardType.CREATURE,
  CardType.ENCHANTMENT,
  CardType.LAND,
  CardType.PLANESWALKER
] as const;

export function isPermanentType(type: CardType): boolean {
  return PERMANENT_CARD_TYPES.includes(type);
}

/**
 * Supertypes that can appear on cards
 */
export enum Supertype {
  BASIC = 'basic',
  LEGENDARY = 'legendary',
  SNOW = 'snow',
  WORLD = 'world',
  ONGOING = 'ongoing'
}

/**
 * Subtypes (rule 205.3)
 * Represented as strings since there are many and they vary by card type
 */
export type Subtype = string;

/**
 * Rule 109.1 - An object is one of:
 * - An ability on the stack
 * - A card
 * - A copy of a card
 * - A token
 * - A spell
 * - A permanent
 * - An emblem
 */
export enum ObjectType {
  ABILITY = 'ability',
  CARD = 'card',
  COPY = 'copy',
  TOKEN = 'token',
  SPELL = 'spell',
  PERMANENT = 'permanent',
  EMBLEM = 'emblem'
}

/**
 * Rule 108 - Card definition
 */
export interface Card extends ObjectCharacteristics {
  readonly id: ObjectID;
  readonly owner: OwnerID;
  readonly isCopy: boolean;
  readonly isToken: boolean;
}

/**
 * Rule 110.5 - Permanent status (physical state)
 * Four status categories: tapped/untapped, flipped/unflipped, face up/down, phased in/out
 */
export interface PermanentStatus {
  readonly tapped: boolean;
  readonly flipped: boolean;
  readonly faceDown: boolean;
  readonly phasedOut: boolean;
}

/**
 * Rule 110 - Permanent
 * A card or token on the battlefield
 */
export interface Permanent extends Card {
  readonly controller: ControllerID;
  readonly status: PermanentStatus;
  readonly enteredThisTurn: boolean;
  readonly summoningSick: boolean;  // Relevant for creatures
  readonly damage: number;  // Damage marked on permanent
}

/**
 * Zones where objects can exist (Rule 400)
 */
export enum Zone {
  LIBRARY = 'library',
  HAND = 'hand',
  BATTLEFIELD = 'battlefield',
  GRAVEYARD = 'graveyard',
  STACK = 'stack',
  EXILE = 'exile',
  COMMAND = 'command',
  ANTE = 'ante'
}

/**
 * Helper to create default permanent status
 */
export function createDefaultPermanentStatus(): PermanentStatus {
  return {
    tapped: false,
    flipped: false,
    faceDown: false,
    phasedOut: false
  };
}
