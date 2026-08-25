/**
 * Origin parent: rules-engine/src/oracleIR.ts
 * Cluster: OracleQuantity, OraclePlayerSelector, OracleObjectSelector, OracleScaler,
 * OracleClauseCondition, OracleGraveyardAdditionalCost, OracleBattlefieldObjectCondition,
 * OracleZone
 * Public: those eight types
 * Leaf must not import oracleIR.ts or oracleIR-handlers/index.ts.
 */

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
  | {
      readonly kind: 'votes_received';
      readonly who: 'you' | 'opponents' | 'each_player';
      readonly multiplier?: number;
    }
  | {
      readonly kind: 'object_stat';
      readonly subject:
        | 'it'
        | 'that_card'
        | 'that_creature'
        | 'that_permanent'
        | 'that_artifact'
        | 'that_equipment'
        | 'that_wall'
        | 'that_spell'
        | 'the_sacrificed_creature'
        | 'the_sacrificed_permanent'
        | 'the_sacrificed_enchantment'
        | 'the_milled_card'
        | 'the_discarded_card'
        | 'the_tapped_creature'
        | 'this_creature'
        | 'this_permanent'
        | 'target_creature_you_control'
        | 'source';
      readonly stat: 'power' | 'toughness' | 'mana_value';
      readonly multiplier?: number;
    }
  | { readonly kind: 'unknown'; readonly raw?: string };

export type OraclePlayerSelector =
  | { readonly kind: 'you' }
  | { readonly kind: 'any_player' }
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
  /** Player enchanted by this Aura (curse/player auras). */
  | { readonly kind: 'enchanted_player' }
  /** Special-case selector used by move_zone battlefield control overrides. */
  | { readonly kind: 'owner_of_moved_cards' }
  /** Current chooser in a repeated zone-draft loop. */
  | { readonly kind: 'chooser' }
  /** Controller of the object referenced by it/its/that in the current execution context. */
  | { readonly kind: 'controller_of_referenced_object' }
  /** Owner of the object referenced by it/its/that in the current execution context. */
  | { readonly kind: 'owner_of_referenced_object' }
  /** Owner of the ability's source permanent/card. */
  | { readonly kind: 'owner_of_source' }
  /** Winner of an auction/bidding mini-game (defaults to controller in assisted dry-runs). */
  | { readonly kind: 'high_bidder' }
  /** Controller of the ability's source permanent (e.g. Xantcha's activated ability). */
  | { readonly kind: 'source_controller' }
  /** Each player tied for controlling the most permanents of a filter (default: creatures). */
  | { readonly kind: 'each_player_who_controls_the_most'; readonly filter?: string }
  /** Each distinct controller among contextual "those" permanents (last moved / chosen). */
  | { readonly kind: 'each_controller_of_those' }
  /** Parser fallback for free-form player phrases that still need runtime interpretation. */
  | { readonly kind: 'raw'; readonly text: string }
  | { readonly kind: 'unknown'; readonly raw: string };

export type OracleObjectSelector =
  | { readonly kind: 'raw'; readonly text: string }
  | { readonly kind: 'equipped_creature' }
  | {
      readonly kind: 'battlefield_selector';
      readonly types?: readonly string[];
      readonly controllerFilter?: string;
      readonly text?: string;
      readonly raw?: string;
    }
  | { readonly kind: 'target'; readonly text?: string; readonly raw?: string }
  | { readonly kind: 'unknown'; readonly raw: string };

export type OracleScaler =
  | { readonly kind: 'per_revealed_this_way' }
  | { readonly kind: 'per_creature_blocking_it' }
  | { readonly kind: 'per_basic_land_type_among_lands_you_control' }
  | { readonly kind: 'per_artifact_you_control' }
  | { readonly kind: 'per_creature_tapped_this_way' }
  | { readonly kind: 'per_other_attacking_aurochs' }
  | { readonly kind: 'per_goblin_you_control' }
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
      readonly filterText?: string;
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
