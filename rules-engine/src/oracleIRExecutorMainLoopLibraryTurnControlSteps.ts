// Origin parent: oracleIRExecutorMainLoop.ts
// Cluster moved: applyOracleIRStepsToGameStateImpl switch cases search_library through
// choose_card_name (library/turn/control/graveyard/mana/choice).
// Public entry symbol: tryApplyMainLoopLibraryTurnControlSteps.

import type { PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import {
  applyExchangeControlStep,
  applyGainControlStep,
  applyGrantStaticAbilityStep,
  applyAssignNoCombatDamageStep,
  applyBecomeAuraStep,
  applyPutStickerStep,
} from './oracleIRExecutorBattlefieldStepHandlers';
import {
  applyAddManaStep,
  applyChoosePileStep,
  applyChangeTargetStep,
  applyGrantGraveyardPermissionStep,
  applyGrantGraveyardKeywordAbilityStep,
  applyModifyGraveyardPermissionsStep,
  applyModifyTokenCreationStep,
  applyPayManaStep,
  applyJoinForcesStep,
  applyTemptingOfferStep,
  applyRetainManaStep,
  applyExileNamedCardsFromZonesStep,
  applySearchLibraryStep,
  applyShuffleZonesIntoLibraryStep,
  applyShuffleLibraryStep,
} from './oracleIRExecutorPlayerStepHandlers';
import {
  applyAddExtraCombat,
  applyEndCombatPhaseStep,
  applyEndTurnStep,
  applySkipNextDrawStep,
  applySkipNextTurnStep,
  applyTakeExtraTurn,
} from './oracleIRExecutorTurnStepHandlers';
import { listEligibleChooseOpponentIds } from './oracleIRExecutorPlayerUtils';
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

export function tryApplyMainLoopLibraryTurnControlSteps(
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
      case 'search_library': {
        const result = applySearchLibraryStep(nextState, step, currentCtx);
        if (applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastMovedCards) && appliedResult.lastMovedCards.length > 0) {
            lastMovedCards = [...appliedResult.lastMovedCards];
            currentCtx = { ...currentCtx, lastMovedCards };
          }
        })) {
          currentCtx = { ...currentCtx, searchedLibraryThisWay: true };
        } else if (currentCtx.searchedLibraryThisWay !== true) {
          currentCtx = { ...currentCtx, searchedLibraryThisWay: false };
        }
        break;
      }
      case 'exile_named_cards_from_zones': {
        const result = applyExileNamedCardsFromZonesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          if (Array.isArray(appliedResult.lastExiledCards) && appliedResult.lastExiledCards.length > 0) {
            lastExiledCards = [...appliedResult.lastExiledCards];
            currentCtx = { ...currentCtx, lastExiledCards };
          }
        });
        break;
      }
      case 'shuffle_library': {
        const result = applyShuffleLibraryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'prevent_library_search': {
        log.push(`[oracle-ir] Search prevention noted: ${step.raw}`);
        appliedSteps.push(step);
        break;
      }
      case 'skip_next_draw_step': {
        const result = applySkipNextDrawStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'skip_next_turn': {
        const result = applySkipNextTurnStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'end_turn': {
        const result = applyEndTurnStep(nextState, step);
        applyHandledStepResult(step, result);
        break;
      }
      case 'end_combat_phase': {
        const result = applyEndCombatPhaseStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'gain_control': {
        const result = applyGainControlStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          const referencedPermanentId = String(
            currentCtx.targetPermanentId ||
              currentCtx.targetCreatureId ||
              currentCtx.selectorContext?.targetPermanentId ||
              currentCtx.selectorContext?.targetCreatureId ||
              ''
          ).trim();
          const antecedentIds = Array.isArray(appliedResult.lastAntecedentBattlefieldPermanentIds)
            ? appliedResult.lastAntecedentBattlefieldPermanentIds
                .map((id: unknown) => String(id || '').trim())
                .filter(Boolean)
            : [];
          if (referencedPermanentId || antecedentIds.length > 0) {
            currentCtx = {
              ...currentCtx,
              ...(referencedPermanentId ? { lastReferencedPermanentId: referencedPermanentId } : {}),
              ...(antecedentIds.length > 0
                ? {
                    lastAntecedentBattlefieldPermanentIds: antecedentIds,
                    lastMovedBattlefieldPermanentIds: antecedentIds,
                  }
                : {}),
            };
          }
          if (antecedentIds.length > 0) {
            lastMovedBattlefieldPermanentIds = [...antecedentIds];
          }
        });
        break;
      }
      case 'exchange_control': {
        const result = applyExchangeControlStep(nextState, step, currentCtx);
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
              lastMovedBattlefieldPermanentIds: antecedentIds,
            };
            lastMovedBattlefieldPermanentIds = [...antecedentIds];
          }
        });
        break;
      }
      case 'take_extra_turn': {
        const result = applyTakeExtraTurn(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'add_extra_combat': {
        const result = applyAddExtraCombat(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'change_target': {
        const result = applyChangeTargetStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_graveyard_permission': {
        const result = applyGrantGraveyardPermissionStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result, (appliedResult) => {
          lastGrantedGraveyardCards = Array.isArray(appliedResult.lastGrantedGraveyardCards)
            ? [...appliedResult.lastGrantedGraveyardCards]
            : [];
          lastGrantedGraveyardPermissionIds = Array.isArray(appliedResult.lastGrantedGraveyardPermissionIds)
            ? [...appliedResult.lastGrantedGraveyardPermissionIds]
            : [];
        });
        break;
      }
      case 'grant_graveyard_keyword_ability': {
        const result = applyGrantGraveyardKeywordAbilityStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'modify_graveyard_permissions': {
        const result = applyModifyGraveyardPermissionsStep(nextState, step, {
          lastGrantedGraveyardCards,
          lastGrantedGraveyardPermissionIds,
        });
        applyHandledStepResult(step, result);
        break;
      }
      case 'modify_token_creation': {
        const result = applyModifyTokenCreationStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'grant_static_ability': {
        const result = applyGrantStaticAbilityStep(nextState, step, currentCtx);
        if (applyHandledStepResult(step, result)) {
          if (/\bsearch\b[\s\S]*\blibrary\b|\blibrary\b[\s\S]*\bsearch\b/i.test(String(step.raw || ''))) {
            currentCtx = { ...currentCtx, searchedLibraryThisWay: true };
          }
        }
        break;
      }
      case 'add_mana': {
        const result = applyAddManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'shuffle_zones_into_library': {
        const result = applyShuffleZonesIntoLibraryStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_pile': {
        const result = applyChoosePileStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'put_sticker': {
        const result = applyPutStickerStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'become_aura': {
        const result = applyBecomeAuraStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'assign_no_combat_damage': {
        const result = applyAssignNoCombatDamageStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'retain_mana': {
        const result = applyRetainManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'pay_mana': {
        const result = applyPayManaStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'join_forces': {
        const result = applyJoinForcesStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'tempting_offer': {
        const result = applyTemptingOfferStep(nextState, step, currentCtx);
        applyHandledStepResult(step, result);
        break;
      }
      case 'choose_opponent': {
        const eligibleOpponentIds = listEligibleChooseOpponentIds(
          nextState,
          controllerId,
          String(step.raw || ''),
        );
        const explicitOpponentId = (
          String(currentCtx.selectorContext?.targetOpponentId || '').trim() ||
          String(currentCtx.selectorContext?.targetPlayerId || '').trim()
        ) as PlayerID;
        const validExplicitOpponent = Boolean(
          explicitOpponentId && eligibleOpponentIds.includes(explicitOpponentId)
        );
        const chosenOpponentId = (validExplicitOpponent
          ? explicitOpponentId
          : eligibleOpponentIds.length === 1
            ? eligibleOpponentIds[0]
            : '') as PlayerID | '';

        if (!chosenOpponentId) {
          if (eligibleOpponentIds.length === 0) {
            recordSkippedStep(
              step,
              `Skipped choose opponent (no eligible opponents): ${step.raw}`,
              'no_applicable_targets',
            );
            break;
          }
          recordSkippedStep(
            step,
            `Skipped choose opponent (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                opponentCount: eligibleOpponentIds.length,
              },
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          ...(/promise an opponent a gift/i.test(String(step.raw || '')) ? { giftPromised: true } : {}),
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
      case 'choose_color': {
        const allowedOptions = (Array.isArray(step.manaOptions) && step.manaOptions.length > 0
          ? step.manaOptions
          : ['{W}', '{U}', '{B}', '{R}', '{G}']
        ).map(option => String(option || '').trim()).filter(Boolean);
        const rawChosenMana = String(currentCtx.selectorContext?.chosenMana || '').trim();
        const normalizedChosenMana = (() => {
          const upper = rawChosenMana.toUpperCase();
          if (!upper) return '';
          const symbol = upper.startsWith('{') && upper.endsWith('}') ? upper : `{${upper}}`;
          return /^{[WUBRG]}$/i.test(symbol) ? symbol.toUpperCase() : '';
        })();

        if (!normalizedChosenMana) {
          recordSkippedStep(
            step,
            `Skipped choose color (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                optionCount: allowedOptions.length,
              },
            }
          );
          break;
        }

        if (!allowedOptions.some(option => option.toUpperCase() === normalizedChosenMana.toUpperCase())) {
          recordSkippedStep(
            step,
            `Skipped choose color (invalid chosen color): ${step.raw}`,
            'invalid_input',
            {
              classification: 'invalid_input',
              metadata: {
                chosenMana: normalizedChosenMana,
                options: allowedOptions,
              },
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenMana: normalizedChosenMana,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose color ${normalizedChosenMana}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_number': {
        const minValue = Math.max(0, Math.floor(Number((step as { min?: number }).min ?? 0)));
        const maxValue = Math.max(minValue, Math.floor(Number((step as { max?: number }).max ?? minValue)));
        const rawChosen = Number(
          currentCtx.selectorContext?.chosenNumber ?? (currentCtx as { chosenNumber?: number }).chosenNumber,
        );
        if (!Number.isFinite(rawChosen)) {
          recordSkippedStep(
            step,
            `Skipped choose number (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
              metadata: {
                minValue,
                maxValue,
              },
            },
          );
          break;
        }
        const chosenNumber = Math.max(minValue, Math.min(maxValue, Math.floor(rawChosen)));
        currentCtx = {
          ...currentCtx,
          chosenNumber,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenNumber,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose number ${chosenNumber}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_creature_type': {
        const chosenCreatureType = String(currentCtx.selectorContext?.chosenCreatureType || '').trim();
        if (!chosenCreatureType) {
          recordSkippedStep(
            step,
            `Skipped choose creature type (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenCreatureType,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose creature type ${chosenCreatureType}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_basic_land_type': {
        const chosenBasicLandType = String(currentCtx.selectorContext?.chosenBasicLandType || '').trim();
        const allowedBasicLandTypes = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
        const normalizedBasicLandType = allowedBasicLandTypes.find(
          landType => landType.toLowerCase() === chosenBasicLandType.toLowerCase()
        );
        if (!normalizedBasicLandType) {
          recordSkippedStep(
            step,
            `Skipped choose basic land type (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenBasicLandType: normalizedBasicLandType,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose basic land type ${normalizedBasicLandType}`);
        appliedSteps.push(step);
        break;
      }
      case 'choose_card_name': {
        const chosenCardName = String(currentCtx.selectorContext?.chosenCardName || '').trim();
        if (!chosenCardName) {
          recordSkippedStep(
            step,
            `Skipped choose card name (requires player choice): ${step.raw}`,
            'player_choice_required',
            {
              classification: 'player_choice',
            }
          );
          break;
        }

        currentCtx = {
          ...currentCtx,
          selectorContext: {
            ...(currentCtx.selectorContext || {}),
            chosenCardName,
          },
        };
        setLastStepOutcome(step, 'applied');
        log.push(`Chose card name ${chosenCardName}`);
        appliedSteps.push(step);
        break;
      }
    default:
      return undefined;
  }
  flushLets();
  return true;
}
