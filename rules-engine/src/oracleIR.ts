import type { AbilityType } from './oracleTextParser';

export type OracleQuantity =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'x' }
  | { readonly kind: 'unknown'; readonly raw?: string };

export type OraclePlayerSelector =
  | { readonly kind: 'you' }
  | { readonly kind: 'each_player' }
  | { readonly kind: 'each_opponent' }
  | { readonly kind: 'target_player' }
  | { readonly kind: 'target_opponent' }
  /** Special-case selector used by move_zone battlefield control overrides. */
  | { readonly kind: 'owner_of_moved_cards' }
  | { readonly kind: 'unknown'; readonly raw: string };

export type OracleObjectSelector =
  | { readonly kind: 'raw'; readonly text: string }
  | { readonly kind: 'unknown'; readonly raw: string };

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
      readonly duration: 'this_turn' | 'until_end_of_next_turn' | 'as_long_as_remains_exiled';
      /** Whether oracle text granted 'play' (lands + cast) or 'cast' (spells only). */
      readonly permission: 'play' | 'cast';
      /** Optional simple condition gating the permission (e.g. "If it's red/nonland..."). */
      readonly condition?:
        | { readonly kind: 'color'; readonly color: 'W' | 'U' | 'B' | 'R' | 'G' }
        | { readonly kind: 'type'; readonly type: 'land' | 'nonland' };
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'add_mana';
      readonly who: OraclePlayerSelector;
      /** Raw mana string, e.g. "{R}{R}{R}" or "{2}{C}" */
      readonly mana: string;
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
      readonly kind: 'mill';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
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
      readonly kind: 'create_token';
      readonly who: OraclePlayerSelector;
      readonly amount: OracleQuantity;
      /** Best-effort free text token description (e.g. "1/1 white Soldier creature"). */
      readonly token: string;
      /** Whether the token enters the battlefield tapped (deterministic). */
      readonly entersTapped?: boolean;
      /** Counters the token enters with (deterministic, single-clause only). */
      readonly withCounters?: Record<string, number>;
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
      /** If the move puts cards onto the battlefield tapped (deterministic). */
      readonly entersTapped?: boolean;
      readonly optional?: boolean;
      readonly sequence?: 'then';
      readonly raw: string;
    }
  | {
      readonly kind: 'unknown';
      readonly raw: string;
      readonly sequence?: 'then';
    };

export interface OracleIRAbility {
  readonly type: AbilityType;
  readonly text: string;
  readonly cost?: string;
  readonly triggerCondition?: string;
  readonly effectText: string;
  readonly steps: readonly OracleEffectStep[];
}

export interface OracleIRResult {
  readonly normalizedOracleText: string;
  readonly abilities: readonly OracleIRAbility[];
  readonly keywords: readonly string[];
}
