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
