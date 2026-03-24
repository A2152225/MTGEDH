/**
 * Shared trigger enums and core ability shapes used across the triggered-ability pipeline.
 */

/**
 * Rule 603.1: Triggered ability keywords
 */
export enum TriggerKeyword {
  WHEN = 'when',
  WHENEVER = 'whenever',
  AT = 'at',
}

/**
 * Common trigger events
 */
export enum TriggerEvent {
  ENTERS_BATTLEFIELD = 'enters_battlefield',
  LEAVES_BATTLEFIELD = 'leaves_battlefield',
  DIES = 'dies',
  DRAWN = 'drawn',
  DISCARDED = 'discarded',
  EXILED = 'exiled',
  PUT_INTO_GRAVEYARD = 'put_into_graveyard',
  PUT_INTO_HAND = 'put_into_hand',
  RETURNED_TO_HAND = 'returned_to_hand',
  MILLED = 'milled',
  ATTACKS = 'attacks',
  ATTACKS_ALONE = 'attacks_alone',
  BLOCKS = 'blocks',
  BLOCKED = 'blocked',
  BECOMES_BLOCKED = 'becomes_blocked',
  UNBLOCKED = 'unblocked',
  DEALS_DAMAGE = 'deals_damage',
  DEALS_COMBAT_DAMAGE = 'deals_combat_damage',
  DEALS_COMBAT_DAMAGE_TO_PLAYER = 'deals_combat_damage_to_player',
  DEALT_DAMAGE = 'dealt_damage',
  DEALT_COMBAT_DAMAGE = 'dealt_combat_damage',
  COMBAT_DAMAGE_STEP = 'combat_damage_step',
  BEGINNING_OF_TURN = 'beginning_of_turn',
  BEGINNING_OF_UPKEEP = 'beginning_of_upkeep',
  BEGINNING_OF_DRAW_STEP = 'beginning_of_draw_step',
  BEGINNING_OF_PRECOMBAT_MAIN = 'beginning_of_precombat_main',
  BEGINNING_OF_COMBAT = 'beginning_of_combat',
  BEGINNING_OF_DECLARE_ATTACKERS = 'beginning_of_declare_attackers',
  BEGINNING_OF_DECLARE_BLOCKERS = 'beginning_of_declare_blockers',
  BEGINNING_OF_POSTCOMBAT_MAIN = 'beginning_of_postcombat_main',
  END_OF_TURN = 'end_of_turn',
  BEGINNING_OF_END_STEP = 'beginning_of_end_step',
  END_OF_COMBAT = 'end_of_combat',
  CLEANUP_STEP = 'cleanup_step',
  SPELL_CAST = 'spell_cast',
  CREATURE_SPELL_CAST = 'creature_spell_cast',
  NONCREATURE_SPELL_CAST = 'noncreature_spell_cast',
  INSTANT_OR_SORCERY_CAST = 'instant_or_sorcery_cast',
  ABILITY_ACTIVATED = 'ability_activated',
  ABILITY_TRIGGERED = 'ability_triggered',
  SPELL_COUNTERED = 'spell_countered',
  BECOMES_TAPPED = 'becomes_tapped',
  BECOMES_UNTAPPED = 'becomes_untapped',
  COUNTER_PLACED = 'counter_placed',
  COUNTER_REMOVED = 'counter_removed',
  GAINED_LIFE = 'gained_life',
  LOST_LIFE = 'lost_life',
  LIFE_PAID = 'life_paid',
  TOKEN_CREATED = 'token_created',
  TRANSFORMED = 'transformed',
  BECAME_MONSTROUS = 'became_monstrous',
  BECAME_RENOWNED = 'became_renowned',
  EQUIPPED = 'equipped',
  ENCHANTED = 'enchanted',
  ATTACHED = 'attached',
  LANDFALL = 'landfall',
  SEARCHED_LIBRARY = 'searched_library',
  SHUFFLED_LIBRARY = 'shuffled_library',
  SCRIED = 'scried',
  SURVEIL = 'surveil',
  EXPLORED = 'explored',
  SACRIFICED = 'sacrificed',
  CREATURE_SACRIFICED = 'creature_sacrificed',
  ARTIFACT_SACRIFICED = 'artifact_sacrificed',
  TARGETED = 'targeted',
  DESTROYED = 'destroyed',
  REGENERATED = 'regenerated',
  CONTROLLED_CREATURE_DIED = 'controlled_creature_died',
  OPPONENT_CREATURE_DIED = 'opponent_creature_died',
}

/**
 * Triggered ability definition
 */
export interface TriggeredAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly keyword: TriggerKeyword;
  readonly event: TriggerEvent;
  readonly condition?: string;
  readonly triggerFilter?: string;
  readonly interveningIfClause?: string;
  readonly hasInterveningIf?: boolean;
  readonly effect: string;
  readonly targets?: readonly string[];
  readonly optional?: boolean;
}

/**
 * Parsed trigger information from oracle text
 */
export interface ParsedTrigger {
  readonly keyword: TriggerKeyword;
  readonly event: TriggerEvent;
  readonly condition?: string;
  readonly effect: string;
  readonly optional: boolean;
  readonly selfTrigger: boolean;
  readonly interveningIf?: string;
}
