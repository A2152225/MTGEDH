/**
 * Origin parent: oracleIRExecutorDamageStepHandlers.ts
 * Cluster moved: PreventionStepApplyResult, PreventionStepSkipResult,
 *   PreventDamageStepHandlerResult
 * Public: PreventDamageStepHandlerResult
 */

import type { GameState } from '../../../shared/src';

type PreventionStepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type PreventionStepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'impossible_action'
    | 'unsupported_target'
    | 'missing_linked_card'
    | 'no_deterministic_target'
    | 'player_choice_required';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type PreventDamageStepHandlerResult = PreventionStepApplyResult | PreventionStepSkipResult;
