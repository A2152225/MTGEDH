import type { AbilityType } from './oracleTextParser';

export type OracleQuantity =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'x' }
  | { readonly kind: 'unknown'; readonly raw?: string };

export type OraclePlayerSelector =
  | { readonly kind: 'you' }
  | { readonly kind: 'each_player' }
  | { readonly kind: 'each_opponent' }
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
  | { readonly kind: 'unknown'; readonly raw: string };

export type OracleClauseCondition =
  | { readonly kind: 'if'; readonly raw: string }
  | { readonly kind: 'as_long_as'; readonly raw: string }
  | { readonly kind: 'where'; readonly raw: string };

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
      readonly kind: 'draw';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
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
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_graveyard_permissions';
      readonly scope: 'last_granted_graveyard_cards';
      readonly castCost?: 'mana_cost';
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
      readonly kind: 'add_mana';
      readonly who: OraclePlayerSelector;
      /** Raw mana string, e.g. "{R}{R}{R}" or "{2}{C}" */
      readonly mana: string;
      /** Optional mana choices for clauses like "Add {R} or {G}." */
      readonly manaOptions?: readonly string[];
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
      readonly kind: 'add_counter';
      readonly target: OracleObjectSelector;
      readonly counter: string;
      readonly amount: OracleQuantity;
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
      readonly kind: 'discard';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
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
      readonly target: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'prevent_damage';
      readonly amount: 'all';
      readonly target: OracleObjectSelector;
      readonly duration: 'this_turn';
      /** Restricts legal target sources to those sharing a color with the linked exiled card. */
      readonly sharesColorWithLinkedExiledCard?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'tap_or_untap';
      readonly target: OracleObjectSelector;
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
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'destroy';
      readonly target: OracleObjectSelector;
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
      readonly subject: 'this_spell' | 'last_moved_card';
      readonly withoutPayingManaCost?: boolean;
      /** Whether the copy may choose new target(s) for deterministic replay. */
      readonly allowNewTargets?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'create_emblem';
      readonly abilities: readonly string[];
      readonly name?: string;
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
