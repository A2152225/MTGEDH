// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster moved: the move_zone step result/runtime/zone-location type declarations that the parent
// and its extracted leaf modules both need (previously private types in the parent).
// Public entry symbols: StepApplyResult, StepSkipResult, MoveZoneStepHandlerResult, MoveZoneRuntime,
// BoundCardZoneLocation.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';

export type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastMovedCards?: readonly any[];
  readonly lastMovedBattlefieldPermanentIds?: readonly string[];
  readonly lastReferenceAmount?: number;
  readonly lastMovedCountByPlayer?: Readonly<Record<string, number>>;
  readonly replayMutations?: readonly OracleIRReplayMutation[];
  readonly skipLedgerFlush?: boolean;
};

export type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unsupported_destination'
    | 'unsupported_selector'
    | 'battlefield_requires_explicit_control_override'
    | 'player_choice_required'
    | 'no_deterministic_target'
    | 'impossible_action';
  readonly options?: {
    readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
    readonly persist?: boolean;
  };
};

export type MoveZoneStepHandlerResult = StepApplyResult | StepSkipResult;

export type MoveZoneRuntime = {
  readonly lastMovedCards?: readonly any[];
  readonly lastExiledCards?: readonly any[];
  readonly lastMilledCards?: readonly any[];
  readonly lastDiscardedCards?: readonly any[];
  readonly lastSacrificedPermanents?: readonly any[];
  readonly lastTappedMatchingPermanentIds?: readonly string[];
  readonly lastReferenceAmount?: number;
};

export type BoundCardZoneLocation = {
  readonly playerId: PlayerID;
  readonly zone: 'graveyard' | 'hand' | 'exile' | 'library';
};
