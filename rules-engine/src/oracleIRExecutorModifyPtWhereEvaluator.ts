import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  getHighestCommanderTaxForController,
} from './oracleIRExecutorCommanderUtils';
import {
  countControlledByClass,
  normalizeControlledClassKey,
} from './oracleIRExecutorCreatureStepUtils';
import {
  isExecutorCreature,
} from './oracleIRExecutorPermanentUtils';
import {
  countCardsExiledWithSource,
  getCardTypeLineLower,
  getCardManaValue,
  getCardTypesFromTypeLine,
  normalizeOracleText,
  quantityToNumber,
  resolvePlayers,
} from './oracleIRExecutorPlayerUtils';
import { tryEvaluateModifyPtWhereControlledCounts } from './oracleIRExecutorModifyPtWhereControlledCounts';
import { createModifyPtWhereEvaluatorContext } from './oracleIRExecutorModifyPtWhereContext';
import { tryEvaluateModifyPtWhereArithmetic } from './oracleIRExecutorModifyPtWhereArithmetic';
import { tryEvaluateModifyPtWhereBoardStateCounts } from './oracleIRExecutorModifyPtWhereBoardStateCounts';
import { tryEvaluateModifyPtWhereExileAndCardStats } from './oracleIRExecutorModifyPtWhereExileAndCardStats';
import { tryEvaluateModifyPtWhereExtrema } from './oracleIRExecutorModifyPtWhereExtremaHandlers';
import { tryEvaluateModifyPtWhereLateReferenceStats } from './oracleIRExecutorModifyPtWhereLateReferenceStats';
import { tryEvaluateModifyPtWhereMiscCounts } from './oracleIRExecutorModifyPtWhereMiscCounts';
import { tryEvaluateModifyPtWhereNegatedAndHybridCounts } from './oracleIRExecutorModifyPtWhereNegatedAndHybridCounts';
import { tryEvaluateModifyPtWherePlayerAndReferenceState } from './oracleIRExecutorModifyPtWherePlayerAndReferenceState';
import { tryEvaluateModifyPtWhereQualifiedCounts } from './oracleIRExecutorModifyPtWhereQualifiedCounts';
import { tryEvaluateModifyPtWhereReferenceStats } from './oracleIRExecutorModifyPtWhereReferenceStats';
import { tryEvaluateModifyPtWhereSpecializedExtrema } from './oracleIRExecutorModifyPtWhereSpecializedExtrema';
import { tryEvaluateModifyPtWhereTurnStats } from './oracleIRExecutorModifyPtWhereTurnStats';
import { tryEvaluateModifyPtWhereZoneCardCounts } from './oracleIRExecutorModifyPtWhereZoneCardCounts';

export function evaluateModifyPtWhereX(
  state: GameState,
  controllerId: PlayerID,
  whereRaw: string,
  targetCreatureId?: string,
  ctx?: OracleIRExecutionContext,
  runtime?: ModifyPtRuntime,
  depth = 0
): number | null {
  if (depth > 3) return null;

  const {
    raw,
    battlefield,
    controlled,
    opponentsControlled,
    getCardsFromPlayerZone,
    typeLineLower,
    isAttackingObject,
    hasFlyingKeyword,
    getCreatureSubtypeKeys,
    resolveContextPlayer,
    findPlayerById,
    findObjectById,
    findObjectByName,
    getExcludedId,
    getSourceRef,
    getTargetRef,
    resolveLastSacrificedSnapshot,
    getCounterCountOnObject,
    isCommanderObject,
    collectCommandZoneObjects,
    countCardsByClasses,
    getColorsFromObject,
    countManaSymbolsInManaCost,
    normalizeManaColorCode,
    getColorsOfManaSpent,
    getAmountOfManaSpent,
    getAmountOfSpecificManaSymbolSpent,
    parseCardClassList,
    parseClassList,
    parseColorQualifiedClassSpec,
    countByClasses,
    hasExecutorClass,
    countNegatedClass,
    leastStatAmongCreatures,
    greatestStatAmongCreatures,
    greatestPowerAmongCreatureCards,
    greatestManaValueAmongCards,
    greatestSharedCreatureSubtypeCount,
    lowestManaValueAmongPermanents,
    highestManaValueAmongPermanents,
  } = createModifyPtWhereEvaluatorContext(state, controllerId, whereRaw, targetCreatureId, ctx, runtime);

  const evaluateInner = (expr: string): number | null => {
    return evaluateModifyPtWhereX(state, controllerId, `x is ${expr}`, targetCreatureId, ctx, runtime, depth + 1);
  };

  {
    const arithmetic = tryEvaluateModifyPtWhereArithmetic({ state, controllerId, raw, evaluateInner });
    if (arithmetic !== null) return arithmetic;
  }

  {
    const negatedAndHybridCounts = tryEvaluateModifyPtWhereNegatedAndHybridCounts({
      state,
      raw,
      battlefield,
      controlled,
      opponentsControlled,
      controllerId,
      countNegatedClass,
      getExcludedId,
      parseClassList,
      parseCardClassList,
      countByClasses,
      countCardsByClasses,
      findPlayerById,
    });
    if (negatedAndHybridCounts !== null) return negatedAndHybridCounts;
  }

  {
    const controlledCounts = tryEvaluateModifyPtWhereControlledCounts({
      state,
      controllerId,
      raw,
      battlefield,
      controlled,
      opponentsControlled,
      ctx,
      resolveContextPlayer,
      parseColorQualifiedClassSpec,
      countByClasses,
    });
    if (controlledCounts !== null) return controlledCounts;
  }

  {
    const miscCounts = tryEvaluateModifyPtWhereMiscCounts({
      state,
      raw,
      battlefield,
      controlled,
      opponentsControlled,
      controllerId,
      ctx,
      typeLineLower,
      isAttackingObject,
      hasFlyingKeyword,
      hasExecutorClass,
      getExcludedId,
      parseClassList,
      findObjectById,
      normalizeOracleText,
    });
    if (miscCounts !== null) return miscCounts;
  }

  {
    const boardStateCounts = tryEvaluateModifyPtWhereBoardStateCounts({
      state,
      raw,
      battlefield,
      controlled,
      ctx,
      typeLineLower,
      getSourceRef,
      getTargetRef,
      getCounterCountOnObject,
      hasExecutorClass,
      countManaSymbolsInManaCost,
      getColorsFromObject,
      normalizeOracleText,
      findObjectByName,
    });
    if (boardStateCounts !== null) return boardStateCounts;
  }


  {
    const zoneCardCounts = tryEvaluateModifyPtWhereZoneCardCounts({
      state,
      controllerId,
      raw,
      ctx,
      resolveContextPlayer,
      findPlayerById,
      findObjectById,
      parseCardClassList,
      countCardsByClasses,
      getCardTypesFromTypeLine,
      normalizeOracleText,
    });
    if (zoneCardCounts !== null) return zoneCardCounts;
  }

  {
    const turnStats = tryEvaluateModifyPtWhereTurnStats({ state, controllerId, raw, runtime });
    if (turnStats !== null) return turnStats;
  }

  {
    const playerAndReferenceState = tryEvaluateModifyPtWherePlayerAndReferenceState({
      state,
      raw,
      battlefield,
      controllerId,
      targetCreatureId,
      ctx,
      findPlayerById,
      findObjectById,
      resolveLastSacrificedSnapshot,
      typeLineLower,
      getCardManaValue,
      hasExecutorClass,
      isCommanderObject,
      collectCommandZoneObjects,
      greatestManaValueAmongCards,
      getHighestCommanderTaxForController,
    });
    if (playerAndReferenceState !== null) return playerAndReferenceState;
  }

  {
    const qualifiedCounts = tryEvaluateModifyPtWhereQualifiedCounts({
      raw,
      battlefield,
      controllerId,
      ctx,
      getCardsFromPlayerZone,
      findPlayerById,
      resolveContextPlayer,
      getSourceRef,
      parseCardClassList,
      parseClassList,
      countCardsByClasses,
      countByClasses,
      hasExecutorClass,
    });
    if (qualifiedCounts !== null) return qualifiedCounts;
  }

  {
    const referenceStats = tryEvaluateModifyPtWhereReferenceStats({
      raw,
      battlefield,
      controllerId,
      targetCreatureId,
      ctx,
      findPlayerById,
      findObjectById,
      findObjectByName,
      getSourceRef,
      resolveLastSacrificedSnapshot,
      getCardManaValue,
      typeLineLower,
      getColorsFromObject,
      getColorsOfManaSpent,
      getAmountOfManaSpent,
      getAmountOfSpecificManaSymbolSpent,
      normalizeOracleText,
      hasExecutorClass,
      getExcludedId,
    });
    if (referenceStats !== null) return referenceStats;
  }

  {
    const extrema = tryEvaluateModifyPtWhereExtrema(raw, {
      raw,
      battlefield,
      controlled,
      opponentsControlled,
      getCardsFromPlayerZone,
      typeLineLower,
      isAttackingObject,
      hasFlyingKeyword,
      getCreatureSubtypeKeys,
      resolveContextPlayer,
      findPlayerById,
      findObjectById,
      findObjectByName,
      getExcludedId,
      getSourceRef,
      getTargetRef,
      resolveLastSacrificedSnapshot,
      getCounterCountOnObject,
      isCommanderObject,
      collectCommandZoneObjects,
      countCardsByClasses,
      getColorsFromObject,
      countManaSymbolsInManaCost,
      normalizeManaColorCode,
      getColorsOfManaSpent,
      getAmountOfManaSpent,
      getAmountOfSpecificManaSymbolSpent,
      parseCardClassList,
      parseClassList,
      parseColorQualifiedClassSpec,
      countByClasses,
      hasExecutorClass,
      countNegatedClass,
      leastStatAmongCreatures,
      greatestStatAmongCreatures,
      greatestPowerAmongCreatureCards,
      greatestManaValueAmongCards,
      greatestSharedCreatureSubtypeCount,
      lowestManaValueAmongPermanents,
      highestManaValueAmongPermanents,
    });
    if (extrema !== null) return extrema;
  }

  {
    const exileAndCardStats = tryEvaluateModifyPtWhereExileAndCardStats({
      state,
      raw,
      battlefield,
      controllerId,
      ctx,
      runtime,
      countCardsExiledWithSource,
      findObjectByName,
      greatestPowerAmongCreatureCards,
      greatestManaValueAmongCards,
    });
    if (exileAndCardStats !== null) return exileAndCardStats;
  }

  {
    const specializedExtrema = tryEvaluateModifyPtWhereSpecializedExtrema({
      state,
      raw,
      controlled,
      opponentsControlled,
      controllerId,
      getCreatureSubtypeKeys,
      isAttackingObject,
      hasExecutorClass,
      getExcludedId,
      greatestStatAmongCreatures,
      highestManaValueAmongPermanents,
      isCommanderObject,
      collectCommandZoneObjects,
      greatestManaValueAmongCards,
      typeLineLower,
    });
    if (specializedExtrema !== null) return specializedExtrema;
  }


  {
    const lateReferenceStats = tryEvaluateModifyPtWhereLateReferenceStats({
      state,
      raw,
      battlefield,
      controllerId,
      ctx,
      findPlayerById,
      findObjectByName,
      getCounterCountOnObject,
      getExcludedId,
      hasExecutorClass,
    });
    if (lateReferenceStats !== null) return lateReferenceStats;
  }

  // â”€â”€ Safe-skips (non-deterministic or complex context) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Random numbers
  if (/^x is a number chosen at random$/i.test(raw)) return null;
  // Noted numbers
  if (/^x is the (?:noted number|highest number you noted)/i.test(raw)) return null;
  // Chosen number (player choice)
  if (/^x is the chosen number$/i.test(raw)) return null;
  // First/second chosen result pair
  if (/^x is the first chosen result/i.test(raw)) return null;
  // Number in creature's text box
  if (/^x is a number in the sacrificed creature'?s text box$/i.test(raw)) return null;
  // Complex structural counts
  if (/^x is the greatest number of (?:consecutive|stored results)/i.test(raw)) return null;
  // Specific total-damage tracking (requires complex event log)
  if (/^x is the greatest amount of damage dealt by a source/i.test(raw)) return null;

  return null;
}


