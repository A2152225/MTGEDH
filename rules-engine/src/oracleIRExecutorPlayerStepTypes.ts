// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: StepApplyResult, StepSkipResult, Unless*Result, PlayerStepHandlerResult.
// Public entries: PlayerStepHandlerResult, StepApplyResult, StepSkipResult,
// UnlessPaysLifeResult, UnlessPaysManaResult, UnlessDiscardsResult.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';

export type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly count?: number;
  readonly lastTopLibraryOwnerId?: PlayerID;
  readonly lastClashWon?: boolean;
  readonly lastCollectedEvidence?: boolean;
  readonly lastVisitedAttractions?: readonly any[];
  readonly lastScryLookedAtCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastGreatestDiscardedCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastRevealedCardCount?: number;
  readonly lastGrantedGraveyardCards?: readonly any[];
  readonly lastGrantedGraveyardPermissionIds?: readonly string[];
  readonly lastDungeonRoomEffectText?: string;
  readonly lastDungeonRoomName?: string;
  readonly lastDungeonName?: string;
  readonly lastSetInMotionScheme?: any;
  readonly lastAntecedentBattlefieldPermanentIds?: readonly string[];
  readonly skipLedgerFlush?: boolean;
  readonly replayMutations?: readonly OracleIRReplayMutation[];
};

export type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason:
    | 'unknown_amount'
    | 'unsupported_player_selector'
    | 'unsupported_object_selector'
    | 'unsupported_condition_clause'
    | 'player_choice_required'
    | 'impossible_action'
    | 'failed_to_apply'
    | 'invalid_input'
    | 'no_deterministic_target';
  readonly state?: GameState;
  readonly options?: {
    readonly classification?: 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<
      string,
      string | number | boolean | readonly string[] | Readonly<Record<string, number>>
    >;
    readonly persist?: boolean;
  };
};

export type UnlessPaysLifeResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | StepSkipResult;

export type UnlessPaysManaResult =
  | {
      readonly applied: true;
      readonly shouldApplyNestedSteps: boolean;
      readonly state?: GameState;
      readonly log: readonly string[];
      readonly paidManaAmount?: string;
    }
  | StepSkipResult;

export type UnlessDiscardsResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | (StepSkipResult & {
      /**
       * When set, the caller should record this inner step (rather than the outer
       * `unless_discards` wrapper) as the skipped step, so the existing "discard"
       * automation-gap plumbing (and its server-side card-selection prompt) fires
       * for the actual discard choice instead of a bespoke prompt.
       */
      readonly innerStep?: OracleEffectStep;
    });

export type PlayerStepHandlerResult = StepApplyResult | StepSkipResult;
