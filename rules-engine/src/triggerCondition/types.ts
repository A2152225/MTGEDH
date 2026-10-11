/**
 * Trigger condition IR.
 * Public: TriggerConditionIR, TriggerConditionAlternative, TriggerSubjectFilter,
 *   TriggerMatchPermanent, TriggerMatchSource.
 *
 * The event, the subject, the controller relation, and the source relation are
 * separate fields. Intervening-if, reflexive "when you do", and delayed
 * "next end step" riders are not this record.
 */

export type TriggerConditionEvent =
  | 'dies'
  | 'put_into_graveyard'
  | 'enters'
  | 'attacks'
  | 'blocks'
  | 'becomes_tapped'
  | 'becomes_untapped'
  | 'spell_cast'
  | 'beginning_of_upkeep'
  | 'beginning_of_draw_step'
  | 'beginning_of_combat'
  | 'beginning_of_end_step'
  | 'beginning_of_precombat_main'
  | 'beginning_of_postcombat_main'
  | 'each_of_your_main_phases'
  | 'end_of_combat'
  | 'gains_life'
  | 'loses_life'
  | 'sacrifices'
  | 'draws_card'
  | 'discards'
  | 'mills'
  | 'deals_combat_damage_to_player'
  | 'deals_combat_damage_to_creature'
  | 'counter_placed'
  | 'counter_removed'
  | 'searches_library'
  | 'shuffles_library'
  | 'pays_life'
  | 'creates_token'
  | 'exiled'
  | 'left_graveyard'
  | 'leaves_battlefield'
  | 'gains_control'
  | 'loses_control'
  | 'returned_to_hand'
  | 'spell_countered'
  | 'counters_spell'
  | 'put_on_stack'
  | 'cycles'
  | 'transforms'
  | 'mutates'
  | 'becomes_attached'
  | 'becomes_unattached'
  | 'becomes_monstrous'
  | 'becomes_crewed'
  | 'becomes_saddled'
  | 'dealt_damage'
  | 'plays_land'
  | 'unlocks_door'
  | 'performs';

export type TriggerControllerRelation = 'any' | 'you' | 'not_you';

export type TriggerSourceRelation =
  | 'any'
  | 'another'
  | 'self'
  | 'self_or_another'
  | 'enchanted'
  | 'equipped';

export type TriggerCastZone = 'hand' | 'library' | 'exile' | 'graveyard' | 'not_hand';

export type TriggerOrdinal = 'first' | 'second';

export type TriggerTargetRelation = 'you' | 'opponent';

export type TriggerWhoseTurn =
  | 'you'
  | 'each_player'
  | 'each_opponent'
  | 'enchanted_player'
  | 'enchanted_controller'
  | 'exiled_card_owner'
  | 'monarch'
  | 'chosen_player';

export type TriggerTokenRestriction = 'any' | 'token' | 'nontoken';

export interface TriggerSubjectFilter {
  /** "a permanent" matches any object. Exclusions and supertypes still apply. */
  readonly anyObject: boolean;
  /** Outer list is OR. Each inner list is AND ("artifact creature"). */
  readonly typeGroups: readonly (readonly string[])[];
  /** "nonartifact", "non-Human". */
  readonly excludedWords: readonly string[];
  /** "legendary", "basic", "snow", "world". */
  readonly supertypes: readonly string[];
  /** Outer list is OR. Each inner list is AND ("Goblin Warrior"). */
  readonly subtypeGroups: readonly (readonly string[])[];
  /** "with flying". */
  readonly keywordsWith: readonly string[];
  /** "without flying". */
  readonly keywordsWithout: readonly string[];
  readonly token: TriggerTokenRestriction;
  /** "with a +1/+1 counter" or "with counters". */
  readonly counters?: readonly { readonly name?: string; readonly minimum: number }[];
  /** "with power 4 or greater". */
  readonly stats?: readonly { readonly stat: 'power' | 'toughness'; readonly op: 'gte' | 'lte'; readonly value: number }[];
  /** "of the chosen type". */
  readonly chosenType?: boolean;
  /** "dealt damage by this creature / equipped creature this turn". */
  readonly dealtDamageBy?: 'source' | 'equipped';
  readonly faceDown?: boolean;
  readonly goaded?: boolean;
  readonly attackingOrBlocking?: boolean;
  readonly commander?: boolean;
  /** "you own" / "you don't own". */
  readonly owner?: 'any' | 'you' | 'not_you';
  /** "historic". */
  readonly historic?: boolean;
  /** "a red spell". Letters w, u, b, r, g. Any one matches. */
  readonly colors?: readonly string[];
}

export interface TriggerConditionAlternative {
  readonly controller: TriggerControllerRelation;
  readonly source: TriggerSourceRelation;
  readonly subject: TriggerSubjectFilter;
}

export interface TriggerConditionIR {
  readonly event: TriggerConditionEvent;
  readonly fromZone?: 'battlefield' | 'anywhere' | 'library' | 'hand' | 'graveyard' | 'exile' | 'not_hand';
  /** A second event in "create or sacrifice". The sacrifice emitter also queues it. */
  readonly pairedEvent?: TriggerConditionEvent;
  /** "you surveil", "you scry", "you activate an ability". */
  readonly action?: string;
  /** "you expend 4": the mana total that must be reached. */
  readonly actionAmount?: number;
  /** "is dealt combat damage" versus any damage. Absent means any damage. */
  readonly damageKind?: 'any' | 'combat' | 'noncombat';
  /** "for the first time each turn". */
  readonly onceEachTurn?: boolean;
  /** "your graveyard" / "an opponent's graveyard". Absent or any is every graveyard. */
  readonly zoneOwner?: 'you' | 'not_you' | 'any';
  /** "your library" is the source's. "their library" is the actor's. */
  readonly libraryOwner?: 'source' | 'subject' | 'any';
  /** "one or more" is recorded for the emitter. The matcher still tests one object. */
  readonly quantity: 'one' | 'one_or_more';
  readonly alternatives: readonly TriggerConditionAlternative[];
  /** Spell cast only. Absent means any zone. */
  readonly castFromZone?: TriggerCastZone;
  /** "your first spell each turn". Absent means any spell that turn. */
  readonly ordinal?: TriggerOrdinal;
  /** "that targets you". */
  readonly targets?: TriggerTargetRelation;
  /** Phase steps. "your" / "each player's" / "each opponent's". */
  readonly whoseTurn?: TriggerWhoseTurn;
  /** "a +1/+1 counter is put on". Absent means any counter. */
  readonly placedCounter?: string;
}

export interface TriggerMatchPermanent {
  readonly id: string;
  readonly typeLine: string;
  readonly controllerId: string;
  readonly isToken?: boolean;
  /** Changeling: every creature type. Does not add card types such as artifact. */
  readonly hasAllCreatureTypes?: boolean;
  /** Keywords the object currently has. Required for "with flying". */
  readonly keywords?: readonly string[];
  readonly counters?: Readonly<Record<string, number>>;
  readonly power?: number;
  readonly toughness?: number;
  readonly faceDown?: boolean;
  readonly goaded?: boolean;
  readonly attackingOrBlocking?: boolean;
  readonly isCommander?: boolean;
  readonly ownerId?: string;
  readonly colors?: readonly string[];
}

export interface TriggerMatchSource {
  readonly id: string;
  readonly controllerId: string;
  /** Aura or Equipment: the permanent it is attached to. */
  readonly attachedToId?: string;
  /** "of the chosen type". */
  readonly chosenCreatureType?: string;
}

export interface TriggerMatchContext {
  readonly castFromZone?: string;
  /** 1 is the first spell that player has cast this turn. */
  readonly spellOrdinal?: number;
  readonly targetControllerId?: string;
  readonly activePlayerId?: string;
  readonly enchantedPlayerId?: string;
  readonly monarchPlayerId?: string;
  readonly chosenPlayerId?: string;
  /** "dealt damage by this creature this turn". */
  readonly dealtDamageBySource?: boolean;
  /** "dealt damage by equipped creature this turn". */
  readonly dealtDamageByEquipped?: boolean;
  /** Library the search or shuffle acted on. */
  readonly libraryOwnerId?: string;
  /** Graveyard the card entered or left. */
  readonly zoneOwnerId?: string;
  /** Zone the object came from. "battlefield" is required for from-battlefield clauses. */
  readonly fromZone?: string;
  readonly damageKind?: string;
  readonly enchantedControllerId?: string;
  readonly exiledCardOwnerId?: string;
}
