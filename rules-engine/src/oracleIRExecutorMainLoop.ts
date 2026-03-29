import type { GameState, PlayerID, BattlefieldPermanent, OracleAutomationGap } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { parseOracleTextToIR } from './oracleIRParser';
import {
  appendOracleAutomationGapRecords,
  createOracleAutomationGapRecord,
} from './oracleIRAutomationGaps';
import {
  applyConditionalReferenceAmount,
  evaluateConditionalWrapperCondition,
  resolveConditionalReferenceAmount,
} from './oracleIRExecutorConditionalStepSupport';
import {
  getCopiedChapterAbilityReplaySteps,
  getCopiedSpellReplaySteps,
  getThisSpellReplayStepsFromState,
  payCopiedSpellCastCost,
  prepareCopiedSpellExecutionContext,
  resolveCopySpellCount,
  resolveCopiedSpellSourceCards,
} from './oracleIRExecutorCopySpellSupport';
import { performDieRoll } from './dieRoll';
import { applyAttachStep } from './oracleIRExecutorAttachStepHandlers';
import { applyChooseModeStep } from './oracleIRExecutorChooseModeStepHandlers';
import {
  applyAddCounterStep,
  applyAddTypesStep,
  applyDoubleCountersStep,
  applyDestroyStep,
  applyDetainStep,
  applyExertStep,
  applyExileStep,
  applyRegenerateStep,
  applyGrantLeaveBattlefieldReplacementStep,
  applyGrantTemporaryAbilityStep,
  applyGrantTemporaryDiesTriggerStep,
  applyMonstrosityStep,
  applyBecomeRenownedStep,
  applyCopyPermanentStep,
  applyRemoveCounterStep,
  applySacrificeStep,
  applyScheduleDelayedBattlefieldActionStep,
  applyScheduleDelayedTriggerStep,
  applySuspectStep,
  applyTapMatchingPermanentsStep,
  applyTapOrUntapStep,
  applyTurnFaceUpStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import { applyDealDamageStep, applyPreventDamageStep } from './oracleIRExecutorDamageStepHandlers';
import {
  applyExileTopStep,
  applyGrantExilePermissionStep,
  applyImpulseExileTopStep,
  applyModifyExilePermissionsStep,
} from './oracleIRExecutorExileStepHandlers';
import { applyGoadStep } from './oracleIRExecutorGoadStepHandlers';
import {
  applyInvestigateStep,
  applyPopulateStep,
  applyProliferateStep,
  applyRingTemptsYouStep,
  applyTimeTravelStep,
} from './oracleIRExecutorKeywordStepHandlers';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import { evaluateModifyPtCondition } from './oracleIRExecutorModifyPtCondition';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  applyModifyPtPerRevealedStep,
  applySetBasePtStep,
  applyModifyPtStep,
} from './oracleIRExecutorModifyPtStepHandlers';
import { applyMoveZoneStep } from './oracleIRExecutorMoveZoneStepHandlers';
import {
  applyAddManaStep,
  applyAddPlayerCounterStep,
  applyAssembleStep,
  applyBecomeMonarchStep,
  applyAbandonSchemeStep,
  applyClashStep,
  applyCollectEvidenceStep,
  applyConniveStep,
  applyCreateEmblemStep,
  applyDiscardStep,
  applyDrawStep,
  applyExploreStep,
  applyFatesealStep,
  applyLearnStep,
  applyManifestDreadStep,
  applyGrantGraveyardPermissionStep,
  applyModifyGraveyardPermissionsStep,
  evaluateUnlessPaysLifeStep,
  applyGainLifeStep,
  applyLoseLifeStep,
  applyLookSelectTopStep,
  applyMillStep,
  applyOpenAttractionStep,
  applyPayManaStep,
  applyPlaneswalkStep,
  applyRollVisitAttractionsStep,
  applyScryStep,
  applySearchLibraryStep,
  applySetInMotionStep,
  applySurveilStep,
  applyTakeInitiativeStep,
  applyVentureIntoDungeonStep,
  applyVoteStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { applyCreateTokenStep } from './oracleIRExecutorTokenStepHandlers';
import { applySkipNextDrawStep } from './oracleIRExecutorTurnStepHandlers';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionOptions,
  OracleIRExecutionResult,
} from './oracleIRExecutionTypes';

type RecurseExecutor = (
  state: GameState,
  steps: readonly OracleEffectStep[],
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions
) => OracleIRExecutionResult;

function getLastDieRollResultForPlayer(state: GameState, playerId: PlayerID): number | null {
  const playerRoll = (state as any)?.lastDieRollByPlayer?.[playerId];
  if (typeof playerRoll === 'number' && Number.isFinite(playerRoll)) return playerRoll;
  if (Number.isFinite(Number(playerRoll?.result))) return Number(playerRoll.result);

  const globalLast = (state as any)?.lastDieRoll;
  if (String(globalLast?.playerId || '').trim() === String(playerId || '').trim() && Number.isFinite(Number(globalLast?.result))) {
    return Number(globalLast.result);
  }

  return null;
}

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
  let currentCtx = ctx;
  let lastRevealedCardCount = 0;
  let lastDiscardedCardCount = 0;
  let lastDiscardedCards: any[] = Array.isArray(ctx.lastDiscardedCards) ? [...ctx.lastDiscardedCards] : [];
  let lastExiledCardCount = 0;
  let lastExiledCards: any[] = Array.isArray(ctx.lastExiledCards) ? [...ctx.lastExiledCards] : [];
  let lastGrantedGraveyardCards: any[] = [];
  let lastMovedCards: any[] = Array.isArray(ctx.lastMovedCards) ? [...ctx.lastMovedCards] : [];
  let lastMovedBattlefieldPermanentIds: string[] = Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
    ? [...ctx.lastMovedBattlefieldPermanentIds]
    : [];
  let lastCreatedTokenIds: string[] = [];
  let lastGoadedCreatures: BattlefieldPermanent[] = [];
  let lastSacrificedCreaturesPowerTotal = 0;
  let lastSacrificedPermanents: LastKnownPermanentSnapshot[] = [];
  let lastExcessDamageDealtThisWay = 0;
  let lastScryLookedAtCount = 0;
  let lastTappedMatchingPermanentCount = Math.max(0, Number(ctx.lastTappedMatchingPermanentCount) || 0);
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

  let nextState = state;
  const pendingOptionalSteps: OracleEffectStep[] = [];
  let automationGapSequence = 0;

  const setLastStepOutcome = (step: OracleEffectStep, kind: StepOutcomeKind, metadata?: { readonly count?: number }): void => {
    lastStepOutcome = { kind, stepKind: step.kind, ...(metadata?.count !== undefined ? { count: metadata.count } : {}) };
    if (kind === 'applied' || kind === 'choice_required' || kind === 'impossible') {
      lastActionOutcome = { kind, stepKind: step.kind, ...(metadata?.count !== undefined ? { count: metadata.count } : {}) };
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
  };

  const applyHandledStepResult = (
    step: OracleEffectStep,
    result: any,
    onApplied?: (appliedResult: any) => void
  ): boolean => {
    if ('message' in result) {
      recordSkippedStep(step, result.message, result.reason, result.options);
      return false;
    }

    nextState = result.state;
    setLastStepOutcome(step, 'applied');
    onApplied?.(result);
    log.push(...result.log);
    appliedSteps.push(step);
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
    log.push(...result.log);
    appliedSteps.push(step);
    return true;
  };

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const step = steps[stepIndex];
    if (step.kind !== 'conditional') {
      lastConditionalEvaluation = null;
    }
    const isOptional = Boolean((step as any).optional);
    if (isOptional && !options.allowOptional) {
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

    switch (step.kind) {
      case 'exile_top': {
        const result = applyExileTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
          currentCtx = { ...currentCtx, lastExiledCards };
        });
        break;
      }
      case 'impulse_exile_top': {
        const result = applyImpulseExileTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExiledCardCount = Math.max(0, Number(appliedResult.lastExiledCardCount) || 0);
          lastExiledCards = [...appliedResult.lastExiledCards];
          currentCtx = { ...currentCtx, lastExiledCards };
        });
        break;
      }
      case 'modify_exile_permissions': {
        const result = applyModifyExilePermissionsStep(nextState, step, { lastExiledCards }, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_exile_permission': {
        const result = applyGrantExilePermissionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'goad': {
        const result = applyGoadStep(nextState, step, currentCtx, controllerId);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGoadedCreatures = [...appliedResult.lastGoadedCreatures];
        });
        break;
      }
      case 'detain': {
        const result = applyDetainStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'exert': {
        const result = applyExertStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'roll_die': {
        const players = step.who.kind === 'you' && controllerId ? [controllerId] : [];
        if (players.length !== 1) {
          recordSkippedStep(
            step,
            `Skipped roll die step (unsupported player selector): ${step.raw}`,
            'unsupported_player_selector',
            {
              classification: 'ambiguous',
            }
          );
          break;
        }

        const forcedResult = Number(currentCtx.dieRollResult);
        const rolled =
          Number.isFinite(forcedResult) && forcedResult >= 1 && forcedResult <= step.sides
            ? { result: forcedResult }
            : performDieRoll(players[0], step.sides);
        const timestamp = Date.now();
        const stateAny: any = nextState as any;
        stateAny.lastDieRoll = {
          playerId: players[0],
          sides: step.sides,
          result: rolled.result,
          timestamp,
        };
        stateAny.lastDieRollByPlayer = stateAny.lastDieRollByPlayer || {};
        stateAny.lastDieRollByPlayer[players[0]] = {
          sides: step.sides,
          result: rolled.result,
          timestamp,
        };
        stateAny.dieRollsThisTurn = stateAny.dieRollsThisTurn || {};
        stateAny.dieRollsThisTurn[players[0]] = Array.isArray(stateAny.dieRollsThisTurn[players[0]])
          ? [...stateAny.dieRollsThisTurn[players[0]], { sides: step.sides, result: rolled.result, timestamp }]
          : [{ sides: step.sides, result: rolled.result, timestamp }];
        nextState = stateAny as GameState;
        setLastStepOutcome(step, 'applied');
        log.push(`[oracle-ir] ${players[0]} rolled d${step.sides}: ${rolled.result}`);
        appliedSteps.push(step);
        break;
      }
      case 'die_roll_results': {
        const players = step.who.kind === 'you' && controllerId ? [controllerId] : [];
        if (players.length !== 1) {
          recordSkippedStep(
            step,
            `Skipped die-roll result table (unsupported player selector): ${step.raw}`,
            'unsupported_player_selector',
            {
              classification: 'ambiguous',
            }
          );
          break;
        }

        const rolled = getLastDieRollResultForPlayer(nextState, players[0]);
        if (!Number.isFinite(rolled)) {
          recordSkippedStep(
            step,
            `Skipped die-roll result table (no die roll result available): ${step.raw}`,
            'failed_to_apply',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const band = step.results.find(resultBand => rolled >= resultBand.min && rolled <= resultBand.max);
        if (!band) {
          setLastStepOutcome(step, 'applied');
          log.push(`[oracle-ir] No die-roll branch matched result ${rolled}`);
          appliedSteps.push(step);
          break;
        }

        const branchResult = recurse(nextState, band.steps, currentCtx, options);
        nextState = branchResult.state;
        setLastStepOutcome(step, 'applied');
        log.push(`[oracle-ir] Applied die-roll branch ${band.min}-${band.max} for result ${rolled}`);
        log.push(...branchResult.log);
        appliedSteps.push(...branchResult.appliedSteps);
        skippedSteps.push(...branchResult.skippedSteps);
        appliedSteps.push(step);
        automationGaps.push(...branchResult.automationGaps);
        pendingOptionalSteps.push(...branchResult.pendingOptionalSteps);
        break;
      }
      case 'draw': {
        const result = applyDrawStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'clash': {
        const result = applyClashStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastClashWon === 'boolean') {
            lastClashWon = appliedResult.lastClashWon;
            currentCtx = { ...currentCtx, lastClashWon };
          }
        });
        break;
      }
      case 'collect_evidence': {
        const result = applyCollectEvidenceStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (typeof appliedResult.lastCollectedEvidence === 'boolean') {
            lastCollectedEvidence = appliedResult.lastCollectedEvidence;
            currentCtx = { ...currentCtx, lastCollectedEvidence };
          }
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'learn': {
        const result = applyLearnStep(nextState, step, currentCtx, options);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
          lastDiscardedCards = Array.isArray(appliedResult.lastDiscardedCards)
            ? [...appliedResult.lastDiscardedCards]
            : lastDiscardedCards;
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
          };
        });
        break;
      }
      case 'open_attraction': {
        const result = applyOpenAttractionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'roll_visit_attractions': {
        const result = applyRollVisitAttractionsStep(nextState, step, currentCtx);
        const applied = applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        if (!applied) break;

        const visitedAttractions = Array.isArray((result as any).lastVisitedAttractions)
          ? (result as any).lastVisitedAttractions
          : [];
        for (const attraction of visitedAttractions) {
          const visitAbilityText = String(
            attraction?.card?.visitAbility || attraction?.visitAbility || attraction?.card?.oracle_text || ''
          ).trim();
          if (!visitAbilityText) continue;

          const visitIr = parseOracleTextToIR(visitAbilityText, String(attraction?.card?.name || attraction?.name || 'Attraction'));
          const visitSteps = visitIr.abilities.flatMap(ability => ability.steps);
          if (visitSteps.length === 0) continue;

          const visitCtx: OracleIRExecutionContext = {
            ...currentCtx,
            sourceId: String(attraction?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
            sourceName: String(attraction?.card?.name || attraction?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
          };
          const visitResult = recurse(nextState, visitSteps, visitCtx, options);
          nextState = visitResult.state;
          log.push(`[oracle-ir] Resolved Attraction visit ability from ${String(attraction?.card?.name || attraction?.name || 'Attraction')}`);
          log.push(...visitResult.log);
          appliedSteps.push(...visitResult.appliedSteps);
          skippedSteps.push(...visitResult.skippedSteps);
          automationGaps.push(...visitResult.automationGaps);
          pendingOptionalSteps.push(...visitResult.pendingOptionalSteps);
        }
        break;
      }
      case 'take_initiative': {
        const result = applyTakeInitiativeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'become_monarch': {
        const result = applyBecomeMonarchStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'venture_into_dungeon': {
        const result = applyVentureIntoDungeonStep(nextState, step, currentCtx);
        const applied = applyHandledStepResult(step, result);
        if (!applied) break;

        const dungeonRoomEffectText = String((result as any).lastDungeonRoomEffectText || '').trim();
        if (!dungeonRoomEffectText) break;

        const dungeonName = String((result as any).lastDungeonName || 'Dungeon').trim() || 'Dungeon';
        const dungeonRoomName = String((result as any).lastDungeonRoomName || 'Room').trim() || 'Room';
        const roomIr = parseOracleTextToIR(dungeonRoomEffectText, `${dungeonName} - ${dungeonRoomName}`);
        const roomSteps = roomIr.abilities.flatMap(ability => ability.steps);
        if (roomSteps.length === 0) break;

        const roomResult = recurse(nextState, roomSteps, currentCtx, options);
        nextState = roomResult.state;
        log.push(`[oracle-ir] Resolved dungeon room ability from ${dungeonName} (${dungeonRoomName})`);
        log.push(...roomResult.log);
        appliedSteps.push(...roomResult.appliedSteps);
        skippedSteps.push(...roomResult.skippedSteps);
        automationGaps.push(...roomResult.automationGaps);
        pendingOptionalSteps.push(...roomResult.pendingOptionalSteps);
        break;
      }
      case 'planeswalk': {
        const result = applyPlaneswalkStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'assemble': {
        const result = applyAssembleStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'regenerate': {
        const result = applyRegenerateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'abandon_scheme': {
        const result = applyAbandonSchemeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'set_in_motion': {
        const result = applySetInMotionStep(nextState, step, currentCtx);
        const applied = applyHandledStepResult(step, result, (appliedResult) => {
          lastSetInMotionScheme = (appliedResult as any).lastSetInMotionScheme ?? lastSetInMotionScheme;
          currentCtx = {
            ...currentCtx,
            lastSetInMotionScheme,
          };
        });
        if (!applied) break;

        const setInMotionScheme = (result as any).lastSetInMotionScheme;
        const schemeOracleText = String(
          setInMotionScheme?.oracle_text || setInMotionScheme?.card?.oracle_text || ''
        ).trim();
        if (!schemeOracleText) break;

        const schemeIr = parseOracleTextToIR(
          schemeOracleText,
          String(setInMotionScheme?.name || setInMotionScheme?.card?.name || currentCtx.sourceName || 'Scheme')
        );
        const triggerSteps = schemeIr.abilities
          .filter(ability => String((ability as any)?.triggerCondition || '').trim().toLowerCase() === 'you set this scheme in motion')
          .flatMap(ability => ability.steps);
        if (triggerSteps.length === 0) break;

        const schemeCtx: OracleIRExecutionContext = {
          ...currentCtx,
          sourceId: String(setInMotionScheme?.id || setInMotionScheme?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
          sourceName: String(setInMotionScheme?.name || setInMotionScheme?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
          lastSetInMotionScheme: setInMotionScheme,
        };
        const schemeResult = recurse(nextState, triggerSteps, schemeCtx, options);
        nextState = schemeResult.state;
        log.push(`[oracle-ir] Replayed set-in-motion trigger for ${String(setInMotionScheme?.name || setInMotionScheme?.card?.name || 'Scheme')}`);
        log.push(...schemeResult.log);
        appliedSteps.push(...schemeResult.appliedSteps);
        skippedSteps.push(...schemeResult.skippedSteps);
        automationGaps.push(...schemeResult.automationGaps);
        pendingOptionalSteps.push(...schemeResult.pendingOptionalSteps);
        break;
      }
      case 'search_library': {
        const result = applySearchLibraryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'skip_next_draw_step': {
        const result = applySkipNextDrawStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_graveyard_permission': {
        const result = applyGrantGraveyardPermissionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGrantedGraveyardCards = Array.isArray(appliedResult.lastGrantedGraveyardCards)
            ? [...appliedResult.lastGrantedGraveyardCards]
            : [];
        });
        break;
      }
      case 'modify_graveyard_permissions': {
        const result = applyModifyGraveyardPermissionsStep(nextState, step, {
          lastGrantedGraveyardCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_mana': {
        const result = applyAddManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'pay_mana': {
        const result = applyPayManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_opponent': {
        const explicitOpponentId = (
          String(currentCtx.selectorContext?.targetOpponentId || '').trim() ||
          String(currentCtx.selectorContext?.targetPlayerId || '').trim()
        ) as PlayerID;
        const validExplicitOpponent = Boolean(
          explicitOpponentId &&
          (nextState.players || []).some(
            (p: any) => String(p?.id || '').trim() === explicitOpponentId && String(p?.id || '').trim() !== controllerId
          )
        );
        const opponentIds = (nextState.players || [])
          .map((p: any) => String(p?.id || '').trim())
          .filter((id: string) => Boolean(id) && id !== controllerId) as PlayerID[];
        const chosenOpponentId = (validExplicitOpponent
          ? explicitOpponentId
          : opponentIds.length === 1
            ? opponentIds[0]
            : '') as PlayerID | '';

        if (!chosenOpponentId) {
          recordSkippedStep(
            step,
            `Skipped choose opponent (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                opponentCount: opponentIds.length,
              },
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            targetOpponentId: chosenOpponentId,
            targetPlayerId: chosenOpponentId,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose opponent ${chosenOpponentId}`);
        appliedSteps.push(step);
        break;
      }
      case 'create_emblem': {
        const result = applyCreateEmblemStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'proliferate': {
        const result = applyProliferateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'investigate': {
        const result = applyInvestigateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'populate': {
        const result = applyPopulateStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'ring_tempts_you': {
        const result = applyRingTemptsYouStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'time_travel': {
        const result = applyTimeTravelStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'suspect': {
        const result = applySuspectStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'become_renowned': {
        const result = applyBecomeRenownedStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'monstrosity': {
        const result = applyMonstrosityStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'turn_face_up': {
        const result = applyTurnFaceUpStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'copy_permanent': {
        const result = applyCopyPermanentStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'scry': {
        const result = applyScryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastScryLookedAtCount = Math.max(0, Number(appliedResult.lastScryLookedAtCount) || 0);
        });
        break;
      }
      case 'surveil': {
        const result = applySurveilStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'fateseal': {
        const result = applyFatesealStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'vote': {
        const result = applyVoteStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'look_select_top': {
        const result = applyLookSelectTopStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'explore': {
        const result = applyExploreStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'manifest_dread': {
        const result = applyManifestDreadStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'connive': {
        const result = applyConniveStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
          lastDiscardedCards = Array.isArray(appliedResult.lastDiscardedCards)
            ? [...appliedResult.lastDiscardedCards]
            : [];
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
          };
        });
        break;
      }
      case 'mill': {
        const result = applyMillStep(nextState, step, currentCtx);
        if ('message' in result) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        if (typeof result.lastRevealedCardCount === 'number') {
          lastRevealedCardCount = Math.max(0, Number(result.lastRevealedCardCount) || 0);
        }
        log.push(...result.log);
        appliedSteps.push(step);
        break;
      }
      case 'modify_pt': {
        const result = applyModifyPtStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          evaluateModifyPtWhereX,
          evaluateModifyPtCondition
        );
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'set_base_pt': {
        const result = applySetBasePtStep(nextState, step, currentCtx);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'modify_pt_per_revealed': {
        const result = applyModifyPtPerRevealedStep(nextState, step, currentCtx, lastRevealedCardCount);
        applyModifyPtStepResult(step, result);
        break;
      }
      case 'discard': {
        const result = applyDiscardStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastDiscardedCardCount = Math.max(0, Number(appliedResult.lastDiscardedCardCount) || 0);
          lastDiscardedCards = Array.isArray(appliedResult.lastDiscardedCards)
            ? [...appliedResult.lastDiscardedCards]
            : [];
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards)
            ? [...appliedResult.lastMovedCards]
            : lastMovedCards;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
          };
        });
        break;
      }
      case 'gain_life': {
        const result = applyGainLifeStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'lose_life': {
        const result = applyLoseLifeStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_player_counter': {
        const result = applyAddPlayerCounterStep(
          nextState,
          step,
          currentCtx,
          controllerId,
          {
            lastRevealedCardCount,
            lastDiscardedCardCount,
            lastDiscardedCards,
            lastExiledCardCount,
            lastExiledCards,
            lastMovedCards,
            lastGoadedCreatures,
            lastSacrificedCreaturesPowerTotal,
            lastSacrificedPermanents,
            lastExcessDamageDealtThisWay,
            lastScryLookedAtCount,
            lastTappedMatchingPermanentCount,
          },
          evaluateModifyPtWhereX
        );
        applyHandledStepResult(step, result);
        break;
      }
      case 'deal_damage': {
        const result = applyDealDamageStep(nextState, step, currentCtx, {
          lastMovedCards,
          lastTappedMatchingPermanentCount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastExcessDamageDealtThisWay = Math.max(0, Number(appliedResult.excessDamageDealtThisWay) || 0);
        });
        break;
      }
      case 'prevent_damage': {
        const result = applyPreventDamageStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'tap_or_untap': {
        const result = applyTapOrUntapStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'tap_matching_permanents': {
        const result = applyTapMatchingPermanentsStep(nextState, step, currentCtx);
        if ('message' in result) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        lastTappedMatchingPermanentCount = Math.max(0, Number(result.lastTappedMatchingPermanentCount) || 0);
        const tappedIds = Array.isArray(result.lastTappedMatchingPermanentIds)
          ? result.lastTappedMatchingPermanentIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
          : [];
        setLastStepOutcome(step, 'applied', { count: lastTappedMatchingPermanentCount });
        if (tappedIds.length > 0) {
          currentCtx = {
            ...currentCtx,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: tappedIds,
            },
          };
        }
        log.push(...result.log);
        appliedSteps.push(step);
        break;
      }
      case 'remove_counter': {
        const result = applyRemoveCounterStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_counter': {
        const result = applyAddCounterStep(nextState, step, currentCtx, {
          lastCreatedTokenIds,
          lastMovedCards,
          lastDiscardedCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : lastMovedCards;
          currentCtx = { ...currentCtx, lastMovedCards };
        });
        break;
      }
      case 'add_types': {
        const result = applyAddTypesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'double_counters': {
        const result = applyDoubleCountersStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'move_zone': {
        const result = applyMoveZoneStep(nextState, step, currentCtx, {
          lastMovedCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastMovedCards = Array.isArray(appliedResult.lastMovedCards) ? [...appliedResult.lastMovedCards] : [];
          lastMovedBattlefieldPermanentIds = Array.isArray(appliedResult.lastMovedBattlefieldPermanentIds)
            ? [...appliedResult.lastMovedBattlefieldPermanentIds]
            : [];
          currentCtx = {
            ...currentCtx,
            lastMovedCards,
            lastMovedBattlefieldPermanentIds,
          };
        });
        break;
      }
      case 'attach': {
        const result = applyAttachStep(nextState, step, currentCtx, lastMovedBattlefieldPermanentIds);
        applyHandledStepResult(step, result);
        break;
      }
      case 'create_token': {
        const result = applyCreateTokenStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastMovedCards,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          lastCreatedTokenIds = Array.isArray(appliedResult.createdTokenIds)
            ? appliedResult.createdTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
            : [];
          if (lastCreatedTokenIds.length <= 0) return;
          lastMovedBattlefieldPermanentIds = [...lastCreatedTokenIds];
          currentCtx = {
            ...currentCtx,
            lastMovedBattlefieldPermanentIds,
            selectorContext: {
              ...(currentCtx.selectorContext || {}),
              chosenObjectIds: Array.from(
                new Set([
                  ...((currentCtx.selectorContext?.chosenObjectIds || []) as readonly string[]),
                  ...lastCreatedTokenIds,
                ].map((id: unknown) => String(id || '').trim()).filter(Boolean))
              ),
            },
          };
        });
        break;
      }
      case 'grant_temporary_dies_trigger': {
        const result = applyGrantTemporaryDiesTriggerStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_temporary_ability': {
        const result = applyGrantTemporaryAbilityStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_leave_battlefield_replacement': {
        const result = applyGrantLeaveBattlefieldReplacementStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'copy_chapter_ability': {
        if (lastMovedCards.length !== 1) {
          recordSkippedStep(
            step,
            `Skipped copied chapter ability (no moved Saga card available): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const movedCard = lastMovedCards[0] as any;
        const replayableSteps = getCopiedChapterAbilityReplaySteps(movedCard, step.chapter);
        if (replayableSteps.length === 0) {
          recordSkippedStep(
            step,
            `Skipped copied chapter ability (no deterministic chapter steps): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const replayCtx: OracleIRExecutionContext = {
          ...currentCtx,
          sourceId: String(movedCard?.id || movedCard?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
          sourceName: String(movedCard?.name || movedCard?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
          castFromZone: undefined,
          enteredFromZone: undefined,
        };

        const replayResult = recurse(nextState, replayableSteps, replayCtx, options);
        nextState = replayResult.state;
        setLastStepOutcome(step, 'applied');
        log.push(
          `[oracle-ir] Replayed copied chapter ${step.chapter} ability from ${String(movedCard?.name || movedCard?.card?.name || 'copied Saga')}`
        );
        log.push(...replayResult.log);
        appliedSteps.push(...replayResult.appliedSteps);
        skippedSteps.push(...replayResult.skippedSteps);
        appliedSteps.push(step);
        automationGaps.push(...replayResult.automationGaps);
        pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
        break;
      }
      case 'copy_spell': {
        if (step.subject === 'this_spell') {
          const replaySourceSteps = Array.isArray(currentCtx.copyReplaySteps)
            ? currentCtx.copyReplaySteps
            : stepIndex > 0
              ? steps.slice(0, stepIndex)
              : getThisSpellReplayStepsFromState(nextState, currentCtx.sourceId);
          const replayableSteps = replaySourceSteps
            .filter((candidate): candidate is OracleEffectStep => candidate.kind !== 'copy_spell');
          if (replayableSteps.length === 0) {
            recordSkippedStep(
              step,
              `Skipped copy spell step (no replayable spell steps): ${step.raw}`,
              'invalid_copy_spell_source',
              {
                classification: 'invalid_input',
              }
            );
            break;
          }

          const preparedCopy = prepareCopiedSpellExecutionContext({
            state: nextState,
            replaySteps: replayableSteps,
            ctx: currentCtx,
          });
          if (preparedCopy.requiresChoice) {
            recordSkippedStep(
              step,
              `Skipped copied spell retargeting (requires player choice): ${step.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
                metadata: {
                  candidateCount: Number(preparedCopy.candidateCount || 0),
                },
              }
            );
            break;
          }

          const copyCount = resolveCopySpellCount(nextState, controllerId, step);
          if (copyCount <= 0) {
            setLastStepOutcome(step, 'applied', { count: 0 });
            appliedSteps.push(step);
            log.push(`[oracle-ir] Copy spell produced 0 copies: ${step.raw}`);
            break;
          }

          let workingState = nextState;
          for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
            const replayResult = recurse(workingState, replayableSteps, preparedCopy.ctx, options);
            workingState = replayResult.state;
            log.push(...preparedCopy.log);
            log.push(...replayResult.log);
            automationGaps.push(...replayResult.automationGaps);
            pendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
          }

          nextState = workingState;
          setLastStepOutcome(step, 'applied', { count: copyCount });
          appliedSteps.push(step);
          break;
        }

        const sourceResolution = resolveCopiedSpellSourceCards({
          state: nextState,
          step,
          ctx: currentCtx,
          lastMovedCards,
        });
        if (!sourceResolution.cards || sourceResolution.cards.length === 0) {
          recordSkippedStep(
            step,
            `Skipped copy spell step (copied source unavailable): ${step.raw}`,
            'invalid_copy_spell_source',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        let workingState = nextState;
        const combinedLog: string[] = [];
        const combinedGaps: OracleAutomationGap[] = [];
        const combinedPendingOptionalSteps: OracleEffectStep[] = [];
        let appliedCopyCount = 0;

        for (const copiedCard of sourceResolution.cards) {
          const replayableSteps = getCopiedSpellReplaySteps(copiedCard);
          if (replayableSteps.length === 0) {
            recordSkippedStep(
              step,
              `Skipped copy spell step (no deterministic copied spell steps): ${step.raw}`,
              'invalid_copy_spell_source',
              {
                classification: 'invalid_input',
              }
            );
            continue;
          }

          const payment = payCopiedSpellCastCost({
            state: workingState,
            controllerId,
            card: copiedCard,
            step,
          });
          if (payment.reason) {
            recordSkippedStep(
              step,
              payment.reason === 'cannot_pay'
                ? `Skipped copy spell step (cannot pay copied spell cost): ${step.raw}`
                : `Skipped copy spell step (unsupported copied spell cost): ${step.raw}`,
              payment.reason === 'cannot_pay' ? 'failed_to_apply' : 'invalid_copy_spell_source',
              {
                classification: payment.reason === 'cannot_pay' ? 'invalid_input' : 'ambiguous',
                persist: false,
              }
            );
            continue;
          }

          workingState = payment.state;
          combinedLog.push(...payment.log);

          const replayCtx: OracleIRExecutionContext = {
            ...currentCtx,
            sourceId: String(copiedCard?.id || copiedCard?.card?.id || currentCtx.sourceId || '').trim() || currentCtx.sourceId,
            sourceName: String(copiedCard?.name || copiedCard?.card?.name || currentCtx.sourceName || '').trim() || currentCtx.sourceName,
            castFromZone: undefined,
            enteredFromZone: undefined,
            copyReplaySteps: replayableSteps,
          };

          const replayResult = recurse(
            workingState,
            replayableSteps,
            replayCtx,
            {
              ...options,
              allowOptional: step.optional ? options.allowOptional : true,
            }
          );
          workingState = replayResult.state;
          combinedLog.push(`[oracle-ir] Replayed copied spell from ${String(copiedCard?.name || copiedCard?.card?.name || 'copied card')}`);
          combinedLog.push(...replayResult.log);
          combinedGaps.push(...replayResult.automationGaps);
          combinedPendingOptionalSteps.push(...replayResult.pendingOptionalSteps);
          appliedCopyCount += 1;
        }

        if (appliedCopyCount === 0) break;

        nextState = workingState;
        setLastStepOutcome(step, 'applied');
        log.push(...combinedLog);
        appliedSteps.push(step);
        automationGaps.push(...combinedGaps);
        pendingOptionalSteps.push(...combinedPendingOptionalSteps);
        break;
      }
      case 'schedule_delayed_trigger': {
        const result = applyScheduleDelayedTriggerStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'destroy': {
        const result = applyDestroyStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'exile': {
        const result = applyExileStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'sacrifice': {
        const result = applySacrificeStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastSacrificedCreaturesPowerTotal = Math.max(
            0,
            Number(appliedResult.lastSacrificedCreaturesPowerTotal) || 0
          );
          lastSacrificedPermanents = Array.isArray(appliedResult.lastSacrificedPermanents)
            ? [...appliedResult.lastSacrificedPermanents]
            : [];
        });
        break;
      }
      case 'schedule_delayed_battlefield_action': {
        const result = applyScheduleDelayedBattlefieldActionStep(nextState, step, currentCtx, {
          lastMovedBattlefieldPermanentIds,
          lastCreatedTokenIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_mode': {
        const result = applyChooseModeStep(nextState, step, currentCtx, options, recurse);
        if (result.kind === 'recorded_skip') {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        nextState = result.state;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
        break;
      }
      case 'conditional': {
        const conditionEvaluation = evaluateConditionalWrapperCondition({
          condition: step.condition,
          nextState,
          controllerId,
          ctx: currentCtx,
          lastActionOutcome,
          lastConditionalEvaluation,
          pendingSteps: step.steps,
          lastMovedCards,
          lastDiscardedCards,
        });

        if (conditionEvaluation === false) {
          lastConditionalEvaluation = false;
          skippedSteps.push(step);
          log.push(`Skipped conditional step (condition false): ${step.raw}`);
          break;
        }

        if (conditionEvaluation === null) {
          const normalizedConditionRaw = String(step.condition.raw || '')
            .replace(/\u2019/g, "'")
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          if (/^not \((?:you|that player|target player|target opponent|that opponent|an opponent) pay \{[^}]+\}\)$/i.test(normalizedConditionRaw)) {
            const nestedChoiceStep = step.steps.length === 1 ? step.steps[0] : step;
            recordSkippedStep(
              nestedChoiceStep,
              `Skipped ${nestedChoiceStep.kind} (requires player choice): ${nestedChoiceStep.raw}`,
              'player_choice_required',
              {
                classification: 'player_choice',
              }
            );
            break;
          }

          lastConditionalEvaluation = null;
          recordSkippedStep(
            step,
            `Skipped conditional step (unsupported condition): ${step.raw}`,
            'unsupported_condition_clause',
            {
              metadata: {
                conditionKind: step.condition.kind,
                conditionRaw: step.condition.raw,
                nestedStepKinds: step.steps.map(inner => inner.kind),
              },
            }
          );
          break;
        }

        const resolvedAmount = resolveConditionalReferenceAmount({
          condition: step.condition,
          nextState,
          ctx: currentCtx,
        });
        const innerSteps = step.steps.map(inner => applyConditionalReferenceAmount(inner, resolvedAmount));
        const result = recurse(
          nextState,
          innerSteps,
          {
            ...currentCtx,
            lastDiscardedCards,
            copyReplaySteps: steps.slice(0, stepIndex),
            lastTappedMatchingPermanentCount,
          },
          options
        );
        nextState = result.state;
        lastConditionalEvaluation = true;
        log.push(...result.log);
        appliedSteps.push(...result.appliedSteps);
        skippedSteps.push(...result.skippedSteps);
        automationGaps.push(...result.automationGaps);
        pendingOptionalSteps.push(...result.pendingOptionalSteps);
        break;
      }
      case 'unless_pays_life': {
        const result = evaluateUnlessPaysLifeStep(nextState, step, currentCtx);
        if (!('shouldApplyNestedSteps' in result)) {
          recordSkippedStep(step, result.message, result.reason, result.options);
          break;
        }

        if (result.state) {
          nextState = result.state;
        }
        log.push(...result.log);
        if (!result.shouldApplyNestedSteps) {
          appliedSteps.push(step);
          break;
        }

        const nestedResult = recurse(nextState, step.steps, currentCtx, options);
        nextState = nestedResult.state;
        log.push(...nestedResult.log);
        appliedSteps.push(...nestedResult.appliedSteps);
        skippedSteps.push(...nestedResult.skippedSteps);
        automationGaps.push(...nestedResult.automationGaps);
        pendingOptionalSteps.push(...nestedResult.pendingOptionalSteps);
        appliedSteps.push(step);
        break;
      }
      default:
        recordSkippedStep(step, `Skipped unsupported step: ${step.raw}`, 'unsupported_step');
        break;
    }
  }

  nextState = appendOracleAutomationGapRecords(nextState, localAutomationGaps);

  return { state: nextState, log, appliedSteps, skippedSteps, automationGaps, pendingOptionalSteps };
}
