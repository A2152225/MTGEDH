/**
 * Origin parent: rules-engine/src/oracleIR.ts
 * Cluster: OracleEffectStep union members (grant_next_spell_cost_reduction … fateseal)
 * Public: OracleEffectStepA
 * Leaf must not import oracleIR.ts or oracleIR-handlers/index.ts.
 */

import type {
  OracleClauseCondition,
  OracleGraveyardAdditionalCost,
  OracleObjectSelector,
  OraclePlayerSelector,
  OracleQuantity,
  OracleZone,
} from './oracleIRSharedTypes';
import type { OracleEffectStep } from './oracleIREffectStep';

export type OracleEffectStepA =
  | {
      /**
       * The next spell you cast this turn costs {N} less for each counter
       * removed this way (Mutated Cultist-style deferred cost reduction).
       */
      readonly kind: 'grant_next_spell_cost_reduction';
      readonly mana: string;
      readonly perCountersRemoved?: boolean;
      readonly amount?: number;
      readonly duration?: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
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
      /** Game of Chaos–shaped: flip, exchange life by stake, optional flip-again, double stakes. */
      readonly kind: 'flip_coin_life_stakes';
      readonly who: OraclePlayerSelector;
      readonly opponent: OraclePlayerSelector;
      readonly initialStake: number;
      readonly doubleEachFlip?: boolean;
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
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
    | {
        readonly kind: 'gain_control';
        readonly what: OracleObjectSelector;
        readonly newController: OraclePlayerSelector;
        readonly duration: 'until_end_of_turn' | 'indefinite' | 'as_long_as_attached' | 'as_long_as_control_source' | 'during_that_players_next_turn';
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
      readonly maxResults?: number | 'any_number';
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'exile_named_cards_from_zones';
      readonly who: OraclePlayerSelector;
      readonly zones: readonly Extract<OracleZone, 'graveyard' | 'hand' | 'library'>[];
      readonly nameSource: 'chosen_card_name' | 'target_spell_name' | 'referenced_card_name';
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
      /**
       * Each selected player partitions matching objects they control into a
       * fixed number of piles, in turn order. A random pile may then be
       * sacrificed for each player.
       */
      readonly kind: 'separate_into_piles';
      readonly who: OraclePlayerSelector;
      readonly what: OracleObjectSelector;
      readonly pileCount: number;
      readonly startingWith: OraclePlayerSelector;
      readonly allowEmptyPiles?: boolean;
      readonly randomPileAction?: 'sacrifice';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * A permanent-to-library exchange followed by exiling replacement cards.
       * Supports either one existing target or one target chosen per player.
       */
      readonly kind: 'library_chaos_exchange';
      readonly targetMode: 'single_target' | 'one_per_player';
      readonly target: OracleObjectSelector;
      readonly exileMode: 'top_card' | 'until_nonland';
      readonly putLandOntoBattlefield?: boolean;
      readonly mayCastNonlandWithoutPayingManaCost: true;
      readonly bottomRestRandom?: boolean;
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
      /**
       * End the combat phase (Mandate of Peace, etc.): remove attackers/blockers,
       * exile the stack, and advance to postcombat main.
       */
      readonly kind: 'end_combat_phase';
      readonly exileStack?: boolean;
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
      readonly count?: number;
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
      readonly whereX?: OracleClauseCondition;
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
      /** Optional repeat count for clauses like "Add four mana of the chosen color." */
      readonly amount?: OracleQuantity;
      /** Optional mana choices for clauses like "Add {R} or {G}." */
      readonly manaOptions?: readonly string[];
      /** Restricts available choices to the controller's commander color identity. */
      readonly manaOptionsScope?: 'commander_color_identity' | 'referenced_permanent_colors';
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
      /**
       * Join Forces — "Starting with you, each player may pay any amount of mana."
       * X on later steps is the total mana paid this way (including 0).
       */
      readonly kind: 'join_forces';
      readonly who: OraclePlayerSelector;
      readonly startingWith?: 'you';
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
      /** Creature types excluded from the choice, e.g. "other than Wall". */
      readonly excludedTypes?: readonly string[];
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
      readonly choice?: 'card_type' | 'letter' | 'odd_even' | 'text_change' | 'number_of_lands' | 'generic';
      readonly choiceText?: string;
      readonly who?: OraclePlayerSelector;
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
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'surveil';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly whereX?: OracleClauseCondition;
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
;
