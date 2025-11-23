/**
 * Section 3: Card Types (Rules 300-315)
 * 
 * Defines rules for each card type in Magic: The Gathering.
 */

import { CardType } from './objects';

/**
 * Rule 300: General
 * 
 * Rule 300.1: The card types are artifact, battle, conspiracy, creature, dungeon,
 * enchantment, instant, kindred, land, phenomenon, plane, planeswalker, scheme,
 * sorcery, and vanguard.
 */

/**
 * Rule 300.2: Some objects have more than one card type (for example, an artifact creature).
 * Such objects combine the aspects of each of those card types.
 */
export function isMultiType(cardTypes: readonly CardType[]): boolean {
  return cardTypes.length > 1;
}

/**
 * Rule 300.2a: An object that's both a land and another card type can only be played as a land.
 * It can't be cast as a spell.
 */
export function canOnlyBePlayedAsLand(cardTypes: readonly CardType[]): boolean {
  return cardTypes.includes(CardType.LAND) && cardTypes.length > 1;
}

/**
 * Rule 301: Artifacts
 * 
 * Rule 301.1: A player who has priority may cast an artifact card from their hand
 * during a main phase of their turn when the stack is empty.
 */
export interface ArtifactRules {
  canCastDuringMainPhase: boolean;
  requiresStackEmpty: boolean;
}

export function getArtifactCastingRules(): ArtifactRules {
  return {
    canCastDuringMainPhase: true,
    requiresStackEmpty: false // Artifacts can be cast any time you could cast an instant if they have flash
  };
}

/**
 * Rule 301.5: Artifact subtypes are always a single word and are listed after a long dash.
 * See rule 205.3g for the complete list of artifact types.
 */

/**
 * Rule 302: Creatures
 * 
 * Rule 302.1: A player who has priority may cast a creature card from their hand
 * during a main phase of their turn when the stack is empty.
 */
export interface CreatureRules {
  canCastDuringMainPhase: boolean;
  requiresStackEmpty: boolean;
  hasPowerAndToughness: boolean;
}

export function getCreatureCastingRules(): CreatureRules {
  return {
    canCastDuringMainPhase: true,
    requiresStackEmpty: false,
    hasPowerAndToughness: true
  };
}

/**
 * Rule 302.3: Creature subtypes are always a single word and are listed after a long dash.
 * See rule 205.3m for the complete list of creature types.
 */

/**
 * Rule 302.4: Power and toughness are characteristics only creatures have.
 * (PowerToughness interface is defined in cardParts.ts)
 */

/**
 * Rule 302.6: A creature's activated ability with the tap symbol or the untap symbol
 * in its activation cost can't be activated unless the creature has been under its
 * controller's control continuously since their most recent turn began. A creature
 * can't attack unless it's been under its controller's control continuously since
 * their most recent turn began. This rule is informally called the "summoning sickness" rule.
 */
export interface SummoningSicknessState {
  objectId: string;
  controller: string;
  controlledSinceTurnStart: boolean;
}

export function hasSummoningSickness(state: SummoningSicknessState): boolean {
  return !state.controlledSinceTurnStart;
}

export function canAttack(state: SummoningSicknessState): boolean {
  return state.controlledSinceTurnStart;
}

export function canActivateTapAbility(state: SummoningSicknessState): boolean {
  return state.controlledSinceTurnStart;
}

/**
 * Rule 303: Enchantments
 * 
 * Rule 303.1: A player who has priority may cast an enchantment card from their hand
 * during a main phase of their turn when the stack is empty.
 */
export interface EnchantmentRules {
  canCastDuringMainPhase: boolean;
  requiresStackEmpty: boolean;
}

export function getEnchantmentCastingRules(): EnchantmentRules {
  return {
    canCastDuringMainPhase: true,
    requiresStackEmpty: false
  };
}

/**
 * Rule 303.4: Enchantment subtypes are always a single word and are listed after a long dash.
 * See rule 205.3h for the complete list of enchantment types.
 */

/**
 * Rule 303.4a: An Aura spell requires a target, which is defined by its enchant ability.
 */
export interface AuraTarget {
  enchantAbility: string; // e.g., "Enchant creature", "Enchant land"
  targetId?: string;
}

export function requiresTarget(enchantmentSubtypes: readonly string[]): boolean {
  return enchantmentSubtypes.includes('Aura');
}

/**
 * Rule 303.4f: If an Aura is entering the battlefield under a player's control by any means
 * other than by resolving as an Aura spell, and the effect putting it onto the battlefield
 * doesn't specify the object or player the Aura will enchant, that player chooses what it
 * will enchant as the Aura enters the battlefield.
 */

/**
 * Rule 304: Instants
 * 
 * Rule 304.1: A player who has priority may cast an instant card from their hand.
 * Casting an instant as a spell uses the stack.
 */
export interface InstantRules {
  canCastAnytime: boolean; // When player has priority
  requiresMainPhase: boolean;
  requiresStackEmpty: boolean;
}

export function getInstantCastingRules(): InstantRules {
  return {
    canCastAnytime: true,
    requiresMainPhase: false,
    requiresStackEmpty: false
  };
}

/**
 * Rule 304.2: When an instant spell resolves, the actions stated in its rules text
 * are followed. Then it's put into its owner's graveyard.
 */

/**
 * Rule 304.3: Instant subtypes are always a single word and are listed after a long dash.
 * See rule 205.3k for the complete list of spell types.
 */

/**
 * Rule 304.4: Instants can't enter the battlefield. If an instant would enter the
 * battlefield, it remains in its previous zone instead.
 */
export function canEnterBattlefield(cardType: CardType): boolean {
  return cardType !== CardType.INSTANT && cardType !== CardType.SORCERY;
}

/**
 * Rule 305: Lands
 * 
 * Rule 305.1: A player who has priority may play a land card from their hand during
 * a main phase of their turn when the stack is empty. Playing a land is a special
 * action; it doesn't use the stack. (See rule 116, "Special Actions.")
 */
export interface LandPlayRules {
  isSpecialAction: boolean;
  requiresMainPhase: boolean;
  requiresStackEmpty: boolean;
  requiresOwnTurn: boolean;
  usesStack: boolean;
}

export function getLandPlayRules(): LandPlayRules {
  return {
    isSpecialAction: true,
    requiresMainPhase: true,
    requiresStackEmpty: true,
    requiresOwnTurn: true,
    usesStack: false
  };
}

/**
 * Rule 305.2: A player can normally play one land during their turn; however,
 * continuous effects may increase this number.
 */
export interface LandPlayState {
  landsPlayedThisTurn: number;
  maxLandsPerTurn: number;
}

export function canPlayLand(state: LandPlayState): boolean {
  return state.landsPlayedThisTurn < state.maxLandsPerTurn;
}

/**
 * Rule 305.3: A player can't play a land, for any reason, if the number of lands
 * the player can play this turn is equal to or less than the number of lands they
 * have already played this turn.
 */

/**
 * Rule 305.6: The basic land types are Plains, Island, Swamp, Mountain, and Forest.
 * If an object uses the words "basic land type," it's referring to one of these subtypes.
 * (BasicLandType enum and isBasicLandType function are defined in cardParts.ts)
 */

/**
 * Rule 305.7: If an effect sets a land's subtype to one or more of the basic land types,
 * the land no longer has its old land type. It loses all abilities generated from its
 * rules text, its old land types, and any copiable effects affecting that land, and it
 * gains the appropriate mana ability for each new basic land type.
 */

/**
 * Rule 305.8: Any land with the supertype "basic" is a basic land.
 */

/**
 * Rule 306: Planeswalkers
 * 
 * Rule 306.1: A player who has priority may cast a planeswalker card from their hand
 * during a main phase of their turn when the stack is empty.
 */
export interface PlaneswalkerRules {
  canCastDuringMainPhase: boolean;
  requiresStackEmpty: boolean;
  hasLoyalty: boolean;
}

export function getPlaneswalkerCastingRules(): PlaneswalkerRules {
  return {
    canCastDuringMainPhase: true,
    requiresStackEmpty: false,
    hasLoyalty: true
  };
}

/**
 * Rule 306.4: Previously, planeswalkers were subject to a "planeswalker uniqueness rule"
 * that stopped a player from controlling two planeswalkers of the same planeswalker type.
 * This rule has been removed and planeswalker cards are treated only as legendary permanents.
 */

/**
 * Rule 306.5: Loyalty is a characteristic only planeswalkers have.
 */

/**
 * Rule 306.5b: A planeswalker has the intrinsic ability "This permanent enters with a
 * number of loyalty counters on it equal to its printed loyalty number."
 */

/**
 * Rule 306.5c: The loyalty of a planeswalker on the battlefield is equal to the number
 * of loyalty counters on it.
 */

/**
 * Rule 306.5d: Each planeswalker has a number of loyalty abilities, which are activated
 * abilities with loyalty symbols in their costs.
 */

/**
 * Rule 306.7: If a planeswalker's loyalty is 0, it's put into its owner's graveyard.
 * (This is a state-based action. See rule 704.)
 */

/**
 * Rule 307: Sorceries
 * 
 * Rule 307.1: A player who has priority may cast a sorcery card from their hand
 * during a main phase of their turn when the stack is empty.
 */
export interface SorceryRules {
  canCastDuringMainPhase: boolean;
  requiresStackEmpty: boolean;
  requiresOwnTurn: boolean;
}

export function getSorceryCastingRules(): SorceryRules {
  return {
    canCastDuringMainPhase: true,
    requiresStackEmpty: true,
    requiresOwnTurn: true
  };
}

/**
 * Rule 307.2: When a sorcery spell resolves, the actions stated in its rules text
 * are followed. Then it's put into its owner's graveyard.
 */

/**
 * Rule 307.3: Sorcery subtypes are always a single word and are listed after a long dash.
 * The set of sorcery subtypes is the same as the set of instant subtypes; these subtypes
 * are called spell types.
 */

/**
 * Rule 307.4: Sorceries can't enter the battlefield. If a sorcery would enter the
 * battlefield, it remains in its previous zone instead.
 */

/**
 * Rule 307.5: If a spell, ability, or effect states that a player can do something
 * only "any time they could cast a sorcery" or "only as a sorcery," it means only
 * that the player must have priority, it must be during the main phase of their turn,
 * and the stack must be empty.
 */
export interface SorceryTimingContext {
  hasPriority: boolean;
  isMainPhase: boolean;
  isOwnTurn: boolean;
  isStackEmpty: boolean;
}

export function canDoAsSorcery(context: SorceryTimingContext): boolean {
  return context.hasPriority && 
         context.isMainPhase && 
         context.isOwnTurn && 
         context.isStackEmpty;
}

/**
 * Rule 308: Kindreds
 * 
 * Rule 308.1: Each kindred card has another card type. Casting and resolving a kindred
 * card follows the rules for casting and resolving a card of the other card type.
 */
export interface KindredCard {
  kindredType: CardType;
  otherCardType: CardType; // The primary card type
  creatureTypes: readonly string[]; // Kindred subtypes are creature types
}

/**
 * Rule 308.2: Kindred subtypes are usually a single word long. The set of kindred
 * subtypes is the same as the set of creature subtypes; these subtypes are called
 * creature types.
 */

/**
 * Rule 308.3: Some older kindred cards were printed with the "tribal" card type.
 * Cards printed with that type have received errata in the Oracle card reference.
 */

/**
 * Rule 309: Dungeons
 * 
 * Rule 309.1: Dungeon is a card type seen only on nontraditional Magic cards.
 */
export interface DungeonCard {
  rooms: readonly DungeonRoom[];
}

export interface DungeonRoom {
  name: string; // Flavor text
  roomAbility: string; // "When you move your venture marker into this room, [effect]"
}

/**
 * Rule 309.2: Dungeon cards begin outside the game. They are brought into the game
 * using the venture into the dungeon keyword action.
 */

/**
 * Rule 309.2b: A dungeon card that's brought into the game is put into the command
 * zone until it leaves the game.
 */

/**
 * Rule 309.2c: Dungeon cards are not permanents. They can't be cast.
 */

/**
 * Rule 310: Battles
 * 
 * Rule 310.1: A player who has priority may cast a battle card from their hand
 * during a main phase of their turn when the stack is empty.
 */
export interface BattleRules {
  canCastDuringMainPhase: boolean;
  requiresStackEmpty: boolean;
  hasDefense: boolean;
}

export function getBattleCastingRules(): BattleRules {
  return {
    canCastDuringMainPhase: true,
    requiresStackEmpty: false,
    hasDefense: true
  };
}

/**
 * Rule 310.4: Defense is a characteristic that battles have.
 */
export interface BattleDefense {
  printedDefense: number;
  defenseCounters: number;
}

export function getCurrentDefense(battle: BattleDefense): number {
  return battle.defenseCounters;
}

/**
 * Rule 310.4b: A battle has the intrinsic ability "This permanent enters with a
 * number of defense counters on it equal to its printed defense number."
 */

/**
 * Rule 310.5: Battles can be attacked.
 */

/**
 * Rule 310.6: Damage dealt to a battle results in that many defense counters being
 * removed from it.
 */
export function applyDamageToBattle(battle: BattleDefense, damage: number): BattleDefense {
  return {
    ...battle,
    defenseCounters: Math.max(0, battle.defenseCounters - damage)
  };
}

/**
 * Rule 310.7: If a battle's defense is 0 and it isn't the source of an ability
 * which has triggered but not yet left the stack, it's put into its owner's graveyard.
 * (This is a state-based action.)
 */
export function shouldBattleDie(battle: BattleDefense): boolean {
  return battle.defenseCounters === 0;
}

/**
 * Rule 310.8: Each battle has a player designated as its protector.
 */
export interface BattleProtector {
  battleId: string;
  protectorId: string;
  controllerId: string;
}

/**
 * Rule 310.8a: As a battle enters the battlefield, its controller chooses a player
 * to be its protector.
 */

/**
 * Rule 310.11: All currently existing battles have the subtype Siege.
 */
export enum BattleType {
  SIEGE = 'Siege'
}

/**
 * Rule 310.11a: As a Siege enters the battlefield, its controller must choose its
 * protector from among their opponents.
 */
export function canBeProtector(battleController: string, potentialProtector: string, opponents: readonly string[]): boolean {
  return opponents.includes(potentialProtector);
}

/**
 * Rule 311-315: Planes, Phenomena, Vanguards, Schemes, Conspiracies
 * 
 * These are nontraditional Magic card types used in casual variants.
 */

/**
 * Rule 311: Planes
 * Card type seen only in Planechase casual variant.
 */

/**
 * Rule 312: Phenomena  
 * Card type seen only in Planechase casual variant.
 */

/**
 * Rule 313: Vanguards
 * Card type seen only in Vanguard casual variant.
 */

/**
 * Rule 314: Schemes
 * Card type seen only in Archenemy casual variant.
 */

/**
 * Rule 315: Conspiracies
 * Card type that starts the game in the command zone in Conspiracy Draft.
 */

export interface NontraditionalCardRules {
  isNontraditional: boolean;
  canBeCast: boolean;
  startsInCommandZone: boolean;
}

export function getPlanesRules(): NontraditionalCardRules {
  return {
    isNontraditional: true,
    canBeCast: false,
    startsInCommandZone: true
  };
}

export function getPhenomenaRules(): NontraditionalCardRules {
  return {
    isNontraditional: true,
    canBeCast: false,
    startsInCommandZone: true
  };
}

export function getVanguardRules(): NontraditionalCardRules {
  return {
    isNontraditional: true,
    canBeCast: false,
    startsInCommandZone: true
  };
}

export function getSchemeRules(): NontraditionalCardRules {
  return {
    isNontraditional: true,
    canBeCast: false,
    startsInCommandZone: true
  };
}

export function getConspiracyRules(): NontraditionalCardRules {
  return {
    isNontraditional: true,
    canBeCast: false,
    startsInCommandZone: true
  };
}
