// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: shared types for applyOracleIRStepsToGameStateImpl switch-family
// hoists (RecurseExecutor plus the mutable family ctx the dispatcher passes).
// Public entry symbols: RecurseExecutor, MainLoopStepFamilyCtx,
// wrapMainLoopFamilyApplyHandled, flushMainLoopFamilyMutableState,
// captureMainLoopFamilyMutableState, normalizeSkipMetadata.

import type { BattlefieldPermanent, GameState, PlayerID, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
  OracleIRStepOutcome,
} from './oracleIRExecutionTypes';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import type { OracleIRReplayMutation } from './oracleIRReplayMutations';
import type { StepLedger } from './oracleIRStepLedgerRuntime';

export type RecurseExecutor = (
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions
) => OracleIRExecutionResult;

export type MainLoopStepOutcomeKind = OracleIRStepOutcome['kind'];

export type MainLoopCurrentCtx = OracleIRExecutionContext & {
  readonly lastRevealedCards?: readonly unknown[];
  readonly lastGreatestDiscardedCardCount?: number;
  readonly lastCreatedTokenIds?: readonly string[];
};

export type MainLoopSkipOptions = {
  readonly pending?: boolean;
  readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
  readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
  readonly persist?: boolean;
};

export type MainLoopApplyHandledFn = (
  step: OracleEffectStep,
  result: any,
  onApplied?: (appliedResult: any) => void
) => boolean;

export type MainLoopRecordSkippedFn = (
  step: OracleEffectStep,
  message: string,
  reasonCode: string,
  skipOptions?: MainLoopSkipOptions
) => void;

export type MainLoopSetLastStepOutcomeFn = (
  step: OracleEffectStep,
  kind: MainLoopStepOutcomeKind,
  metadata?: { readonly count?: number }
) => void;

export type MainLoopApplyModifyPtFn = (step: OracleEffectStep, result: any) => boolean;

export type MainLoopAbsorbReplayFn = (execution: {
  readonly replayMutations?: readonly OracleIRReplayMutation[];
}) => void;

export type MainLoopMergeNestedOutcomeFn = (nestedResult: {
  readonly lastStepOutcome?: OracleIRStepOutcome | null;
}) => void;

export function normalizeSkipMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | null | readonly string[]> | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => {
      if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        Array.isArray(value)
      ) {
        return [key, value];
      }
      return [key, JSON.stringify(value)];
    }),
  ) as Record<string, string | number | boolean | null | readonly string[]>;
}

export type MainLoopFamilyMutableState = {
  nextState: GameState;
  currentCtx: MainLoopCurrentCtx;
  lastRevealedCardCount: number;
  lastDiscardedCardCount: number;
  lastGreatestDiscardedCardCount: number;
  lastDiscardedCards: any[];
  lastExiledCardCount: number;
  lastExiledCards: any[];
  lastGrantedGraveyardCards: any[];
  lastGrantedGraveyardPermissionIds: string[];
  lastMovedCards: any[];
  lastMilledCards: any[];
  lastMovedBattlefieldPermanentIds: string[];
  lastCreatedTokenIds: string[];
  lastGoadedCreatures: BattlefieldPermanent[];
  lastSacrificedCreaturesPowerTotal: number;
  lastSacrificedPermanents: LastKnownPermanentSnapshot[];
  lastExcessDamageDealtThisWay: number;
  lastScryLookedAtCount: number;
  lastTappedMatchingPermanentCount: number;
  lastReferenceAmount: number | undefined;
  lastMovedCountByPlayer: Readonly<Record<string, number>> | undefined;
  lastClashWon: boolean | undefined;
  lastCollectedEvidence: boolean | undefined;
  lastSetInMotionScheme: unknown;
  lastStepOutcome: OracleIRStepOutcome | null;
  lastActionOutcome: OracleIRStepOutcome | null;
  lastConditionalEvaluation: boolean | null;
  replayMutations: OracleIRReplayMutation[];
  anyConditionalProducedSteps: boolean;
  haltedForPlayerChoice: boolean;
  pendingContinuationSteps: OracleEffectStep[] | undefined;
  automationGapSequence: number;
};

export type MainLoopStepFamilyCtx = MainLoopFamilyMutableState & {
  controllerId: PlayerID;
  log: string[];
  appliedSteps: OracleEffectStep[];
  skippedSteps: OracleEffectStep[];
  localAutomationGaps: OracleAutomationGap[];
  automationGaps: OracleAutomationGap[];
  pendingOptionalSteps: OracleEffectStep[];
  falseConditionalMarkers: Set<OracleEffectStep>;
  stepLedger: StepLedger;
  appliedStepKinds: Map<number, string>;
  recurse: RecurseExecutor;
  options: OracleIRExecutionOptions;
  steps: readonly OracleEffectStep[];
  stepIndex: number;
  applyHandledStepResult: MainLoopApplyHandledFn;
  recordSkippedStep: MainLoopRecordSkippedFn;
  setLastStepOutcome: MainLoopSetLastStepOutcomeFn;
  applyModifyPtStepResult: MainLoopApplyModifyPtFn;
  absorbExecutionReplayMutations: MainLoopAbsorbReplayFn;
  mergeNestedExecutionOutcome: MainLoopMergeNestedOutcomeFn;
};

export function captureMainLoopFamilyMutableState(ctx: MainLoopStepFamilyCtx): MainLoopFamilyMutableState {
  return {
    nextState: ctx.nextState,
    currentCtx: ctx.currentCtx,
    lastRevealedCardCount: ctx.lastRevealedCardCount,
    lastDiscardedCardCount: ctx.lastDiscardedCardCount,
    lastGreatestDiscardedCardCount: ctx.lastGreatestDiscardedCardCount,
    lastDiscardedCards: ctx.lastDiscardedCards,
    lastExiledCardCount: ctx.lastExiledCardCount,
    lastExiledCards: ctx.lastExiledCards,
    lastGrantedGraveyardCards: ctx.lastGrantedGraveyardCards,
    lastGrantedGraveyardPermissionIds: ctx.lastGrantedGraveyardPermissionIds,
    lastMovedCards: ctx.lastMovedCards,
    lastMilledCards: ctx.lastMilledCards,
    lastMovedBattlefieldPermanentIds: ctx.lastMovedBattlefieldPermanentIds,
    lastCreatedTokenIds: ctx.lastCreatedTokenIds,
    lastGoadedCreatures: ctx.lastGoadedCreatures,
    lastSacrificedCreaturesPowerTotal: ctx.lastSacrificedCreaturesPowerTotal,
    lastSacrificedPermanents: ctx.lastSacrificedPermanents,
    lastExcessDamageDealtThisWay: ctx.lastExcessDamageDealtThisWay,
    lastScryLookedAtCount: ctx.lastScryLookedAtCount,
    lastTappedMatchingPermanentCount: ctx.lastTappedMatchingPermanentCount,
    lastReferenceAmount: ctx.lastReferenceAmount,
    lastMovedCountByPlayer: ctx.lastMovedCountByPlayer,
    lastClashWon: ctx.lastClashWon,
    lastCollectedEvidence: ctx.lastCollectedEvidence,
    lastSetInMotionScheme: ctx.lastSetInMotionScheme,
    lastStepOutcome: ctx.lastStepOutcome,
    lastActionOutcome: ctx.lastActionOutcome,
    lastConditionalEvaluation: ctx.lastConditionalEvaluation,
    replayMutations: ctx.replayMutations,
    anyConditionalProducedSteps: ctx.anyConditionalProducedSteps,
    haltedForPlayerChoice: ctx.haltedForPlayerChoice,
    pendingContinuationSteps: ctx.pendingContinuationSteps,
    automationGapSequence: ctx.automationGapSequence,
  };
}

export function pickMainLoopFamilyCore(ctx: MainLoopStepFamilyCtx): Pick<
  MainLoopFamilyMutableState,
  | 'nextState'
  | 'currentCtx'
  | 'lastMovedCards'
  | 'lastScryLookedAtCount'
  | 'lastReferenceAmount'
  | 'lastStepOutcome'
  | 'lastActionOutcome'
  | 'replayMutations'
  | 'haltedForPlayerChoice'
  | 'automationGapSequence'
> {
  return {
    nextState: ctx.nextState,
    currentCtx: ctx.currentCtx,
    lastMovedCards: ctx.lastMovedCards,
    lastScryLookedAtCount: ctx.lastScryLookedAtCount,
    lastReferenceAmount: ctx.lastReferenceAmount,
    lastStepOutcome: ctx.lastStepOutcome,
    lastActionOutcome: ctx.lastActionOutcome,
    replayMutations: ctx.replayMutations,
    haltedForPlayerChoice: ctx.haltedForPlayerChoice,
    automationGapSequence: ctx.automationGapSequence,
  };
}

export function pullMainLoopFamilyCoreFromCtx(
  ctx: MainLoopStepFamilyCtx,
  into: MainLoopFamilyMutableState,
): void {
  into.nextState = ctx.nextState;
  into.currentCtx = ctx.currentCtx;
  into.lastMovedCards = ctx.lastMovedCards;
  into.lastScryLookedAtCount = ctx.lastScryLookedAtCount;
  into.lastReferenceAmount = ctx.lastReferenceAmount;
  into.lastStepOutcome = ctx.lastStepOutcome;
  into.lastActionOutcome = ctx.lastActionOutcome;
  into.replayMutations = ctx.replayMutations;
  into.haltedForPlayerChoice = ctx.haltedForPlayerChoice;
  into.automationGapSequence = ctx.automationGapSequence;
}

export function flushMainLoopFamilyMutableState(
  ctx: MainLoopStepFamilyCtx,
  from: MainLoopFamilyMutableState,
  startNextState: GameState,
): void {
  if (from.nextState !== startNextState) {
    ctx.nextState = from.nextState;
  }
  ctx.currentCtx = from.currentCtx;
  ctx.lastRevealedCardCount = from.lastRevealedCardCount;
  ctx.lastDiscardedCardCount = from.lastDiscardedCardCount;
  ctx.lastGreatestDiscardedCardCount = from.lastGreatestDiscardedCardCount;
  ctx.lastDiscardedCards = from.lastDiscardedCards;
  ctx.lastExiledCardCount = from.lastExiledCardCount;
  ctx.lastExiledCards = from.lastExiledCards;
  ctx.lastGrantedGraveyardCards = from.lastGrantedGraveyardCards;
  ctx.lastGrantedGraveyardPermissionIds = from.lastGrantedGraveyardPermissionIds;
  ctx.lastMovedCards = from.lastMovedCards;
  ctx.lastMilledCards = from.lastMilledCards;
  ctx.lastMovedBattlefieldPermanentIds = from.lastMovedBattlefieldPermanentIds;
  ctx.lastCreatedTokenIds = from.lastCreatedTokenIds;
  ctx.lastGoadedCreatures = from.lastGoadedCreatures;
  ctx.lastSacrificedCreaturesPowerTotal = from.lastSacrificedCreaturesPowerTotal;
  ctx.lastSacrificedPermanents = from.lastSacrificedPermanents;
  ctx.lastExcessDamageDealtThisWay = from.lastExcessDamageDealtThisWay;
  ctx.lastScryLookedAtCount = from.lastScryLookedAtCount;
  ctx.lastTappedMatchingPermanentCount = from.lastTappedMatchingPermanentCount;
  ctx.lastReferenceAmount = from.lastReferenceAmount;
  ctx.lastMovedCountByPlayer = from.lastMovedCountByPlayer;
  ctx.lastClashWon = from.lastClashWon;
  ctx.lastCollectedEvidence = from.lastCollectedEvidence;
  ctx.lastSetInMotionScheme = from.lastSetInMotionScheme;
  ctx.lastStepOutcome = from.lastStepOutcome;
  ctx.lastActionOutcome = from.lastActionOutcome;
  ctx.lastConditionalEvaluation = from.lastConditionalEvaluation;
  ctx.replayMutations = from.replayMutations;
  ctx.anyConditionalProducedSteps = from.anyConditionalProducedSteps;
  ctx.haltedForPlayerChoice = from.haltedForPlayerChoice;
  ctx.pendingContinuationSteps = from.pendingContinuationSteps;
  ctx.automationGapSequence = from.automationGapSequence;
}

export function wrapMainLoopFamilyApplyHandled(
  ctx: MainLoopStepFamilyCtx,
  locals: MainLoopFamilyMutableState,
): MainLoopApplyHandledFn {
  return (step, result, onApplied) => {
    const ok = ctx.applyHandledStepResult(step, result, (appliedResult) => {
      pullMainLoopFamilyCoreFromCtx(ctx, locals);
      onApplied?.(appliedResult);
      flushMainLoopFamilyMutableState(ctx, locals, locals.nextState);
    });
    pullMainLoopFamilyCoreFromCtx(ctx, locals);
    return ok;
  };
}

export function wrapMainLoopFamilyRecordSkipped(
  ctx: MainLoopStepFamilyCtx,
  locals: MainLoopFamilyMutableState,
): MainLoopRecordSkippedFn {
  return (step, message, reasonCode, skipOptions) => {
    flushMainLoopFamilyMutableState(ctx, locals, locals.nextState);
    ctx.recordSkippedStep(step, message, reasonCode, skipOptions);
    pullMainLoopFamilyCoreFromCtx(ctx, locals);
  };
}

export function wrapMainLoopFamilySetLastStepOutcome(
  ctx: MainLoopStepFamilyCtx,
  locals: MainLoopFamilyMutableState,
): MainLoopSetLastStepOutcomeFn {
  return (step, kind, metadata) => {
    flushMainLoopFamilyMutableState(ctx, locals, locals.nextState);
    ctx.setLastStepOutcome(step, kind, metadata);
    pullMainLoopFamilyCoreFromCtx(ctx, locals);
  };
}

export function wrapMainLoopFamilyApplyModifyPt(
  ctx: MainLoopStepFamilyCtx,
  locals: MainLoopFamilyMutableState,
): MainLoopApplyModifyPtFn {
  return (step, result) => {
    flushMainLoopFamilyMutableState(ctx, locals, locals.nextState);
    const ok = ctx.applyModifyPtStepResult(step, result);
    pullMainLoopFamilyCoreFromCtx(ctx, locals);
    return ok;
  };
}
