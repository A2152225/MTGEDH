import type { GameState, PlayerID, BattlefieldPermanent, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { isPerPlayerOptionalOracleStep } from './oracleIRPerPlayerOptional';
import { collectReplayMutationsFromAppliedStep, mergeReplayMutations, type OracleIRReplayMutation } from './oracleIRReplayMutations';
import {
  appendOracleAutomationGapRecords,
  createOracleAutomationGapRecord,
} from './oracleIRAutomationGaps';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
} from './oracleIRExecutionTypes';
import {
  acquireStepLedgerForExecution,
  flushObservationLedgerFromChoiceDeferredResult,
  flushStepLedgerFromAppliedResult,
  sanitizeBridgedStepCarryOver,
  snapshotStepLedger,
  type StepLedger,
} from './oracleIRStepLedgerRuntime';
import { trackAppliedStepKind } from './oracleIRStepLedger';
import type { RecurseExecutor, MainLoopStepFamilyCtx } from './oracleIRExecutorMainLoopStepTypes';
import { tryApplyMainLoopExileRestrictionSteps } from './oracleIRExecutorMainLoopExileRestrictionSteps';
import { tryApplyMainLoopCoinDieDrawSteps } from './oracleIRExecutorMainLoopCoinDieDrawSteps';
import { tryApplyMainLoopLibraryTurnControlSteps } from './oracleIRExecutorMainLoopLibraryTurnControlSteps';
import { tryApplyMainLoopChoiceFamilySteps } from './oracleIRExecutorMainLoopChoiceFamilySteps';
import { tryApplyMainLoopChoiceKeywordLookSteps } from './oracleIRExecutorMainLoopChoiceKeywordLookSteps';
import { tryApplyMainLoopMillPtTokenSteps } from './oracleIRExecutorMainLoopMillPtTokenSteps';
import { tryApplyMainLoopCopyDestroySteps } from './oracleIRExecutorMainLoopCopyDestroySteps';
import { tryApplyMainLoopLateSteps } from './oracleIRExecutorMainLoopLateSteps';

const HALT_ON_PLAYER_CHOICE_STEP_KINDS = new Set<string>([
  'add_mana',
  'blight',
  'change_target',
  'choose_pile',
  'connive',
  'discard',
  'explore',
  'flip_coin',
  'look_choose_from_top',
  'look_select_top',
  'library_chaos_exchange',
  'lose_life',
  'move_zone',
  'pay_mana',
  'join_forces',
  'tempting_offer',
  'player_choice',
  'proliferate',
  'redistribute_life_totals',
  'populate',
  'repeated_zone_draft',
  'separate_into_piles',
  'sacrifice',
  'scry',
  'search_library',
  'surveil',
  'tap_matching_permanents',
  'venture_into_dungeon',
  // Council / Secret council — resume must re-run vote + follow-on votes_received effects.
  'vote',
  'each_player_choose_then_destroy_rest',
  'secret_opponent_choice_damage',
  'may_cast_from_among',
  'may_reveal_hand_then_win_if_own_named_in_zones',
  'unless_pays_mana',
  'unless_pays_life',
  'pay_energy',
]);

export function applyOracleIRStepsToGameStateImpl(
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions,
  recurse: RecurseExecutor
): OracleIRExecutionResult {
  type StepOutcomeKind = 'applied' | 'choice_required' | 'impossible' | 'unsupported';

  const log: string[] = [];
  const appliedSteps: OracleEffectStep[] = [];
  const skippedSteps: OracleEffectStep[] = [];
  const localAutomationGaps: OracleAutomationGap[] = [];
  const automationGaps: OracleAutomationGap[] = [];
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  let currentCtx: OracleIRExecutionContext & {
    readonly lastRevealedCards?: readonly unknown[];
    readonly lastGreatestDiscardedCardCount?: number;
    readonly lastCreatedTokenIds?: readonly string[];
  } = ctx;
  let lastRevealedCardCount = 0;
  let lastDiscardedCardCount = 0;
  let lastGreatestDiscardedCardCount = Math.max(0, Number((ctx as any).lastGreatestDiscardedCardCount) || 0);
  let lastDiscardedCards: any[] = Array.isArray(ctx.lastDiscardedCards) ? [...ctx.lastDiscardedCards] : [];
  let lastExiledCardCount = 0;
  let lastExiledCards: any[] = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
  let lastGrantedGraveyardCards: any[] = [];
  let lastGrantedGraveyardPermissionIds: string[] = [];
  let lastMovedCards: any[] = Array.isArray(ctx.lastMovedCards) ? [...ctx.lastMovedCards] : [];
  let lastMilledCards: any[] = Array.isArray((ctx as any).lastMilledCards)
    ? [...((ctx as any).lastMilledCards as any[])]
    : [];
  let lastMovedBattlefieldPermanentIds: string[] = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
    ? [...ctx.lastMovedBattlefieldPermanentIds]
    : [];
  let lastCreatedTokenIds: string[] = Array.isArray((ctx as any).lastCreatedTokenIds)
    ? (ctx as any).lastCreatedTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  let lastGoadedCreatures: BattlefieldPermanent[] = [];
  let lastSacrificedCreaturesPowerTotal = 0;
  let lastSacrificedPermanents: LastKnownPermanentSnapshot[] = Array.isArray((ctx as any).lastSacrificedPermanents)
    ? [...((ctx as any).lastSacrificedPermanents as LastKnownPermanentSnapshot[])]
    : [];
  let lastExcessDamageDealtThisWay = 0;
  let lastScryLookedAtCount = 0;
  let lastTappedMatchingPermanentCount = Math.max(0, Number(ctx.lastTappedMatchingPermanentCount) || 0);
  let lastReferenceAmount = Number.isFinite(Number(ctx.referenceAmount))
    ? Math.max(0, Number(ctx.referenceAmount) || 0)
    : Number.isFinite(Number((ctx as any).lastReferenceAmount))
      ? Math.max(0, Number((ctx as any).lastReferenceAmount) || 0)
      : undefined;
  let lastMovedCountByPlayer: Readonly<Record<string, number>> | undefined = (ctx as any).lastMovedCountByPlayer;
  let lastClashWon = typeof ctx.lastClashWon === 'boolean' ? ctx.lastClashWon : undefined;
  let lastCollectedEvidence = typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : undefined;
  let lastSetInMotionScheme = (ctx as any).lastSetInMotionScheme;
  let lastStepOutcome: {
    readonly kind: StepOutcomeKind;
    readonly stepKind: OracleEffectStep['kind'];
    readonly count?: number;
  } | null = null;
  let lastActionOutcome: {
    readonly kind: StepOutcomeKind;
    readonly stepKind: OracleEffectStep['kind'];
    readonly count?: number;
  } | null = null;
  let lastConditionalEvaluation: boolean | null = null;
  let replayMutations: OracleIRReplayMutation[] = [];
  // A conditional whose condition was false contributes no effect, so it is only worth recording in
  // `appliedSteps` when nothing else in the sequence fired - it is then the sole record that the
  // clause was evaluated. Once any conditional does produce effects these markers are dropped.
  const falseConditionalMarkers = new Set<OracleEffectStep>();
  let anyConditionalProducedSteps = false;

  let nextState = Array.isArray(state.players) ? state : { ...state, players: [] };
  const pendingOptionalSteps: OracleEffectStep[] = [];
  let haltedForPlayerChoice = false;
  let pendingContinuationSteps: OracleEffectStep[] | undefined;
  let automationGapSequence = 0;
  const stepLedger: StepLedger = acquireStepLedgerForExecution(ctx);
  const appliedStepKinds = new Map<number, string>(
    ctx.appliedStepKinds ? [...ctx.appliedStepKinds] : [],
  );

  const absorbExecutionReplayMutations = (execution: { readonly replayMutations?: readonly OracleIRReplayMutation[] }): void => {
    if (Array.isArray(execution.replayMutations) && execution.replayMutations.length > 0) {
      replayMutations = mergeReplayMutations(replayMutations, execution.replayMutations);
    }
  };

  const setLastStepOutcome = (step: OracleEffectStep, kind: StepOutcomeKind, metadata?: { readonly count?: number }): void => {
    lastStepOutcome = { kind, stepKind: step.kind, ...(metadata?.count !== undefined ? { count: metadata.count } : {}) };
    if (kind === 'applied' || kind === 'choice_required' || kind === 'impossible') {
      lastActionOutcome = { kind, stepKind: step.kind, ...(metadata?.count !== undefined ? { count: metadata.count } : {}) };
      if (typeof metadata?.count === 'number' && Number.isFinite(metadata.count)) {
        lastReferenceAmount = Math.max(0, Number(metadata.count) || 0);
      }
    }
  };

  const mergeNestedExecutionOutcome = (nestedResult: {
    readonly lastStepOutcome?: {
      readonly kind: StepOutcomeKind;
      readonly stepKind: OracleEffectStep['kind'];
      readonly count?: number;
    } | null;
  }): void => {
    if (!nestedResult.lastStepOutcome) return;
    lastStepOutcome = nestedResult.lastStepOutcome;
    const kind = nestedResult.lastStepOutcome.kind;
    if (kind === 'applied' || kind === 'choice_required' || kind === 'impossible') {
      lastActionOutcome = nestedResult.lastStepOutcome;
    }
  };

  const inferSkippedStepOutcome = (
    reasonCode: string,
    skipOptions: {
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly persist?: boolean;
    } | undefined
  ): StepOutcomeKind => {
    if (reasonCode === 'impossible_action' || skipOptions?.classification === 'invalid_input') return 'impossible';
    if (reasonCode === 'player_choice_required' || skipOptions?.classification === 'player_choice') return 'choice_required';
    return 'unsupported';
  };

  const recordSkippedStep = (
    step: OracleEffectStep,
    message: string,
    reasonCode: string,
    skipOptions: {
      readonly pending?: boolean;
      readonly classification?: 'unsupported' | 'ambiguous' | 'player_choice' | 'invalid_input';
      readonly metadata?: Record<string, string | number | boolean | null | readonly string[]>;
      readonly persist?: boolean;
    } = {}
  ): void => {
    setLastStepOutcome(step, inferSkippedStepOutcome(reasonCode, skipOptions));
    skippedSteps.push(step);
    if (skipOptions.pending) {
      pendingOptionalSteps.push(step);
    }
    log.push(message);

    if (skipOptions.persist === false) {
      return;
    }

    const gap = createOracleAutomationGapRecord({
      state: nextState,
      ctx: currentCtx,
      step,
      reasonCode,
      message,
      sequence: ++automationGapSequence,
      classification: skipOptions.classification,
      metadata: skipOptions.metadata,
    });
    localAutomationGaps.push(gap);
    automationGaps.push(gap);

    if (
      options.haltOnPlayerChoiceRequired === true &&
      reasonCode === 'player_choice_required' &&
      HALT_ON_PLAYER_CHOICE_STEP_KINDS.has(String(step.kind || ''))
    ) {
      haltedForPlayerChoice = true;
    }
  };

  const applyHandledStepResult = (
    step: OracleEffectStep,
    result: any,
    onApplied?: (appliedResult: any) => void
  ): boolean => {
    if ('message' in result) {
      if (result.state) {
        nextState = result.state;
      }
      const observationFlushed = flushObservationLedgerFromChoiceDeferredResult({
        ledger: stepLedger,
        appliedStepKinds,
        stepIndex: Number(currentCtx.currentStepIndex ?? 0),
        step,
        controllerId: String(controllerId),
        result,
      });
      if (observationFlushed) {
        if (Array.isArray(result.lastMovedCards) && result.lastMovedCards.length > 0) {
          lastMovedCards = [...result.lastMovedCards];
        }
        if (typeof result.lastScryLookedAtCount === 'number') {
          lastScryLookedAtCount = Math.max(0, Number(result.lastScryLookedAtCount) || 0);
        }
        currentCtx = {
          ...currentCtx,
          stepLedger: snapshotStepLedger(stepLedger),
          appliedStepKinds: new Map(appliedStepKinds),
          ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
        };
      }
      recordSkippedStep(step, result.message, result.reason, result.options);
      return false;
    }

    nextState = result.state;
    if (currentCtx.transitionHaltState?.halted) {
      recordSkippedStep(
        step,
        'Deferred replacement effect choice required',
        'player_choice_required',
        { classification: 'player_choice' },
      );
      return false;
    }
    if (typeof result?.count === 'number' && Number.isFinite(result.count)) {
      setLastStepOutcome(step, 'applied', { count: result.count });
    } else {
      setLastStepOutcome(step, 'applied');
    }
    if (result?.lastMovedCountByPlayer && typeof result.lastMovedCountByPlayer === 'object') {
      lastMovedCountByPlayer = { ...result.lastMovedCountByPlayer };
    }
    currentCtx = {
      ...currentCtx,
      ...(typeof lastReferenceAmount === 'number' && Number.isFinite(lastReferenceAmount)
        ? { referenceAmount: lastReferenceAmount }
        : {}),
      ...(lastMovedCountByPlayer ? { lastMovedCountByPlayer } : {}),
    };
    const sanitizedCarryOver = sanitizeBridgedStepCarryOver(result);
    const milledForFollowUp = Array.isArray((result as any).lastMilledCards)
      ? ((result as any).lastMilledCards as any[])
      : [];
    const movedForFollowUp = Array.isArray(result.lastMovedCards)
      ? (result.lastMovedCards as any[])
      : [];
    const revealedForFollowUp = Array.isArray((result as any).lastRevealedCards)
      ? ((result as any).lastRevealedCards as any[])
      : [];
    const appliedPayload = {
      ...sanitizedCarryOver,
      ...(milledForFollowUp.length > 0 ? { lastMilledCards: milledForFollowUp } : {}),
      ...(movedForFollowUp.length > 0 ? { lastMovedCards: movedForFollowUp } : {}),
      ...(revealedForFollowUp.length > 0 ? { lastRevealedCards: revealedForFollowUp } : {}),
    };
    if (movedForFollowUp.length > 0) {
      lastMovedCards = movedForFollowUp;
    }
    onApplied?.(
      lastMovedCountByPlayer
        ? { ...appliedPayload, lastMovedCountByPlayer }
        : appliedPayload,
    );
    trackAppliedStepKind(appliedStepKinds, Number(currentCtx.currentStepIndex ?? 0), step);
    if (!result.skipLedgerFlush) {
      flushStepLedgerFromAppliedResult({
        ledger: stepLedger,
        appliedStepKinds,
        stepIndex: Number(currentCtx.currentStepIndex ?? 0),
        step,
        controllerId: String(controllerId),
        appliedResult: result,
      });
    }
    currentCtx = {
      ...currentCtx,
      stepLedger: snapshotStepLedger(stepLedger),
      appliedStepKinds: new Map(appliedStepKinds),
      ...(lastMovedCountByPlayer ? { lastMovedCountByPlayer } : {}),
      ...(movedForFollowUp.length > 0 ? { lastMovedCards: movedForFollowUp } : {}),
      ...(revealedForFollowUp.length > 0 ? { lastRevealedCards: revealedForFollowUp } : {}),
    };
    log.push(...result.log);
    appliedSteps.push(step);
    replayMutations = mergeReplayMutations(
      replayMutations,
      collectReplayMutationsFromAppliedStep(step, result, nextState, currentCtx),
    );
    return true;
  };

  const applyModifyPtStepResult = (
    step: OracleEffectStep,
    result: any
  ): boolean => {
    if (result.kind === 'recorded_skip') {
      recordSkippedStep(step, result.message, result.reason);
      return false;
    }
    if (result.kind === 'unrecorded_skip') {
      setLastStepOutcome(step, 'unsupported');
      skippedSteps.push(step);
      log.push(result.log);
      return false;
    }
    if (result.kind !== 'applied') {
      return false;
    }

    nextState = result.state;
    setLastStepOutcome(step, 'applied');
    trackAppliedStepKind(appliedStepKinds, Number(currentCtx.currentStepIndex ?? 0), step);
    currentCtx = {
      ...currentCtx,
      stepLedger: snapshotStepLedger(stepLedger),
      appliedStepKinds: new Map(appliedStepKinds),
    };
    log.push(...result.log);
    appliedSteps.push(step);
    return true;
  };

  let familyStepIndex = 0;
  const loopCtx: MainLoopStepFamilyCtx = {
    get nextState() { return nextState; },
    set nextState(value) { nextState = value; },
    get currentCtx() { return currentCtx; },
    set currentCtx(value) { currentCtx = value; },
    get lastRevealedCardCount() { return lastRevealedCardCount; },
    set lastRevealedCardCount(value) { lastRevealedCardCount = value; },
    get lastDiscardedCardCount() { return lastDiscardedCardCount; },
    set lastDiscardedCardCount(value) { lastDiscardedCardCount = value; },
    get lastGreatestDiscardedCardCount() { return lastGreatestDiscardedCardCount; },
    set lastGreatestDiscardedCardCount(value) { lastGreatestDiscardedCardCount = value; },
    get lastDiscardedCards() { return lastDiscardedCards; },
    set lastDiscardedCards(value) { lastDiscardedCards = value; },
    get lastExiledCardCount() { return lastExiledCardCount; },
    set lastExiledCardCount(value) { lastExiledCardCount = value; },
    get lastExiledCards() { return lastExiledCards; },
    set lastExiledCards(value) { lastExiledCards = value; },
    get lastGrantedGraveyardCards() { return lastGrantedGraveyardCards; },
    set lastGrantedGraveyardCards(value) { lastGrantedGraveyardCards = value; },
    get lastGrantedGraveyardPermissionIds() { return lastGrantedGraveyardPermissionIds; },
    set lastGrantedGraveyardPermissionIds(value) { lastGrantedGraveyardPermissionIds = value; },
    get lastMovedCards() { return lastMovedCards; },
    set lastMovedCards(value) { lastMovedCards = value; },
    get lastMilledCards() { return lastMilledCards; },
    set lastMilledCards(value) { lastMilledCards = value; },
    get lastMovedBattlefieldPermanentIds() { return lastMovedBattlefieldPermanentIds; },
    set lastMovedBattlefieldPermanentIds(value) { lastMovedBattlefieldPermanentIds = value; },
    get lastCreatedTokenIds() { return lastCreatedTokenIds; },
    set lastCreatedTokenIds(value) { lastCreatedTokenIds = value; },
    get lastGoadedCreatures() { return lastGoadedCreatures; },
    set lastGoadedCreatures(value) { lastGoadedCreatures = value; },
    get lastSacrificedCreaturesPowerTotal() { return lastSacrificedCreaturesPowerTotal; },
    set lastSacrificedCreaturesPowerTotal(value) { lastSacrificedCreaturesPowerTotal = value; },
    get lastSacrificedPermanents() { return lastSacrificedPermanents; },
    set lastSacrificedPermanents(value) { lastSacrificedPermanents = value; },
    get lastExcessDamageDealtThisWay() { return lastExcessDamageDealtThisWay; },
    set lastExcessDamageDealtThisWay(value) { lastExcessDamageDealtThisWay = value; },
    get lastScryLookedAtCount() { return lastScryLookedAtCount; },
    set lastScryLookedAtCount(value) { lastScryLookedAtCount = value; },
    get lastTappedMatchingPermanentCount() { return lastTappedMatchingPermanentCount; },
    set lastTappedMatchingPermanentCount(value) { lastTappedMatchingPermanentCount = value; },
    get lastReferenceAmount() { return lastReferenceAmount; },
    set lastReferenceAmount(value) { lastReferenceAmount = value; },
    get lastMovedCountByPlayer() { return lastMovedCountByPlayer; },
    set lastMovedCountByPlayer(value) { lastMovedCountByPlayer = value; },
    get lastClashWon() { return lastClashWon; },
    set lastClashWon(value) { lastClashWon = value; },
    get lastCollectedEvidence() { return lastCollectedEvidence; },
    set lastCollectedEvidence(value) { lastCollectedEvidence = value; },
    get lastSetInMotionScheme() { return lastSetInMotionScheme; },
    set lastSetInMotionScheme(value) { lastSetInMotionScheme = value; },
    get lastStepOutcome() { return lastStepOutcome; },
    set lastStepOutcome(value) { lastStepOutcome = value; },
    get lastActionOutcome() { return lastActionOutcome; },
    set lastActionOutcome(value) { lastActionOutcome = value; },
    get lastConditionalEvaluation() { return lastConditionalEvaluation; },
    set lastConditionalEvaluation(value) { lastConditionalEvaluation = value; },
    get replayMutations() { return replayMutations; },
    set replayMutations(value) { replayMutations = value; },
    get anyConditionalProducedSteps() { return anyConditionalProducedSteps; },
    set anyConditionalProducedSteps(value) { anyConditionalProducedSteps = value; },
    get haltedForPlayerChoice() { return haltedForPlayerChoice; },
    set haltedForPlayerChoice(value) { haltedForPlayerChoice = value; },
    get pendingContinuationSteps() { return pendingContinuationSteps; },
    set pendingContinuationSteps(value) { pendingContinuationSteps = value; },
    get automationGapSequence() { return automationGapSequence; },
    set automationGapSequence(value) { automationGapSequence = value; },
    get controllerId() { return controllerId; },
    get log() { return log; },
    get appliedSteps() { return appliedSteps; },
    get skippedSteps() { return skippedSteps; },
    get localAutomationGaps() { return localAutomationGaps; },
    get automationGaps() { return automationGaps; },
    get pendingOptionalSteps() { return pendingOptionalSteps; },
    get falseConditionalMarkers() { return falseConditionalMarkers; },
    get stepLedger() { return stepLedger; },
    get appliedStepKinds() { return appliedStepKinds; },
    get recurse() { return recurse; },
    get options() { return options; },
    get steps() { return steps; },
    get stepIndex() { return familyStepIndex; },
    applyHandledStepResult: (step, result, onApplied) => applyHandledStepResult(step, result, onApplied),
    recordSkippedStep: (step, message, reasonCode, skipOptions) => recordSkippedStep(step, message, reasonCode, skipOptions),
    setLastStepOutcome: (step, kind, metadata) => setLastStepOutcome(step, kind, metadata),
    applyModifyPtStepResult: (step, result) => applyModifyPtStepResult(step, result),
    absorbExecutionReplayMutations,
    mergeNestedExecutionOutcome,
  };

  const baseStepIndex = Number.isFinite(Number(ctx.currentStepIndex)) && Number(ctx.currentStepIndex) >= 0
    ? Number(ctx.currentStepIndex)
    : 0;

  for (let relativeIndex = 0; relativeIndex < steps.length; relativeIndex += 1) {
    const step = steps[relativeIndex];
    const stepIndex = baseStepIndex + relativeIndex;
    familyStepIndex = stepIndex;
    currentCtx = {
      ...currentCtx,
      currentStepIndex: stepIndex,
      stepLedger: snapshotStepLedger(stepLedger),
      appliedStepKinds: new Map(appliedStepKinds),
      ...(lastMovedCountByPlayer ? { lastMovedCountByPlayer } : {}),
    };
    if (step.kind !== 'conditional') {
      lastConditionalEvaluation = null;
    }
    const isOptional = Boolean((step as any).optional);
    const optionalLookLibraryStep =
      isOptional &&
      currentCtx.interactivePlayerChoices === true &&
      (step.kind === 'look_choose_from_top' || step.kind === 'look_select_top');
    const optionalAnyNumberDiscardStep =
      isOptional &&
      currentCtx.interactivePlayerChoices === true &&
      step.kind === 'discard' &&
      (step as any).amount?.kind === 'any_number';
    const optionalGrantGraveyardDuringResolutionStep =
      isOptional &&
      step.kind === 'grant_graveyard_permission' &&
      String((step as any).duration || '') === 'during_resolution' &&
      currentCtx.interactivePlayerChoices === true &&
      currentCtx.deferOptionalGrantGraveyardChoices === true;
    const optionalPerPlayerChoiceStep =
      isOptional &&
      currentCtx.interactivePlayerChoices === true &&
      currentCtx.deferOptionalPerPlayerChoices === true &&
      isPerPlayerOptionalOracleStep(step);
    if (optionalGrantGraveyardDuringResolutionStep) {
      recordSkippedStep(
        step,
        `Skipped optional step (needs player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      continue;
    }
    if (optionalPerPlayerChoiceStep) {
      recordSkippedStep(
        step,
        `Skipped optional step (needs per-player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      continue;
    }
    if (isOptional && !options.allowOptional && !optionalLookLibraryStep && !optionalAnyNumberDiscardStep) {
      if (options.declineOptionalSteps) {
        log.push(`Declined optional step: ${(step as any).raw ?? step.kind}`);
        setLastStepOutcome(step, 'choice_required');
        continue;
      }
      recordSkippedStep(
        step,
        `Skipped optional step (needs player choice): ${(step as any).raw ?? step.kind}`,
        'optional_step_requires_player_choice',
        {
          pending: true,
          classification: 'player_choice',
        }
      );
      pendingContinuationSteps = steps.slice(relativeIndex + 1) as OracleEffectStep[];
      break;
    }

    switch (step.kind) {
      case 'exile_top':
      case 'impulse_exile_top':
      case 'modify_exile_permissions':
      case 'grant_exile_permission':
      case 'grant_future_spell_effect':
      case 'goad':
      case 'detain':
      case 'cant_attack':
      case 'cant_block':
      case 'force_block':
      case 'cant_activate_abilities':
      case 'exert':
      case 'airbend':
      case 'earthbend':
      case 'animate_permanent':
      case 'skip_next_untap':
      case 'optional_untap_choice': {
        tryApplyMainLoopExileRestrictionSteps(loopCtx, step);
        break;
      }
      case 'flip_coin':
      case 'flip_coin_life_stakes':
      case 'roll_die':
      case 'die_roll_results':
      case 'draw':
      case 'win_game':
      case 'lose_game':
      case 'clash':
      case 'collect_evidence':
      case 'learn':
      case 'open_attraction':
      case 'roll_visit_attractions':
      case 'take_initiative':
      case 'become_monarch':
      case 'venture_into_dungeon':
      case 'planeswalk':
      case 'assemble':
      case 'regenerate':
      case 'abandon_scheme':
      case 'set_in_motion': {
        tryApplyMainLoopCoinDieDrawSteps(loopCtx, step);
        break;
      }
      case 'search_library':
      case 'exile_named_cards_from_zones':
      case 'shuffle_library':
      case 'prevent_library_search':
      case 'skip_next_draw_step':
      case 'skip_next_turn':
      case 'end_turn':
      case 'end_combat_phase':
      case 'gain_control':
      case 'exchange_control':
      case 'take_extra_turn':
      case 'add_extra_combat':
      case 'change_target':
      case 'grant_graveyard_permission':
      case 'grant_graveyard_keyword_ability':
      case 'modify_graveyard_permissions':
      case 'modify_token_creation':
      case 'grant_static_ability':
      case 'add_mana':
      case 'shuffle_zones_into_library':
      case 'choose_pile':
      case 'put_sticker':
      case 'become_aura':
      case 'assign_no_combat_damage':
      case 'retain_mana':
      case 'pay_mana':
      case 'join_forces':
      case 'tempting_offer':
      case 'choose_opponent':
      case 'choose_color':
      case 'choose_number':
      case 'choose_creature_type':
      case 'choose_basic_land_type':
      case 'choose_card_name': {
        tryApplyMainLoopLibraryTurnControlSteps(loopCtx, step);
        break;
      }
      case 'player_choice':
      case 'choose_target_creature':
      case 'create_emblem':
      case 'proliferate':
      case 'redistribute_life_totals':
      case 'investigate':
      case 'blight':
      case 'populate':
      case 'paradigm':
      case 'ring_tempts_you':
      case 'time_travel':
      case 'suspect':
      case 'become_renowned':
      case 'gain_class_level':
      case 'monstrosity':
      case 'turn_face_up':
      case 'turn_face_down':
      case 'copy_permanent':
      case 'scry':
      case 'surveil':
      case 'fateseal':
      case 'vote':
      case 'look_top':
      case 'reveal_top':
      case 'look_select_top':
      case 'look_choose_from_top':
      case 'explore':
      case 'manifest_dread':
      case 'connive':
      case 'put_on_bottom': {
        tryApplyMainLoopChoiceKeywordLookSteps(loopCtx, step);
        break;
      }
      case 'each_player_choose_then_destroy_rest':
      case 'secret_opponent_choice_damage':
      case 'may_cast_from_among':
      case 'may_reveal_hand_then_win_if_own_named_in_zones': {
        tryApplyMainLoopChoiceFamilySteps(loopCtx, step);
        break;
      }
      case 'mill':
      case 'modify_pt':
      case 'set_base_pt':
      case 'switch_power_toughness':
      case 'modify_pt_per_revealed':
      case 'discard':
      case 'reveal_hand':
      case 'look_hand':
      case 'register_lose_game_replacement':
      case 'gain_life':
      case 'lose_life':
      case 'add_player_counter':
      case 'pay_energy':
      case 'double_player_counters':
      case 'deal_damage':
      case 'prevent_damage':
      case 'damage_cant_be_prevented':
      case 'remove_marked_damage':
      case 'tap_or_untap':
      case 'remove_from_combat':
      case 'phase_out':
      case 'tap_matching_permanents':
      case 'remove_counter':
      case 'move_counters':
      case 'add_counter':
      case 'add_types':
      case 'set_basic_land_type':
      case 'double_counters':
      case 'move_zone':
      case 'attach':
      case 'create_token':
      case 'grant_temporary_dies_trigger':
      case 'grant_temporary_etb_trigger':
      case 'grant_temporary_ability':
      case 'grant_leave_battlefield_replacement': {
        tryApplyMainLoopMillPtTokenSteps(loopCtx, step);
        break;
      }
      case 'copy_chapter_ability':
      case 'copy_spell':
      case 'schedule_delayed_trigger':
      case 'destroy': {
        tryApplyMainLoopCopyDestroySteps(loopCtx, step);
        break;
      }
      case 'counter_spell':
      case 'exile':
      case 'separate_into_piles':
      case 'library_chaos_exchange':
      case 'repeated_zone_draft':
      case 'sacrifice':
      case 'schedule_delayed_battlefield_action':
      case 'choose_mode':
      case 'conditional':
      case 'unless_pays_life':
      case 'unless_discards':
      case 'grant_next_spell_cost_reduction':
      case 'any_player_may':
      case 'unless_sacrifices':
      case 'unless_pays_mana':
      case 'modify_damage':
      default: {
        tryApplyMainLoopLateSteps(loopCtx, step);
        break;
      }
    }

    if (haltedForPlayerChoice) {
      pendingContinuationSteps = steps.slice(relativeIndex + 1) as OracleEffectStep[];
      break;
    }
  }

  nextState = appendOracleAutomationGapRecords(nextState, localAutomationGaps);
  if (stepLedger.size > 0) {
    (nextState as any).oracleIrStepLedger = snapshotStepLedger(stepLedger);
  }
  if (appliedStepKinds.size > 0) {
    (nextState as any).oracleIrAppliedStepKinds = new Map(appliedStepKinds);
  }

  return {
    state: nextState,
    log,
    appliedSteps:
      anyConditionalProducedSteps && falseConditionalMarkers.size > 0
        ? appliedSteps.filter((entry) => !falseConditionalMarkers.has(entry))
        : appliedSteps,
    skippedSteps,
    automationGaps,
    pendingOptionalSteps,
    ...(pendingContinuationSteps ? { pendingContinuationSteps } : {}),
    lastStepOutcome,
    ...(lastMovedCards.length > 0 ? { lastMovedCards } : {}),
    ...(lastMilledCards.length > 0 ? { lastMilledCards } : {}),
    ...(lastRevealedCardCount > 0 ? { lastRevealedCardCount } : {}),
    ...(lastMovedCountByPlayer ? { lastMovedCountByPlayer } : {}),
    ...(replayMutations.length > 0 ? { replayMutations } : {}),
  };
}
