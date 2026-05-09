import type { AbilityType } from './oracleTextParser';

export type OracleQuantity =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'all' }
  | { readonly kind: 'any_number' }
  | { readonly kind: 'reference_amount'; readonly raw?: string }
  | { readonly kind: 'reveal_until_land' }
  | { readonly kind: 'until_nonland_mana_value_lte'; readonly value: number }
  | { readonly kind: 'source_power' }
  | { readonly kind: 'greatest_power_among_other_creatures_you_control' }
  | { readonly kind: 'greatest_power_among_creatures_you_control'; readonly excludeSubtype?: string }
  | { readonly kind: 'x' }
  | { readonly kind: 'all' }
  | { readonly kind: 'replicate_count' }
  | { readonly kind: 'spells_cast_before_this_turn' }
  | { readonly kind: 'votes_for_choice'; readonly choice: string; readonly multiplier?: number }
  | { readonly kind: 'object_stat'; readonly subject: 'it' | 'that_card' | 'that_creature' | 'the_sacrificed_creature' | 'source'; readonly stat: 'power' | 'toughness' | 'mana_value'; readonly multiplier?: number }
  | { readonly kind: 'unknown'; readonly raw?: string };

export type OraclePlayerSelector =
  | { readonly kind: 'you' }
  | { readonly kind: 'each_player' }
  | { readonly kind: 'each_opponent' }
  | { readonly kind: 'any_number_of_target_opponents' }
  | { readonly kind: 'any_number_of_target_players' }
  | { readonly kind: 'you_and_target_opponent' }
  | { readonly kind: 'you_and_target_player' }
  /**
   * Contextual subset reference used by oracle text such as
   * "each of those opponents". The concrete set is defined by prior
   * text in the same ability (e.g. opponents dealt damage).
   */
  | { readonly kind: 'each_of_those_opponents' }
  | { readonly kind: 'target_player' }
  | { readonly kind: 'target_opponent' }
  /** Special-case selector used by move_zone battlefield control overrides. */
  | { readonly kind: 'owner_of_moved_cards' }
  | { readonly kind: 'unknown'; readonly raw: string };

export type OracleObjectSelector =
  | { readonly kind: 'raw'; readonly text: string }
  | { readonly kind: 'equipped_creature' }
  | { readonly kind: 'unknown'; readonly raw: string };

export type OracleScaler =
  | { readonly kind: 'per_revealed_this_way' }
  | { readonly kind: 'per_creature_blocking_it' }
  | { readonly kind: 'per_basic_land_type_among_lands_you_control' }
  | { readonly kind: 'per_artifact_you_control' }
  | { readonly kind: 'per_creature_tapped_this_way' }
  | { readonly kind: 'per_other_attacking_aurochs' }
  | { readonly kind: 'reference_scaler'; readonly raw: string }
  | { readonly kind: 'unknown'; readonly raw: string };

export type OracleClauseCondition =
  | { readonly kind: 'if'; readonly raw: string }
  | { readonly kind: 'as_long_as'; readonly raw: string }
  | { readonly kind: 'where'; readonly raw: string };

export type OracleGraveyardAdditionalCost =
  | {
      readonly kind: 'discard';
      readonly count: number;
      readonly filterText?: string;
      readonly raw: string;
    }
  | {
      readonly kind: 'sacrifice';
      readonly count: number;
      readonly filterText?: string;
      readonly raw: string;
    }
  | {
      readonly kind: 'exile_from_graveyard';
      readonly count: number;
      readonly raw: string;
    }
  | {
      readonly kind: 'remove_counter';
      readonly count: number | 'any';
      readonly counter?: string;
      readonly filterText?: string;
      readonly raw: string;
    };

export type OracleBattlefieldObjectCondition =
  | {
      readonly kind: 'mana_value_compare';
      readonly comparator: 'lte' | 'gte';
      readonly value: number;
      readonly subject: 'it';
    }
  | {
      readonly kind: 'counter_compare';
      readonly counter: string;
      readonly comparator: 'lte' | 'gte' | 'eq';
      readonly value: number;
      readonly subject: 'it';
    };

export type OracleZone =
  | 'battlefield'
  | 'hand'
  | 'graveyard'
  | 'exile'
  | 'library'
  | 'stack'
  | 'command'
  | 'unknown';

export type OracleEffectStep =
  | {
      readonly kind: 'flip_coin';
      readonly who: OraclePlayerSelector;
      readonly call?: 'heads' | 'tails';
      readonly repeatUntil?: 'lose_flip';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'roll_die';
      readonly who: OraclePlayerSelector;
      readonly sides: number;
      readonly count?: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'die_roll_results';
      readonly who: OraclePlayerSelector;
      readonly sides: number;
      readonly results: readonly {
        readonly min: number;
        readonly max: number;
        readonly raw: string;
        readonly steps: readonly OracleEffectStep[];
      }[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'draw';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
    | {
        readonly kind: 'gain_control';
        readonly what: OracleObjectSelector;
        readonly newController: OraclePlayerSelector;
        readonly duration: 'until_end_of_turn' | 'indefinite' | 'as_long_as_attached' | 'as_long_as_control_source';
        readonly optional?: boolean;
        readonly sequence?: 'then';
        readonly raw: string;
      }
    | {
        readonly kind: 'exchange_control';
        readonly first: OracleObjectSelector;
        readonly second: OracleObjectSelector;
        readonly optional?: boolean;
        readonly sequence?: 'then';
        readonly raw: string;
      }
    | {
      readonly kind: 'clash';
      readonly who: OraclePlayerSelector;
      readonly opponent?: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'explore';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'connive';
      readonly target: OracleObjectSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'manifest_dread';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'time_travel';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'search_library';
      readonly who: OraclePlayerSelector;
      readonly criteria:
        | { readonly kind: 'same_mana_value_as_source'; readonly requiredCardType?: 'creature' }
        | { readonly kind: 'mana_value'; readonly value: number }
        | { readonly kind: 'raw'; readonly text: string };
      readonly destination: 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'top' | 'bottom';
      readonly revealFound?: boolean;
      readonly entersTapped?: boolean;
      readonly shuffle?: boolean;
      readonly maxResults?: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'exile_named_cards_from_zones';
      readonly who: OraclePlayerSelector;
      readonly zones: readonly Extract<OracleZone, 'graveyard' | 'hand' | 'library'>[];
      readonly nameSource: 'chosen_card_name';
      readonly maxResults?: number | 'any_number';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'choose_pile';
      readonly chooser: OraclePlayerSelector;
      readonly source: 'last_split_piles' | 'top_library';
      readonly chosenDestination?: OracleZone;
      readonly otherDestination?: OracleZone;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'shuffle_zones_into_library';
      readonly who: OraclePlayerSelector;
      readonly zones: readonly ('hand' | 'graveyard')[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'shuffle_library';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'prevent_library_search';
      readonly who: OraclePlayerSelector;
      readonly source?: OracleObjectSelector;
      readonly duration?: 'static' | 'this_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'end_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'skip_next_turn';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'skip_next_draw_step';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'take_extra_turn';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'add_extra_combat';
      readonly followedByAdditionalMain?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'gain_class_level';
      readonly level: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'exile_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'impulse_exile_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      /** When the exiled cards can be played until. */
      readonly duration:
        | 'this_turn'
        | 'during_resolution'
        | 'during_next_turn'
        | 'until_end_of_next_turn'
        | 'until_end_of_combat_on_next_turn'
        | 'until_next_turn'
        | 'until_next_upkeep'
        | 'until_next_end_step'
        | 'as_long_as_remains_exiled'
        | 'as_long_as_control_source'
        | 'until_exile_another';
      /** Whether oracle text granted 'play' (lands + cast) or 'cast' (spells only). */
      readonly permission: 'play' | 'cast';
      /** Optional simple condition gating the permission (e.g. "If it's red/nonland..."). */
      readonly condition?:
        | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
        | { readonly kind: 'type'; readonly type: 'land' | 'nonland' }
        | { readonly kind: 'attacked_with'; readonly raw: string };
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_exile_permissions';
      readonly scope: 'last_exiled_cards';
      readonly withoutPayingManaCost?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'grant_exile_permission';
      readonly who: OraclePlayerSelector;
      readonly what: OracleObjectSelector;
      readonly duration:
        | 'this_turn'
        | 'during_resolution'
        | 'during_next_turn'
        | 'until_end_of_next_turn'
        | 'until_end_of_combat_on_next_turn'
        | 'until_next_turn'
        | 'until_next_upkeep'
        | 'until_next_end_step'
        | 'as_long_as_remains_exiled'
        | 'as_long_as_control_source'
        | 'until_exile_another';
      readonly permission: 'play' | 'cast';
      readonly linkedToSource?: boolean;
      readonly ownedByWho?: 'granted_player';
      readonly castedPermanentEntersWithCounters?: Record<string, number>;
      readonly withoutPayingManaCost?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'paradigm';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'grant_future_spell_effect';
      readonly who: OraclePlayerSelector;
      readonly duration: 'this_turn';
      readonly scope: 'all_qualifying_spells' | 'next_qualifying_spell';
      readonly spellFilter?: {
        readonly cardTypes?: readonly string[];
      };
      readonly timingPermission?: 'as_though_flash';
      readonly counterImmunity?: {
        readonly unconditional?: boolean;
        readonly counterSourceColors?: readonly string[];
      };
      readonly castedPermanentEntersWithCounters?: Record<string, number>;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_graveyard_permissions';
      readonly scope: 'last_granted_graveyard_cards';
      readonly castCost?: 'mana_cost';
      readonly castCostRaw?: string;
      readonly withoutPayingManaCost?: boolean;
      readonly exileInsteadOfGraveyard?: boolean;
      readonly additionalCost?: OracleGraveyardAdditionalCost;
      readonly castedPermanentEntersWithCounters?: Record<string, number>;
      readonly entersBattlefieldTransformed?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'grant_graveyard_permission';
      readonly who: OraclePlayerSelector;
      readonly what: OracleObjectSelector;
      readonly duration:
        | 'this_turn'
        | 'during_resolution'
        | 'during_next_turn'
        | 'until_end_of_next_turn'
        | 'until_end_of_combat_on_next_turn'
        | 'until_next_turn'
        | 'until_next_upkeep'
        | 'until_next_end_step';
      readonly permission: 'play' | 'cast';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'grant_graveyard_keyword_ability';
      readonly who: OraclePlayerSelector;
      readonly what: OracleObjectSelector;
      readonly keyword: 'unearth' | 'embalm' | 'eternalize';
      readonly costRaw?: string;
      readonly duration: 'this_turn' | 'during_resolution';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'add_mana';
      readonly who: OraclePlayerSelector;
      /** Raw mana string, e.g. "{R}{R}{R}" or "{2}{C}" */
      readonly mana: string;
      /** Optional mana choices for clauses like "Add {R} or {G}." */
      readonly manaOptions?: readonly string[];
      /** Restricts available choices to the controller's commander color identity. */
      readonly manaOptionsScope?: 'commander_color_identity';
      /** Requires an explicit chosen color/mana binding instead of defaulting to the first option. */
      readonly requiresChosenMana?: boolean;
      /** Restricts how the produced mana can be spent. */
      readonly spendRestriction?: 'creature_spell' | 'instant_or_sorcery_spell' | 'artifact_spell_or_ability' | 'activated_ability';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'retain_mana';
      readonly who: OraclePlayerSelector;
      readonly duration: 'until_end_of_turn' | 'until_end_of_combat';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'pay_mana';
      readonly who: OraclePlayerSelector;
      /** Raw mana string, e.g. "{B}" or "{2}{G}" */
      readonly mana: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'choose_opponent';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'choose_color';
      /** Optional restricted color set, expressed as mana symbols such as {W}. */
      readonly manaOptions?: readonly string[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'choose_creature_type';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'choose_basic_land_type';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'choose_card_name';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'player_choice';
      readonly choice: 'card_type' | 'letter' | 'odd_even' | 'text_change' | 'number_of_lands' | 'generic';
      readonly target?: OracleObjectSelector;
      readonly options?: readonly string[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'choose_target_creature';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'scry';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'surveil';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'fateseal';
      readonly who: OraclePlayerSelector;
      readonly target: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'learn';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'collect_evidence';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'exert';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'earthbend';
      readonly target: OracleObjectSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'animate_permanent';
      readonly target: OracleObjectSelector;
      readonly addTypes?: readonly string[];
      readonly power?: number;
      readonly toughness?: number;
      readonly abilities?: readonly string[];
      readonly duration: 'static' | 'end_of_turn' | 'until_next_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'open_attraction';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'roll_visit_attractions';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'take_initiative';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'become_monarch';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'venture_into_dungeon';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'planeswalk';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'assemble';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'regenerate';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'abandon_scheme';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'set_in_motion';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'vote';
      readonly voters: OraclePlayerSelector;
      readonly startingWith?: OraclePlayerSelector;
      readonly choices: readonly string[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'look_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'reveal_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'look_select_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly choose: OracleQuantity;
      readonly destination: 'hand' | 'graveyard';
      readonly restDestination: 'graveyard' | 'library';
      readonly restToTop?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'look_choose_from_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly selectorText: string;
      readonly destination: 'hand' | 'exile';
      readonly reveal?: boolean;
      readonly restOrder?: 'any';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'add_counter';
      readonly target: OracleObjectSelector;
      readonly counter: string;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'move_counters';
      readonly from: OracleObjectSelector;
      readonly to: OracleObjectSelector;
      readonly counter?: string;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'put_sticker';
      readonly target: OracleObjectSelector;
      readonly sticker?: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'add_types';
      readonly target: OracleObjectSelector;
      readonly addTypes: readonly string[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'add_player_counter';
      readonly who: OraclePlayerSelector;
      readonly counter: string;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'double_player_counters';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'remove_counter';
      readonly target: OracleObjectSelector;
      readonly counter: string;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'double_counters';
      readonly target: OracleObjectSelector;
      readonly counter?: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'mill';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'goad';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'detain';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'cant_attack';
      readonly target: OracleObjectSelector;
      readonly duration: 'end_of_turn' | 'static';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'cant_block';
      readonly target: OracleObjectSelector;
      readonly duration: 'end_of_turn' | 'static';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'force_block';
      readonly blocker: OracleObjectSelector;
      readonly attacker: OracleObjectSelector;
      readonly duration: 'end_of_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'cant_activate_abilities';
      readonly target: OracleObjectSelector;
      readonly duration: 'end_of_turn' | 'static';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'assign_no_combat_damage';
      readonly target: OracleObjectSelector;
      readonly duration: 'this_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'set_base_pt';
      readonly target: OracleObjectSelector;
      readonly power: number;
      readonly toughness: number;
      readonly duration: 'end_of_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'switch_power_toughness';
      readonly target: OracleObjectSelector;
      readonly duration: 'end_of_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_pt';
      readonly target: OracleObjectSelector;
      readonly power: number;
      readonly toughness: number;
      /** When true, `power` is a signed X coefficient (e.g. +X => 1, -X => -1). */
      readonly powerUsesX?: boolean;
      /** When true, `toughness` is a signed X coefficient (e.g. +X => 1, -X => -1). */
      readonly toughnessUsesX?: boolean;
      readonly duration: 'end_of_turn';
      readonly scaler?: OracleScaler;
      readonly condition?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_pt_per_revealed';
      /** Currently supports Trepanation-Blade-style "The creature ..." (equipped creature). */
      readonly target: 'equipped_creature';
      readonly powerPerCard: number;
      readonly toughnessPerCard: number;
      readonly duration: 'end_of_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'grant_temporary_ability';
      readonly target: OracleObjectSelector;
      readonly duration: 'end_of_turn' | 'this_turn' | 'until_next_turn';
      /** Keyword-style granted abilities that should behave like transient grantedAbilities. */
      readonly abilities?: readonly string[];
      /** Additional temporary text that should matter while this effect lasts. */
      readonly effectText?: readonly string[];
      /** Parsed metadata for granted effect text; not executed as part of the host effect. */
      readonly steps?: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'grant_static_ability';
      readonly target: OracleObjectSelector;
      readonly abilities?: readonly string[];
      readonly effectText?: readonly string[];
      readonly power?: number;
      readonly toughness?: number;
      readonly duration?: 'static' | 'while_attached';
      /** Parsed metadata for granted effect text; not executed as part of the host effect. */
      readonly steps?: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'discard';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly target?: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'reveal_hand';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'look_hand';
      readonly who: OraclePlayerSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'gain_life';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'lose_life';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'deal_damage';
      readonly amount: OracleQuantity;
      readonly source?: OracleObjectSelector;
      readonly target: OracleObjectSelector;
      readonly division?: 'as_you_choose' | 'evenly_rounded_down';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_damage';
      readonly mode: 'add' | 'subtract';
      readonly amount: OracleQuantity;
      readonly sourceFilter?: string;
      readonly targetFilter?: string;
      readonly damageFilter?: 'combat' | 'noncombat' | 'any';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'prevent_damage';
      readonly amount: 'all' | OracleQuantity;
      readonly target?: OracleObjectSelector;
      readonly recipientTarget?: OracleObjectSelector;
      readonly duration: 'this_turn';
      readonly combatOnly?: boolean;
      /** Restricts legal target sources to those sharing a color with the linked exiled card. */
      readonly sharesColorWithLinkedExiledCard?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'damage_cant_be_prevented';
      readonly duration: 'this_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'win_game';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'lose_game';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'tap_or_untap';
      readonly target: OracleObjectSelector;
      readonly mode?: 'tap' | 'untap';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'phase_out';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'skip_next_untap';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'optional_untap_choice';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'tap_matching_permanents';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly filter: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'create_token';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      /** Best-effort free text token description (e.g. "1/1 white Soldier creature"). */
      readonly token: string;
      /** Whether the token enters the battlefield tapped (deterministic). */
      readonly entersTapped?: boolean;
      /** Whether created tokens enter attacking a deterministic opponent selection. */
      readonly attacking?: 'defending_player' | 'each_opponent' | 'each_other_opponent';
      /** Counters the token enters with (deterministic, single-clause only). */
      readonly withCounters?: Record<string, number>;
      /** For Aura-style token creation that enters attached to a deterministic object. */
      readonly battlefieldAttachedTo?: OracleObjectSelector;
      /** Grant haste to the created token(s). */
      readonly grantsHaste?: 'permanent' | 'until_end_of_turn';
      /** Grant one or more keyword abilities to the created token(s) until end of turn (e.g. "They gain flying until end of turn."). */
      readonly grantsAbilitiesUntilEndOfTurn?: readonly string[];
      /** Create a delayed trigger for the created token(s) at the beginning of the next end step. */
      readonly atNextEndStep?: 'sacrifice' | 'exile';
      /** Create a delayed trigger for the created token(s) at end of combat (beginning of the end of combat step). */
      readonly atEndOfCombat?: 'sacrifice' | 'exile';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_token_creation';
      readonly who: OraclePlayerSelector;
      readonly tokenTypes: readonly string[];
      readonly mode: 'replace_with_one_of_each' | 'add_additional_token';
      readonly additionalAmount?: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * "Until end of turn, target creature gains 'When this creature dies, ...'"
       * and "It gains 'When this creature dies, ...'" style effects are represented
       * as delayed watched triggers rather than mutating permanent text in place.
       */
      readonly kind: 'grant_temporary_dies_trigger';
      readonly target: OracleObjectSelector;
      readonly effect: string;
      readonly duration: 'until_end_of_turn' | 'while_on_battlefield';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Schedule a delayed one-shot battlefield action whose targets must be
       * bound now and resolved later against exact chosen object ids.
       */
      readonly kind: 'schedule_delayed_battlefield_action';
      readonly timing:
        | 'next_end_step'
        | 'your_next_end_step'
        | 'next_upkeep'
        | 'your_next_upkeep'
        | 'end_of_combat'
        | 'next_cleanup_step'
        | 'when_control_lost'
        | 'when_leaves_battlefield';
      readonly action: 'sacrifice' | 'exile';
      readonly who?: OraclePlayerSelector;
      readonly object: OracleObjectSelector;
      readonly condition?: OracleBattlefieldObjectCondition;
      /** Optional watched object for event-based delayed cleanup like "when that token leaves the battlefield". */
      readonly watch?: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Schedule a delayed one-shot trigger that later resolves the given
       * deterministic Oracle effect text using the current bound target context.
       */
      readonly kind: 'schedule_delayed_trigger';
      readonly timing:
        | 'next_end_step'
        | 'your_next_end_step'
        | 'next_upkeep'
        | 'your_next_upkeep';
      readonly effect: string;
      /** Parsed metadata for delayed effect text; not executed when scheduling. */
      readonly steps?: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'destroy';
      readonly target: OracleObjectSelector;
      readonly cantBeRegenerated?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'counter_spell';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'change_target';
      readonly target: OracleObjectSelector;
      readonly newTarget?: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'exile';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'sacrifice';
      readonly who: OraclePlayerSelector;
      readonly what: OracleObjectSelector;
      readonly condition?: OracleBattlefieldObjectCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'move_zone';
      readonly what: OracleObjectSelector;
      readonly to: OracleZone;
      readonly toRaw: string;
      /**
       * For moves that put cards onto the battlefield, oracle text can override who controls
       * the resulting permanents (e.g. "... onto the battlefield under your control").
       *
       * When absent, executor uses its default deterministic behavior.
       */
      readonly battlefieldController?: OraclePlayerSelector;
      /**
       * For battlefield moves that require the object to enter attached to an
       * already-known battlefield object.
       */
      readonly battlefieldAttachedTo?: OracleObjectSelector;
      /** If the move puts cards onto the battlefield tapped (deterministic). */
      readonly entersTapped?: boolean;
      /** If the move puts cards onto the battlefield face down (deterministic). */
      readonly entersFaceDown?: boolean;
      /** Optional ward cost for specific face-down entries such as cloak. */
      readonly faceDownWardCost?: string;
      /** Counters the moved permanent enters with (deterministic, battlefield-only). */
      readonly withCounters?: Record<string, number>;
      /** Optional deterministic condition gating battlefield-entry counters. */
      readonly withCountersCondition?: OracleClauseCondition;
      /** Additional colors the moved permanent has as it enters the battlefield. */
      readonly battlefieldAddColors?: readonly string[];
      /** Additional types/subtypes the moved permanent has as it enters the battlefield. */
      readonly battlefieldAddTypes?: readonly string[];
      /** Optional deterministic condition gating battlefield-entry type/color changes. */
      readonly battlefieldCharacteristicsCondition?: OracleClauseCondition;
      /** Override the moved card's visible type line as it enters the battlefield. */
      readonly battlefieldSetTypeLine?: string;
      /** Override the moved card's rules text as it enters the battlefield. */
      readonly battlefieldSetOracleText?: string;
      /** Clear the moved card's printed abilities before applying battlefield overrides. */
      readonly battlefieldLoseAllAbilities?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'turn_face_up';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'turn_face_down';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'set_basic_land_type';
      readonly target: OracleObjectSelector;
      readonly landType: 'choice' | 'Plains' | 'Island' | 'Swamp' | 'Mountain' | 'Forest';
      readonly duration: 'end_of_turn' | 'static';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Changes an existing battlefield permanent into a copy of another
       * object while it remains on the battlefield.
       */
      readonly kind: 'copy_permanent';
      readonly target: OracleObjectSelector;
      readonly source: OracleObjectSelector;
      /** Ability text retained as part of the copy effect, if any. */
      readonly retainAbilityText?: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'become_aura';
      readonly target: OracleObjectSelector;
      readonly enchant: OracleObjectSelector;
      readonly losesThisAbility?: boolean;
      readonly duration?: 'until_effect_ends';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'attach';
      readonly attachment: OracleObjectSelector;
      readonly to: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Marks a battlefield object so if it would leave the battlefield later
       * this turn/lifetime, it is exiled instead of going elsewhere.
       */
      readonly kind: 'grant_leave_battlefield_replacement';
      readonly target: OracleObjectSelector;
      readonly destination: 'exile';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Copy the currently resolving spell and re-run its deterministic
       * instructions, preserving choices unless a unique replacement target
       * can be inferred.
       */
      readonly kind: 'copy_spell';
      readonly subject: 'this_spell' | 'target_spell' | 'last_moved_card' | 'linked_exiled_cards';
      readonly target?: OracleObjectSelector;
      readonly copies?: OracleQuantity;
      readonly withoutPayingManaCost?: boolean;
      /** Alternative cast cost to use instead of the copied card's mana cost. */
      readonly castCost?: 'mana_cost' | string;
      /** Whether the copy may choose new target(s) for deterministic replay. */
      readonly allowNewTargets?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Copy a specific chapter ability from the last moved Saga card and
       * resolve its deterministic instructions.
       */
      readonly kind: 'copy_chapter_ability';
      readonly subject: 'last_moved_card';
      readonly chapter: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'copy_saga_chapter_ability';
      readonly subject: 'last_moved_card';
      readonly chapterNumber: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'create_emblem';
      readonly abilities: readonly string[];
      readonly name?: string;
      /** Parsed metadata for emblem text; not executed while creating the emblem. */
      readonly steps?: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'proliferate';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'investigate';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'populate';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      /** Metadata-only lowering of the keyword action's token-copy creation. */
      readonly steps?: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'ring_tempts_you';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'suspect';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'become_renowned';
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'monstrosity';
      readonly target: OracleObjectSelector;
      readonly amount: OracleQuantity;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * A modal spell or ability where the player must choose between two or more
       * discrete effects.  Examples: "Choose one —", "Choose two —", "Choose up
       * to two —", "Choose any number —".
       */
      readonly kind: 'choose_mode';
      /** Minimum modes to pick (0 = optional set; usually 1). */
      readonly minModes: number;
      /** Maximum modes to pick (-1 = unlimited / "any number"). */
      readonly maxModes: number;
      /** Whether the same mode can be chosen more than once. */
      readonly canRepeatModes?: boolean;
      /** Whether future choices for this source must exclude already-chosen modes. */
      readonly rememberChosenModes?: boolean;
      readonly modes: readonly {
        readonly label: string;
        /** Raw bullet text for display. */
        readonly raw: string;
        /** Steps that resolve when this mode is chosen. */
        readonly steps: readonly OracleEffectStep[];
      }[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * A leading conditional wrapper around one or more inner steps, used for
       * clause shapes like "If <condition>, sacrifice this creature and draw a card."
       */
      readonly kind: 'conditional';
      readonly condition: OracleClauseCondition;
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Wrapper for effects that only happen if a referenced player doesn't or
       * can't pay a fixed life amount.
       */
      readonly kind: 'unless_pays_life';
      readonly who: OraclePlayerSelector;
      readonly amount: number;
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Wrapper for effects that only happen if a referenced player doesn't or
       * can't pay a fixed mana cost.
       */
      readonly kind: 'unless_pays_mana';
      readonly who: OraclePlayerSelector;
      readonly mana: string;
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'unknown';
      readonly raw: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
    };

export interface OracleIRAbility {
  readonly type: AbilityType;
  readonly text: string;
  readonly cost?: string;
  readonly triggerCondition?: string;
  readonly interveningIf?: string;
  readonly effectText: string;
  readonly steps: readonly OracleEffectStep[];
}

export interface OracleIRResult {
  readonly normalizedOracleText: string;
  readonly abilities: readonly OracleIRAbility[];
  readonly keywords: readonly string[];
}
