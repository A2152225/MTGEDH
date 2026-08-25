// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: StepApplyResult, StepSkipResult, BattlefieldStepHandlerResult, RecentBattlefieldRuntime.
// Public entries: BattlefieldStepHandlerResult, RecentBattlefieldRuntime, StepApplyResult, StepSkipResult.

import type { GameState } from '../../shared/src';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';

export type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastExiledCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastAntecedentBattlefieldPermanentIds?: readonly string[];
  readonly lastTappedMatchingPermanentCount?: number;
  readonly lastTappedMatchingPermanentIds?: readonly string[];
  readonly skipLedgerFlush?: boolean;
};

export type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'no_deterministic_target'
    | 'unsupported_target'
    | 'unsupported_player_selector'
    | 'unsupported_object_selector'
    | 'player_choice_required'
    | 'impossible_action'
    | 'unsupported_condition'
    | 'condition_false';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  };
};

export type BattlefieldStepHandlerResult = StepApplyResult | StepSkipResult;

export type RecentBattlefieldRuntime = {
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastCreatedTokenIds?: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastExiledCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastSacrificedPermanents?: readonly any[];
};
