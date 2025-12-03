/**
 * triggers/types.ts
 * 
 * Shared types and interfaces for the triggered abilities system.
 */

import type { GameContext } from "../../context.js";

// Re-export GameContext for convenience
export type { GameContext };

/**
 * Trigger timing - when the trigger should fire
 */
export type TriggerTiming = 
  | 'upkeep'           // At the beginning of upkeep
  | 'draw_step'        // At the beginning of draw step
  | 'precombat_main'   // At the beginning of precombat main
  | 'begin_combat'     // At the beginning of combat
  | 'declare_attackers'// When attackers are declared
  | 'declare_blockers' // When blockers are declared
  | 'combat_damage'    // When combat damage is dealt
  | 'end_combat'       // At end of combat
  | 'postcombat_main'  // At the beginning of postcombat main
  | 'end_step'         // At the beginning of end step
  | 'cleanup'          // During cleanup step
  | 'etb'              // When something enters the battlefield
  | 'ltb'              // When something leaves the battlefield
  | 'dies'             // When something dies
  | 'cast'             // When a spell is cast
  | 'draw'             // When a card is drawn
  | 'discard'          // When a card is discarded
  | 'damage'           // When damage is dealt
  | 'life_change'      // When life total changes
  | 'counter'          // When counters are added/removed
  | 'tap'              // When something becomes tapped
  | 'untap';           // When something becomes untapped

/**
 * Registered trigger on a permanent - marks what triggers the permanent has
 */
export interface RegisteredTrigger {
  id: string;
  permanentId: string;
  controllerId: string;
  cardName: string;
  timing: TriggerTiming;
  condition?: string;      // Additional condition text
  effect: string;          // Effect description
  mandatory: boolean;
  requiresTarget?: boolean;
  requiresChoice?: boolean;
  triggerOnce?: boolean;   // Some triggers only fire once per turn
  hasFiredThisTurn?: boolean;
}

/**
 * Generic triggered ability result
 */
export interface TriggeredAbility {
  permanentId: string;
  cardName: string;
  controllerId: string;
  type: string;
  description: string;
  effect?: string;
  mandatory?: boolean;
  requiresTarget?: boolean;
  targetType?: string;
  affectsController?: boolean;
  affectsOpponents?: boolean;
  affectsAllPlayers?: boolean;
}

/**
 * Beginning of combat trigger
 */
export interface BeginningOfCombatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
  requiresChoice?: boolean;
}

/**
 * End step trigger
 */
export interface EndStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'end_step_resource' | 'end_step_effect';
  description: string;
  effect?: string;
  mandatory: boolean;
  requiresChoice?: boolean;
  affectsAllPlayers?: boolean;
}

/**
 * Draw step trigger
 */
export interface DrawStepTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
}

/**
 * End of combat trigger
 */
export interface EndOfCombatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect?: string;
  mandatory: boolean;
}

/**
 * Death trigger result
 */
export interface DeathTriggerResult {
  source: {
    permanentId: string;
    cardName: string;
    controllerId: string;
  };
  effect: string;
  targets?: string[]; // Player IDs affected
  requiresSacrificeSelection?: boolean;
  sacrificeFrom?: string; // Player ID who must sacrifice
}

/**
 * Untap step effect
 */
export interface UntapStepEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: 'untap_all' | 'untap_target' | 'untap_additional' | 'prevent_untap' | 'untap_during_opponents';
  targetType?: string;
  count?: number;
  condition?: string;
  description: string;
}

/**
 * ETB untap effect (Intruder Alarm, etc.)
 */
export interface ETBUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: 'untap_all_creatures' | 'untap_all_your_creatures' | 'untap_equipped' | 'untap_target';
  condition?: string;
  description: string;
}

/**
 * Spell-cast untap effect
 */
export interface SpellCastUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: 'untap_all_nonland' | 'untap_all_creatures' | 'untap_equipped';
  spellCondition?: 'any' | 'noncreature' | 'instant_sorcery';
  additionalEffect?: string;
  description: string;
}

/**
 * Spell-cast trigger
 */
export interface SpellCastTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  spellCondition: 'any' | 'creature' | 'noncreature' | 'instant_sorcery' | 'tribal_type';
  tribalType?: string;
  requiresTarget?: boolean;
  targetType?: string;
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
    abilities?: string[];
  };
  mandatory: boolean;
}

/**
 * Tap trigger
 */
export interface TapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'on_tap' | 'on_untap' | 'on_becomes_tapped' | 'on_becomes_untapped';
  affectedType?: 'self' | 'creature' | 'artifact' | 'any_permanent';
  description: string;
  effect?: string;
  mandatory: boolean;
}

/**
 * Untap trigger
 */
export interface UntapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerCondition: 'on_attack' | 'on_combat_damage' | 'on_untap_step';
  description: string;
  mandatory: boolean;
}

/**
 * "Doesn't untap" effect
 */
export interface DoesntUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: 'self' | 'all_creatures' | 'opponents_creatures' | 'specific_permanent';
  targetPermanentId?: string;
  condition?: string;
  description: string;
  isTemporary?: boolean;
}

/**
 * Card draw trigger
 */
export interface CardDrawTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType: 'on_draw' | 'on_each_draw' | 'draw_replacement' | 'draw_for_opponents';
  affectsPlayer?: 'controller' | 'all_players' | 'opponents';
  additionalEffect?: string;
  description: string;
  mandatory: boolean;
}

/**
 * Imprint effect (for Mimic Vat, etc.)
 */
export interface ImprintEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  imprintedCard?: any;
  triggerType: 'on_creature_death' | 'on_artifact_ltb';
  description: string;
}

/**
 * Auto-sacrifice ETB effect (for Kroxa, etc.)
 */
export interface AutoSacrificeETB {
  permanentId: string;
  cardName: string;
  controllerId: string;
  condition: 'not_escaped' | 'not_cast';
  description: string;
}

/**
 * Devotion result
 */
export interface DevotionResult {
  total: number;
  byColor: Record<string, number>;
}

// WinCondition is defined in win-conditions.ts

/**
 * Transform/flip trigger
 */
export interface TransformTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  transformCondition: string;
  backFace?: any;
  description: string;
}

// LandfallTrigger is defined in landfall.ts

/**
 * Static ability info
 */
export interface StaticAbilityInfo {
  permanentId: string;
  cardName: string;
  controllerId: string;
  abilityType: string;
  description: string;
  affectsController?: boolean;
  affectsOpponents?: boolean;
  affectsAll?: boolean;
}

/**
 * Storm info
 */
export interface StormInfo {
  stormCount: number;
  playerId: string;
}

/**
 * Hideaway trigger
 */
export interface HideawayTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  exiledCard?: any;
  castCondition: string;
  description: string;
}

/**
 * Damage redirection effect
 */
export interface DamageRedirectionEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  redirectType: 'to_creature' | 'to_player' | 'to_controller';
  targetId?: string;
  description: string;
}

/**
 * Empire artifact effect
 */
export interface EmpireArtifactEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  empireType: 'crown' | 'scepter' | 'throne';
  baseEffect: string;
  enhancedEffect?: string;
  hasAllThree?: boolean;
}

/**
 * Mana fixing effect
 */
export interface ManaFixingEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: 'lands_tap_any' | 'creatures_tap_mana' | 'add_any_color';
  description: string;
}

/**
 * Power/toughness boost effect
 */
export interface PowerToughnessBoostEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  boostType: 'static' | 'etb' | 'until_eot';
  power: number | string;
  toughness: number | string;
  affectsType?: string;
  condition?: string;
  description: string;
}

/**
 * Lure/must attack effect
 */
export interface LureEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: 'must_be_blocked' | 'must_attack' | 'goad';
  targetId?: string;
  description: string;
}

/**
 * Ward/protection effect
 */
export interface WardEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  wardType: 'first_spell' | 'pay_cost' | 'hexproof_conditional';
  cost?: string;
  usedThisTurn?: boolean;
  description: string;
}

/**
 * Dynamic P/T calculation
 */
export interface DynamicPowerToughness {
  permanentId: string;
  cardName: string;
  basedOn: 'life_total' | 'card_count' | 'creature_count' | 'land_count' | 'graveyard_count';
  description: string;
}

/**
 * Mill effect
 */
export interface MassMillEffect {
  permanentId: string;
  cardName: string;
  millAmount: number | 'half_library';
  targetType: 'opponent' | 'all_opponents' | 'target_player';
  description: string;
}

/**
 * Quest counter
 */
export interface QuestCounter {
  permanentId: string;
  cardName: string;
  controllerId: string;
  incrementCondition: string;
  completionThreshold: number;
  completionEffect: string;
  currentCount: number;
}

/**
 * Utility land ability
 */
export interface UtilityLandAbility {
  permanentId: string;
  cardName: string;
  controllerId: string;
  abilityType: string;
  cost: string;
  effect: string;
  description: string;
}

/**
 * Equipment effect
 */
export interface EquipmentEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  equipCost: string;
  grantedAbilities: string[];
  powerBonus: number;
  toughnessBonus: number;
  specialEffect?: string;
  description: string;
}

/**
 * Totem armor effect
 */
export interface TotemArmorEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  attachedTo?: string;
  description: string;
}

/**
 * Eldrazi effect
 */
export interface EldraziEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: 'annihilator' | 'indestructible' | 'cast_trigger' | 'attack_trigger';
  annihilatorValue?: number;
  castEffect?: string;
  attackEffect?: string;
  description: string;
}

/**
 * Control change effect
 */
export interface ControlChangeEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  changeType: 'exchange_control' | 'gain_control' | 'temporary_control';
  duration?: string;
  targetType?: string;
  description: string;
}

/**
 * Infect grant effect
 */
export interface InfectGrantEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  affectsType: 'all_creatures' | 'your_creatures' | 'equipped_creature';
  grantsTrample?: boolean;
  powerBoost?: number;
  toughnessBoost?: number;
  description: string;
}

/**
 * Group draw effect
 */
export interface GroupDrawEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  activationCost: string;
  drawAmount: number;
  affectsPlayers: 'all' | 'each_opponent' | 'target_player';
  description: string;
}

/**
 * Multi-target land search
 */
export interface MultiTargetLandSearch {
  permanentId: string;
  cardName: string;
  controllerId: string;
  searchCount: number;
  landType?: string;
  mustShareType?: boolean;
  entersTapped?: boolean;
  description: string;
}

/**
 * Conditional ETB tapped
 */
export interface ConditionalETBTapped {
  permanentId: string;
  cardName: string;
  controllerId: string;
  condition: 'control_forest' | 'control_island' | 'control_land_type' | 'pay_life' | 'reveal_type';
  landTypeRequired?: string;
  lifeCost?: number;
  revealType?: string;
  description: string;
}

/**
 * Multi-mode activated ability
 */
export interface MultiModeActivatedAbility {
  permanentId: string;
  cardName: string;
  controllerId: string;
  modes: Array<{
    cost: string;
    effect: string;
    description: string;
  }>;
}

/**
 * Library reveal/play effect
 */
export interface LibraryRevealPlayEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  revealCount: number | 'X';
  playableTypes?: string[];
  putIntoPlay?: boolean;
  toHand?: boolean;
  xBasedOn?: string;
  description: string;
}

/**
 * Reanimate effect
 */
export interface ReanimateEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  targetZone: 'your_graveyard' | 'any_graveyard' | 'all_graveyards';
  targetType?: string;
  manaValueRestriction?: number | 'X' | 'power_or_less';
  additionalEffect?: string;
  description: string;
}

/**
 * Top card view effect
 */
export interface TopCardViewEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  viewType: 'look_top' | 'play_top' | 'reveal_top';
  playableTypes?: string[];
  description: string;
}

/**
 * Power-based land search
 */
export interface PowerBasedLandSearch {
  permanentId: string;
  cardName: string;
  controllerId: string;
  basedOn: 'greatest_power' | 'total_power' | 'creature_count';
  landType?: string;
  entersTapped?: boolean;
  description: string;
}

/**
 * Charge counter ability
 */
export interface ChargeCounterAbility {
  permanentId: string;
  cardName: string;
  controllerId: string;
  initialCounters: number;
  incrementCondition?: string;
  activationCost: string;
  effectPerCounter?: string;
  removeToActivate?: boolean;
  description: string;
}

/**
 * Special card effect
 */
export interface SpecialCardEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effectType: string;
  description: string;
  activationCost?: string;
  effect?: string;
}

/**
 * Loyalty ability
 */
export interface LoyaltyAbility {
  index: number;
  cost: number | 'X' | '-X';
  effect: string;
  isUltimate: boolean;
  requiresTarget?: boolean;
  targetType?: string;
}

/**
 * Planeswalker abilities
 */
export interface PlaneswalkerAbilities {
  permanentId: string;
  cardName: string;
  controllerId: string;
  startingLoyalty: number;
  currentLoyalty: number;
  abilities: LoyaltyAbility[];
  hasActivatedThisTurn: boolean;
  activationsThisTurn: number;
}

/**
 * Must-block effect
 */
export interface MustBlockEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  mustBeBlockedBy: 'all' | 'able_creatures';
  description: string;
}

/**
 * Targeting protection
 */
export interface TargetingProtection {
  permanentId: string;
  cardName: string;
  controllerId: string;
  protectionType: 'hexproof' | 'shroud' | 'ward' | 'conditional';
  condition?: string;
  description: string;
}

/**
 * Transform check result
 */
export interface TransformCheckResult {
  permanentId: string;
  cardName: string;
  shouldTransform: boolean;
  reason: string;
  newFace?: any;
}

/**
 * Hideaway ability
 */
export interface HideawayAbility {
  hideawayCount: number;
  condition: string;
  permanentId: string;
  exiledCardId?: string;
}

/**
 * Damage redirection effect
 */
export interface DamageRedirection {
  permanentId: string;
  cardName: string;
  from: 'controller' | 'chosen_player';
  to: 'this_creature' | 'enchanted_creature' | 'equipped_creature' | 'chosen_player';
  chosenPlayerId?: string;
}

/**
 * Mana ability granter (Chromatic Lantern, Cryptolith Rite, etc.)
 */
export interface ManaAbilityGranter {
  permanentId: string;
  cardName: string;
  grantsTo: 'lands' | 'creatures' | 'all_permanents';
  manaType: 'any_color' | 'specific_color';
  specificColor?: string;
}

/**
 * Mass power/toughness boost effect (Craterhoof Behemoth, etc.)
 */
export interface MassBoostEffect {
  permanentId: string;
  cardName: string;
  boostType: 'creature_count' | 'greatest_power' | 'fixed' | 'conditional';
  fixedBoost?: { power: number; toughness: number };
  grantsKeywords?: string[];
  condition?: string;
  duration: 'until_eot' | 'static';
}

/**
 * Modal spell mode
 */
export interface ModalSpellMode {
  index: number;
  text: string;
  effect: string;
}

/**
 * Modal spell info
 */
export interface ModalSpellInfo {
  isModal: boolean;
  modes: ModalSpellMode[];
  minModes: number;
  maxModes: number;
}

/**
 * Storm trigger
 */
export interface StormTrigger {
  permanentId: string;
  cardName: string;
  stormCount: number;
}

/**
 * Empires bonus (Crown, Scepter, Throne of Empires)
 */
export interface EmpiresBonus {
  hasCrown: boolean;
  hasScepter: boolean;
  hasThrone: boolean;
  hasAll: boolean;
}

/**
 * Mimic Vat trigger
 */
export interface MimicVatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  imprintedCardId?: string;
  imprintedCard?: any;
}
