// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: applyOracleIRStepsToGameStateImpl switch cases flip_coin through
// set_in_motion (coin/die, draw/win/lose, clash/learn/attraction, venture/monarch).
// Public entry symbol: tryApplyMainLoopCoinDieDrawSteps.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { parseOracleTextToIR } from './oracleIRParser';
import { generateCoinFlipResult } from './coinFlip';
import { performDieRoll, performMultipleDieRolls } from './dieRoll';
import { applyRegenerateStep } from './oracleIRExecutorBattlefieldStepHandlers';
import { opponentsHaveCantWinEffect, playerHasCantLoseEffect } from './winEffectCards';
import {
  applyAssembleStep,
  applyBecomeMonarchStep,
  applyAbandonSchemeStep,
  applyClashStep,
  applyCollectEvidenceStep,
  applyDrawStep,
  applyLearnStep,
  applyOpenAttractionStep,
  applyPlaneswalkStep,
  applyRollVisitAttractionsStep,
  applySetInMotionStep,
  applyTakeInitiativeStep,
  applyVentureIntoDungeonStep,
} from './oracleIRExecutorPlayerStepHandlers';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { isPlayerStillInGame } from './oracleIRExecutorMainLoopCounterSpellStep';
import type {
  MainLoopApplyHandledFn,
  MainLoopApplyModifyPtFn,
  MainLoopRecordSkippedFn,
  MainLoopSetLastStepOutcomeFn,
  MainLoopStepFamilyCtx,
} from './oracleIRExecutorMainLoopStepTypes';
import {
  flushMainLoopFamilyMutableState,
  pickMainLoopFamilyCore,
} from './oracleIRExecutorMainLoopStepTypes';

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

export function tryApplyMainLoopCoinDieDrawSteps(
  ctx: MainLoopStepFamilyCtx,
  step: OracleEffectStep,
): true | undefined {
  const startNextState = ctx.nextState;
  let nextState = ctx.nextState;
  let currentCtx = ctx.currentCtx;
  let lastRevealedCardCount = ctx.lastRevealedCardCount;
  let lastDiscardedCardCount = ctx.lastDiscardedCardCount;
  let lastGreatestDiscardedCardCount = ctx.lastGreatestDiscardedCardCount;
  let lastDiscardedCards = ctx.lastDiscardedCards;
  let lastExiledCardCount = ctx.lastExiledCardCount;
  let lastExiledCards = ctx.lastExiledCards;
  let lastGrantedGraveyardCards = ctx.lastGrantedGraveyardCards;
  let lastGrantedGraveyardPermissionIds = ctx.lastGrantedGraveyardPermissionIds;
  let lastMovedCards = ctx.lastMovedCards;
  let lastMilledCards = ctx.lastMilledCards;
  let lastMovedBattlefieldPermanentIds = ctx.lastMovedBattlefieldPermanentIds;
  let lastCreatedTokenIds = ctx.lastCreatedTokenIds;
  let lastGoadedCreatures = ctx.lastGoadedCreatures;
  let lastSacrificedCreaturesPowerTotal = ctx.lastSacrificedCreaturesPowerTotal;
  let lastSacrificedPermanents = ctx.lastSacrificedPermanents;
  let lastExcessDamageDealtThisWay = ctx.lastExcessDamageDealtThisWay;
  let lastScryLookedAtCount = ctx.lastScryLookedAtCount;
  let lastTappedMatchingPermanentCount = ctx.lastTappedMatchingPermanentCount;
  let lastReferenceAmount = ctx.lastReferenceAmount;
  let lastMovedCountByPlayer = ctx.lastMovedCountByPlayer;
  let lastClashWon = ctx.lastClashWon;
  let lastCollectedEvidence = ctx.lastCollectedEvidence;
  let lastSetInMotionScheme = ctx.lastSetInMotionScheme;
  let lastStepOutcome = ctx.lastStepOutcome;
  let lastActionOutcome = ctx.lastActionOutcome;
  let lastConditionalEvaluation = ctx.lastConditionalEvaluation;
  let replayMutations = ctx.replayMutations;
  let anyConditionalProducedSteps = ctx.anyConditionalProducedSteps;
  let haltedForPlayerChoice = ctx.haltedForPlayerChoice;
  let pendingContinuationSteps = ctx.pendingContinuationSteps;
  let automationGapSequence = ctx.automationGapSequence;
  const controllerId = ctx.controllerId;
  const log = ctx.log;
  const appliedSteps = ctx.appliedSteps;
  const skippedSteps = ctx.skippedSteps;
  const localAutomationGaps = ctx.localAutomationGaps;
  const automationGaps = ctx.automationGaps;
  const pendingOptionalSteps = ctx.pendingOptionalSteps;
  const falseConditionalMarkers = ctx.falseConditionalMarkers;
  const recurse = ctx.recurse;
  const options = ctx.options;
  const absorbExecutionReplayMutations = ctx.absorbExecutionReplayMutations;
  const mergeNestedExecutionOutcome = ctx.mergeNestedExecutionOutcome;

  const flushLets = (): void => {
    flushMainLoopFamilyMutableState(ctx, {
      nextState,
      currentCtx,
      lastRevealedCardCount,
      lastDiscardedCardCount,
      lastGreatestDiscardedCardCount,
      lastDiscardedCards,
      lastExiledCardCount,
      lastExiledCards,
      lastGrantedGraveyardCards,
      lastGrantedGraveyardPermissionIds,
      lastMovedCards,
      lastMilledCards,
      lastMovedBattlefieldPermanentIds,
      lastCreatedTokenIds,
      lastGoadedCreatures,
      lastSacrificedCreaturesPowerTotal,
      lastSacrificedPermanents,
      lastExcessDamageDealtThisWay,
      lastScryLookedAtCount,
      lastTappedMatchingPermanentCount,
      lastReferenceAmount,
      lastMovedCountByPlayer,
      lastClashWon,
      lastCollectedEvidence,
      lastSetInMotionScheme,
      lastStepOutcome,
      lastActionOutcome,
      lastConditionalEvaluation,
      replayMutations,
      anyConditionalProducedSteps,
      haltedForPlayerChoice,
      pendingContinuationSteps,
      automationGapSequence,
    }, startNextState);
  };

  const applyHandledStepResult: MainLoopApplyHandledFn = (handledStep, result, onApplied) => {
    const ok = ctx.applyHandledStepResult(handledStep, result, (appliedResult) => {
      ({
        nextState,
        currentCtx,
        lastMovedCards,
        lastScryLookedAtCount,
        lastReferenceAmount,
        lastStepOutcome,
        lastActionOutcome,
        replayMutations,
        haltedForPlayerChoice,
        automationGapSequence,
      } = pickMainLoopFamilyCore(ctx));
      onApplied?.(appliedResult);
      flushLets();
    });
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
    return ok;
  };

  const recordSkippedStep: MainLoopRecordSkippedFn = (handledStep, message, reasonCode, skipOptions) => {
    flushLets();
    ctx.recordSkippedStep(handledStep, message, reasonCode, skipOptions);
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
  };

  const setLastStepOutcome: MainLoopSetLastStepOutcomeFn = (handledStep, kind, metadata) => {
    flushLets();
    ctx.setLastStepOutcome(handledStep, kind, metadata);
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
  };

  const applyModifyPtStepResult: MainLoopApplyModifyPtFn = (handledStep, result) => {
    flushLets();
    const ok = ctx.applyModifyPtStepResult(handledStep, result);
    ({
      nextState,
      currentCtx,
      lastMovedCards,
      lastScryLookedAtCount,
      lastReferenceAmount,
      lastStepOutcome,
      lastActionOutcome,
      replayMutations,
      haltedForPlayerChoice,
      automationGapSequence,
    } = pickMainLoopFamilyCore(ctx));
    return ok;
  };

  switch (step.kind) {
      case 'flip_coin': {
        const players = resolvePlayers(nextState, step.who, currentCtx);
        if (players.length === 0) {
          recordSkippedStep(
            step,
            `Skipped flip coin step (unsupported player selector): ${step.raw}`,
            'unsupported_player_selector',
            {
              classification: 'ambiguous',
            }
          );
          break;
        }

        const call = step.call || 'heads';
        const stateAny: any = nextState as any;
        stateAny.lastCoinFlipByPlayer = stateAny.lastCoinFlipByPlayer || {};
        stateAny.coinFlipsThisTurn = stateAny.coinFlipsThisTurn || {};
        const flipSummaries: string[] = [];
        let lastWon = typeof currentCtx.wonCoinFlip === 'boolean' ? currentCtx.wonCoinFlip : undefined;

        for (const playerId of players) {
          const results: Array<'heads' | 'tails'> = [];
          const wins: boolean[] = [];
          const firstResult =
            typeof lastWon === 'boolean'
              ? lastWon
                ? call
                : call === 'heads'
                  ? 'tails'
                  : 'heads'
              : generateCoinFlipResult();
          results.push(firstResult);
          wins.push(firstResult === call);
          if (step.repeatUntil === 'lose_flip') {
            while (wins[wins.length - 1] && results.length < 100) {
              const nextFlip = generateCoinFlipResult();
              results.push(nextFlip);
              wins.push(nextFlip === call);
            }
          }
          const result = results[results.length - 1];
          const won = wins[wins.length - 1] === true;
          const timestamp = Date.now();
          const flipRecord = {
            playerId,
            call,
            result,
            won,
            timestamp,
            ...(step.repeatUntil === 'lose_flip' ? { repeatUntil: 'lose_flip', results, wins } : {}),
          };
          stateAny.lastCoinFlip = flipRecord;
          stateAny.lastCoinFlipByPlayer[playerId] = flipRecord;
          stateAny.coinFlipsThisTurn[playerId] = Array.isArray(stateAny.coinFlipsThisTurn[playerId])
            ? [...stateAny.coinFlipsThisTurn[playerId], flipRecord]
            : [flipRecord];
          flipSummaries.push(`${playerId} flipped ${results.length} coin(s): ${result}${won ? ' (won)' : ' (lost)'}`);
          lastWon = won;
        }

        nextState = stateAny as GameState;
        currentCtx = { ...currentCtx, wonCoinFlip: lastWon };
        setLastStepOutcome(step, 'applied');
        log.push(`[oracle-ir] ${flipSummaries.join('; ')}`);
        appliedSteps.push(step);
        break;
      }
      case 'flip_coin_life_stakes': {
        // Interactive loop is owned by the server (optional flip-again prompts).
        recordSkippedStep(
          step,
          `Skipped flip coin life stakes (requires player choice): ${step.raw}`,
          'player_choice_required',
          {
            classification: 'player_choice',
            metadata: {
              initialStake: Number((step as any).initialStake || 1) || 1,
              doubleEachFlip: (step as any).doubleEachFlip !== false,
            },
          },
        );
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

        const count = Math.max(1, Math.trunc(Number(step.count ?? 1)) || 1);
        const forcedResult = Number(currentCtx.dieRollResult);
        const rolls =
          count === 1 && Number.isFinite(forcedResult) && forcedResult >= 1 && forcedResult <= step.sides
            ? [{ result: forcedResult }]
            : count === 1
              ? [performDieRoll(players[0], step.sides)]
              : [...performMultipleDieRolls(players[0], step.sides, count)];
        const results = rolls.map(roll => Number((roll as any).result)).filter(result => Number.isFinite(result));
        const total = results.reduce((sum, result) => sum + result, 0);
        const displayedResult = count === 1 ? (results[0] ?? 0) : total;
        const timestamp = Date.now();
        const stateAny: any = nextState as any;
        stateAny.lastDieRoll = {
          playerId: players[0],
          sides: step.sides,
          count,
          result: displayedResult,
          results,
          timestamp,
        };
        stateAny.lastDieRollByPlayer = stateAny.lastDieRollByPlayer || {};
        stateAny.lastDieRollByPlayer[players[0]] = {
          sides: step.sides,
          count,
          result: displayedResult,
          results,
          timestamp,
        };
        stateAny.dieRollsThisTurn = stateAny.dieRollsThisTurn || {};
        const rollRecord = { sides: step.sides, count, result: displayedResult, results, timestamp };
        stateAny.dieRollsThisTurn[players[0]] = Array.isArray(stateAny.dieRollsThisTurn[players[0]])
          ? [...stateAny.dieRollsThisTurn[players[0]], rollRecord]
          : [rollRecord];
        nextState = stateAny as GameState;
        setLastStepOutcome(step, 'applied');
        log.push(
          count === 1
            ? `[oracle-ir] ${players[0]} rolled d${step.sides}: ${displayedResult}`
            : `[oracle-ir] ${players[0]} rolled ${count}d${step.sides}: ${results.join(', ')} (total ${total})`
        );
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
        absorbExecutionReplayMutations(branchResult);
        break;
      }
      case 'draw': {
        const result = applyDrawStep(nextState, step, currentCtx, {
          lastRevealedCardCount,
          lastDiscardedCardCount,
          lastGreatestDiscardedCardCount,
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
          lastReferenceAmount,
        });
        applyHandledStepResult(step, result, (appliedResult) => {
          const antecedentIds = Array.isArray(appliedResult.lastAntecedentBattlefieldPermanentIds)
            ? appliedResult.lastAntecedentBattlefieldPermanentIds
                .map((id: unknown) => String(id || '').trim())
                .filter(Boolean)
            : [];
          if (antecedentIds.length > 0) {
            currentCtx = {
              ...currentCtx,
              lastAntecedentBattlefieldPermanentIds: antecedentIds,
            };
          }
        });
        break;
      }
      case 'win_game': {
        if (!controllerId) {
          recordSkippedStep(
            step,
            `Skipped win game (controller unavailable): ${step.raw}`,
            'invalid_controller',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const cantWin = opponentsHaveCantWinEffect(
          controllerId as any,
          (nextState.battlefield || []) as any,
          nextState.players as any,
          ((nextState as any).winLossEffects || []) as any
        );
        if (cantWin.hasCantWin) {
          recordSkippedStep(
            step,
            `Skipped win game (blocked by ${cantWin.source}): ${step.raw}`,
            'impossible_action',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        nextState = {
          ...nextState,
          winner: controllerId,
          status: 'finished' as any,
          winReason: String(step.raw || 'You win the game') as any,
        } as GameState;
        setLastStepOutcome(step, 'applied');
        log.push(`${controllerId} wins the game`);
        appliedSteps.push(step);
        break;
      }
      case 'lose_game': {
        if (!controllerId) {
          recordSkippedStep(
            step,
            `Skipped lose game (controller unavailable): ${step.raw}`,
            'invalid_controller',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const cantLose = playerHasCantLoseEffect(
          controllerId as any,
          (nextState.battlefield || []) as any,
          nextState.players as any,
          ((nextState as any).winLossEffects || []) as any
        );
        if (cantLose.hasCantLose) {
          recordSkippedStep(
            step,
            `Skipped lose game (blocked by ${cantLose.source}): ${step.raw}`,
            'impossible_action',
            {
              classification: 'invalid_input',
            }
          );
          break;
        }

        const nextPlayers = nextState.players.map((player) =>
          player.id === controllerId ? ({ ...player, hasLost: true } as typeof player) : player
        );
        nextState = {
          ...nextState,
          players: nextPlayers,
        } as GameState;

        log.push(`${controllerId} loses the game`);

        const remainingPlayers = nextPlayers.filter(isPlayerStillInGame);
        if (remainingPlayers.length === 1) {
          nextState = {
            ...nextState,
            winner: remainingPlayers[0].id,
            status: 'finished' as any,
            winReason: `${controllerId} lost the game` as any,
          } as GameState;
          log.push(`${remainingPlayers[0].id} wins the game`);
        }

        setLastStepOutcome(step, 'applied');
        appliedSteps.push(step);
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
          lastReferenceAmount = lastDiscardedCardCount;
          currentCtx = {
            ...currentCtx,
            lastDiscardedCards,
            lastMovedCards,
            referenceAmount: lastReferenceAmount,
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
          absorbExecutionReplayMutations(visitResult);
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
        absorbExecutionReplayMutations(roomResult);
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
        absorbExecutionReplayMutations(schemeResult);
        break;
      }
    default:
      return undefined;
  }
  flushLets();
  return true;
}
