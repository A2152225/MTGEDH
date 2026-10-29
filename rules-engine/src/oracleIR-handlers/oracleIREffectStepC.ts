/**
 * Origin parent: rules-engine/src/oracleIR.ts
 * Cluster: OracleEffectStep union members (damage_cant_be_prevented … unknown)
 * Public: OracleEffectStepC
 * Leaf must not import oracleIR.ts or oracleIR-handlers/index.ts.
 */

import type {
  OracleBattlefieldObjectCondition,
  OracleClauseCondition,
  OracleObjectSelector,
  OraclePlayerSelector,
  OracleQuantity,
  OracleZone,
} from './oracleIRSharedTypes';
import type { OracleEffectStep } from './oracleIREffectStep';

export type OracleEffectStepC =
  | {
      readonly kind: 'damage_cant_be_prevented';
      readonly duration: 'this_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /** Remove marked damage from permanents (CR 701.69, heal). */
      readonly kind: 'remove_marked_damage';
      readonly target: OracleObjectSelector;
      readonly amount: 'all' | OracleQuantity;
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
      readonly kind: 'register_lose_game_replacement';
      readonly who: OraclePlayerSelector;
      readonly drawCount: number;
      readonly lifeTotal: number;
      readonly expiresAt?: 'end_of_turn';
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
      /**
       * Removes a creature from combat. When requested, creatures blocked only by
       * it this combat become unblocked (for effects such as Imprison).
       */
      readonly kind: 'remove_from_combat';
      readonly target: OracleObjectSelector;
      readonly unblockCreaturesBlockedOnlyByIt?: boolean;
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
      /** Whether created tokens enter blocking a referenced creature (e.g. Brimaz block trigger). */
      readonly blocking?: 'that_creature';
      /** Counters the token enters with (deterministic, single-clause only). */
      readonly withCounters?: Record<string, number>;
      /** For Aura-style token creation that enters attached to a deterministic object. */
      readonly battlefieldAttachedTo?: OracleObjectSelector;
      /** Grant haste to the created token(s). */
      readonly grantsHaste?: 'permanent' | 'until_end_of_turn';
      /** Grant one or more keyword abilities to the created token(s) until end of turn (e.g. "They gain flying until end of turn."). */
      readonly grantsAbilitiesUntilEndOfTurn?: readonly string[];
      /** Permanent defining keyword grants (e.g. "It has flying." / "They are indestructible."). */
      readonly grantsAbilitiesPermanent?: readonly string[];
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
       * Instant/sorcery delayed window: "Whenever a [types] you control enters this turn, …"
       * (Rite of Harmony family). Server state key: temporaryEtbTriggers.
       */
      readonly kind: 'grant_temporary_etb_trigger';
      readonly watchTypes: readonly string[];
      readonly nontokenOnly?: boolean;
      readonly effect: string;
      readonly duration: 'until_end_of_turn';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * "Each player chooses a [type] they control. Destroy the rest."
       * (Divine Reckoning family). Server queues existing TARGET_SELECTION.
       */
      readonly kind: 'each_player_choose_then_destroy_rest';
      readonly choosers: OraclePlayerSelector;
      readonly keepTypes: readonly string[];
      readonly keepCount: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * "Each player chooses [up to] N [types] they control, then sacrifices the rest."
       * (Planetary Annihilation / Razia's Purification family). Server queues
       * TARGET_SELECTION per chooser who controls more than N, then sacrifices
       * the other matching permanents.
       */
      readonly kind: 'each_player_choose_then_sacrifice_rest';
      readonly choosers: OraclePlayerSelector;
      readonly keepTypes: readonly string[];
      readonly keepCount: number;
      readonly upTo?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Secret each-opponent binary choice plus all-same / mixed damage matrix
       * (Prisoner's Dilemma family). Server queues existing OPTION_CHOICE.
       */
      readonly kind: 'secret_opponent_choice_damage';
      readonly choosers: OraclePlayerSelector;
      readonly choices: readonly string[];
      readonly secret: true;
      readonly allFirstDamage: number;
      readonly allSecondDamage: number;
      readonly mixedFirstDamage: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * "Each player secretly chooses a number N or greater... deals damage equal
       * to the highest number... each player who didn't choose the lowest discards
       * their hand, then draws K cards." (Wheel of Misfortune family).
       */
      readonly kind: 'secret_each_player_number';
      readonly choosers: OraclePlayerSelector;
      readonly secret: true;
      readonly minNumber: number;
      readonly drawCount: number;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * "You may cast a [types] spell with mana value X or less from among
       * them/milled cards without paying its mana cost."
       */
      readonly kind: 'may_cast_from_among';
      readonly among: 'milled_this_way';
      readonly cardTypes: readonly string[];
      readonly maxManaValue: OracleQuantity;
      readonly withoutPayingManaCost?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * "You may reveal your hand. If you do, you win the game if you own a
       * card named [printed] in exile, in your hand, in your graveyard, and
       * on the battlefield." Printed name is this card's current name at
       * execute time — never a hardcoded card name.
       */
      readonly kind: 'may_reveal_hand_then_win_if_own_named_in_zones';
      readonly zones: readonly ['exile', 'hand', 'graveyard', 'battlefield'];
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
      readonly action: 'sacrifice' | 'exile' | 'destroy';
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
        | 'your_next_upkeep'
        | 'next_end_of_combat'
        | 'on_event'
        | 'when_dealt_damage';
      readonly effect: string;
      /** Parsed metadata for delayed effect text; not executed when scheduling. */
      readonly steps?: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'grant_cast_permission';
      readonly who: OraclePlayerSelector;
      readonly filter?: string;
      readonly withoutPayingManaCost?: boolean;
      readonly duration?: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'copy_ability';
      readonly target?: OracleObjectSelector;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /** Parser escape hatch for unstructured residual text. */
      readonly kind: 'raw';
      readonly text?: string;
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
      /** Reselect legal targets at random instead of prompting a player choice. */
      readonly random?: boolean;
      /** Targets that must not be chosen (e.g. "you or a permanent you control"). */
      readonly exclude?: OracleObjectSelector;
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
      /**
       * Repeatedly let players choose one card from a shared zone pool (e.g. exiled this way)
       * until the pool is empty. Chooser order starts with `whoStarts` then follows turn order.
       */
      readonly kind: 'repeated_zone_draft';
      readonly pool: OracleObjectSelector;
      readonly whoStarts: OraclePlayerSelector;
      readonly chooserOrder: 'turn_order';
      readonly destination: OracleZone;
      readonly entersTapped?: boolean;
      /** Who controls the permanent after drafting (defaults to the current chooser). */
      readonly battlefieldController?: OraclePlayerSelector;
      readonly thisWayAntecedentStepIndex?: number;
      readonly thisWayAntecedentStepKind?: string;
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
       * Who performs the move (e.g. "each player shuffles all permanents they own").
       * When absent, defaults to the ability controller.
       */
      readonly who?: OraclePlayerSelector;
      /** Explicit library placement when `to === 'library'` (overrides text heuristics). */
      readonly libraryPlacement?: 'top' | 'bottom';
      /** Order cards are put into the destination zone (e.g. remainder cards to library). */
      readonly order?: 'random' | 'any';
      /** Index of an earlier step in the same ability whose "this way" pool this move draws from. */
      readonly thisWayAntecedentStepIndex?: number;
      /** Kind of the earlier "this way" antecedent step (e.g. 'reveal_top', 'exile'). */
      readonly thisWayAntecedentStepKind?: string;
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
      /**
       * When spell X is at least `threshold`, player chooses among `destinations`
       * instead of using the default `to` zone (e.g. battlefield or hand).
       */
      readonly xAtLeastAlternate?: {
        readonly threshold: number;
        readonly destinations: readonly OracleZone[];
      };
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
      /**
       * Player(s) who control the created copy. Omitted means the effect
       * controller. "Each other player copies that spell" (Hive Mind) is
       * each_opponent resolved against the copied spell's controller.
       */
      readonly who?: OraclePlayerSelector;
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
      readonly kind: 'redistribute_life_totals';
      readonly who?: OraclePlayerSelector;
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
      readonly kind: 'blight';
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
  /** When true, max mode count becomes 2 if teamworkWasPaid is set on the execution context. */
  readonly teamworkChooseBoth?: boolean;
  /**
   * When true, if the source was kicked, both modes resolve (forced).
   * Unkicked: choose exactly one. Matches "If it was kicked, choose both instead."
   */
  readonly kickerChooseBoth?: boolean;
  /** When true, each chosen mode must target a different player (Shadrix-style). */
  readonly distinctPlayerTargets?: boolean;
  /**
   * Season-style `{P}` budget ("Choose up to five {P} worth of modes").
   * When set, selected modes' `pCost` values must sum to at most this budget.
   */
  readonly pBudget?: number;
  readonly modes: readonly {
        readonly label: string;
        /** Raw bullet text for display. */
        readonly raw: string;
        /** Steps that resolve when this mode is chosen. */
        readonly steps: readonly OracleEffectStep[];
        /** `{P}` cost for Season-style mode budgets (1 per `{P}`). */
        readonly pCost?: number;
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
      /** Steps that resolve when the condition is false, e.g. "instead" clauses folded into one conditional. */
      readonly elseSteps?: readonly OracleEffectStep[];
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
      readonly forEachPermanentText?: string;
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Wrapper for effects that only happen if a referenced player doesn't or
       * can't discard a fixed number of cards, e.g. "each opponent loses 3 life
       * unless they discard a card." (Court of Ambition).
       */
      readonly kind: 'unless_discards';
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
       * can't sacrifice a matching permanent, e.g. "counter it unless you
       * sacrifice a land" (Mana Vortex).
       */
      /**
       * Any player may make an optional payment; if someone does, nested steps
       * apply (typically counter this spell). Dash Hopes / Brain Gorgers-style.
       */
      readonly kind: 'any_player_may';
      readonly payment:
        | { readonly kind: 'life'; readonly amount: number }
        | { readonly kind: 'half_life_rounded_up' }
        | { readonly kind: 'discard'; readonly amount: number }
        | { readonly kind: 'sacrifice'; readonly what: string };
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'unless_sacrifices';
      readonly who: OraclePlayerSelector;
      readonly what: { readonly kind: 'raw'; readonly text: string };
      readonly steps: readonly OracleEffectStep[];
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      /**
       * Wrapper for effects that only happen if a referenced player doesn't or
       * can't pay a mana cost. `mana` is `{N}` / `{X}` (or the unit for scaled
       * taxes). Optional `manaAmountRaw` / `whereX` resolve at execute.
       */
      readonly kind: 'unless_pays_mana';
      readonly who: OraclePlayerSelector;
      readonly mana: string;
      readonly manaAmountRaw?: string;
      readonly whereX?: string;
      readonly forEachOpponentStackObjects?: boolean;
      readonly forEachPermanentText?: string;
      /** Winter's Chill: controller may pay {1} or {2} (or decline). */
      readonly manaOptions?: readonly string[];
      readonly steps: readonly OracleEffectStep[];
      /** Applied after a successful pay (e.g. “if that player pays only {1}”). */
      readonly paidSteps?: readonly OracleEffectStep[];
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

