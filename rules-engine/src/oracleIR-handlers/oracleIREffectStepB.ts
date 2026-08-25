/**
 * Origin parent: rules-engine/src/oracleIR.ts
 * Cluster: OracleEffectStep union members (learn … prevent_damage)
 * Public: OracleEffectStepB
 * Leaf must not import oracleIR.ts or oracleIR-handlers/index.ts.
 */

import type {
  OracleClauseCondition,
  OracleObjectSelector,
  OraclePlayerSelector,
  OracleQuantity,
  OracleScaler,
} from './oracleIRSharedTypes';
import type { OracleEffectStep } from './oracleIREffectStep';

export type OracleEffectStepB =
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
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'airbend';
      readonly target: OracleObjectSelector;
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
      /** Named ballot options (time/knowledge, truth/consequences, …). Empty for player/permanent ballots. */
      readonly choices: readonly string[];
      /** Secret council: votes are hidden until all are cast. */
      readonly secret?: boolean;
      /** What each voter selects. Defaults to named `choices` labels. */
      readonly ballot?: 'labels' | 'players' | 'permanents';
      /** Oracle filter text for player/permanent ballots, e.g. "another player". */
      readonly ballotFilter?: string;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'look_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'reveal_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'look_select_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly choose: OracleQuantity;
      readonly chooseMin?: number;
      readonly whereX?: OracleClauseCondition;
      readonly destination: 'hand' | 'graveyard' | 'library_top';
      readonly restDestination: 'graveyard' | 'library';
      readonly restToTop?: boolean;
      readonly restRandomOrder?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'look_choose_from_top';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly whereX?: OracleClauseCondition;
      readonly selectorText: string;
      readonly destination: 'hand' | 'exile' | 'battlefield';
      readonly reveal?: boolean;
      readonly restOrder?: 'any';
      /** Where unselected / non-matching looked cards go (default: library bottom). */
      readonly nonMatchRest?: 'library_top' | 'graveyard' | 'library_bottom';
      /** Optional graveyard when an optional hand selection is declined (Gathering Stone). */
      readonly declinedRest?: 'graveyard';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'put_on_bottom';
      readonly who: OraclePlayerSelector;
      readonly what: OracleObjectSelector;
      readonly order?: 'random' | 'any';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'add_counter';
      readonly target?: OracleObjectSelector;
      readonly who?: OraclePlayerSelector;
      readonly what?: OracleObjectSelector;
      readonly counter: string;
      readonly amount: OracleQuantity;
      /** When set, total `amount` is split among resolved targets (distribute … among …). */
      readonly distribution?: 'among';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
      readonly thisWayAntecedentStepIndex?: number;
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
      readonly whereX?: OracleClauseCondition;
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
      readonly duration: 'end_of_turn' | 'until_next_turn' | 'this_turn' | 'static';
      readonly scaler?: OracleScaler;
      readonly condition?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
      /** Parser-bound antecedent for "this way" clauses (step ledger index). */
      readonly thisWayAntecedentStepIndex?: number;
      readonly thisWayAntecedentStepKind?: string;
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
      readonly duration: 'end_of_turn' | 'this_turn' | 'until_next_turn' | 'during_resolution';
      /** Keyword-style granted abilities that should behave like transient grantedAbilities. */
      readonly abilities?: readonly string[];
      /** Legacy compiled-envelope alias for temporary granted ability text. */
      readonly abilityText?: string;
      /** Additional temporary text that should matter while this effect lasts. */
      readonly effectText?: readonly string[];
      readonly power?: number;
      readonly toughness?: number;
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
      readonly keyword?: string;
      readonly power?: number;
      readonly toughness?: number;
      readonly duration?: 'static' | 'while_attached' | 'this_turn' | 'end_of_turn' | 'until_next_turn';
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
      readonly whereX?: OracleClauseCondition;
      readonly unlessCondition?: OracleClauseCondition;
      readonly atRandom?: boolean;
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
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'lose_life';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      readonly whereX?: OracleClauseCondition;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'deal_damage';
      readonly amount: OracleQuantity;
      readonly whereX?: OracleClauseCondition;
      readonly source?: OracleObjectSelector;
      readonly target: OracleObjectSelector;
      readonly who?: OraclePlayerSelector;
      readonly division?: 'as_you_choose' | 'evenly_rounded_down';
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'modify_damage';
      readonly mode: 'add' | 'subtract';
      readonly amount: OracleQuantity;
      readonly whereX?: OracleClauseCondition;
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
      /** Leave this much damage (Forcefield: prevent all but N). */
      readonly leaveAmount?: number;
      /** Restricts legal target sources to those sharing a color with the linked exiled card. */
      readonly sharesColorWithLinkedExiledCard?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
;
