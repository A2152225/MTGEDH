import type { GameState, PlayerID } from '../../shared/src';
import {
  evaluateBatch368BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch368Bulk';
import {
  evaluateBatch369BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch369Bulk';
import {
  evaluateBatch370BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch370Bulk';
import {
  evaluateBatch371BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch371Bulk';
import {
  evaluateBatch372BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch372Bulk';
import {
  evaluateBatch373BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch373Bulk';
import {
  evaluateBatch374BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch374Bulk';
import {
  evaluateBatch375BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch375Bulk';
import {
  evaluateBatch376BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch376Bulk';
import {
  evaluateBatch377BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch377Bulk';
import {
  evaluateBatch378BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch378Bulk';
import {
  evaluateBatch379BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch379Bulk';
import {
  evaluateBatch380BulkConditionalClause,
} from './oracleIRExecutorConditionalStepSupportBatch380Bulk';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { collectCommandZoneObjects } from './oracleIRExecutorCommanderUtils';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { findObjectByIdInState, getCounterCountOnObject } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { getAmountOfManaSpent, getAmountOfSpecificManaSymbolSpent, getColorsFromObject } from './oracleIRExecutorManaUtils';
import { getCardManaValue, isCardExiledWithSource } from './oracleIRExecutorPlayerUtils';
import { cardMatchesType } from './oracleIRExecutorZoneOps';
import {
  collectRevealedThisWayCardsLedgerFirst,
  isRevealedThisWayLedgerFirst,
  isSearchedLibraryThisWayLedgerFirst,
  resolveAntecedentContextualCards,
  resolveAntecedentDiscardedCards,
  resolveAntecedentMilledCards,
  resolveAntecedentMovedCards,
} from './oracleIRLedgerCardAccess';

import type { ExtendedConditionalParams } from './oracleIRExecutorConditionalStepExtendedTypes';
export type { ExtendedConditionalParams };


import {
  evaluateAlternateCostPaidCondition,
  parseSmallNumberWord,
  getSpellsCastLastTurnCount,
  getSpellsCastLastTurnByPlayerCounts,
  opponentLostLifeThisTurn,
  objectHasType,
  getReferencedObject,
  getCreaturePower,
  getCreatureToughness,
  controlledCreatures,
  getTeamPlayerIds,
  countControlledMatchingDescriptor,
  antecedentApplied,
  cardMatchesChosenColor,
  cardsMatchDescriptor,
  getStackSpellPower,
  countBasicLandTypesAmongLandsYouControl,
  getPlayerLife,
  getControllerLife,
  getPlayerHandCount,
  objectHasAnyCounters,
  isPermanentInCommandZoneOrBattlefield,
  getGraveyardCards,
  getDieRollResult,
  movedCardsFrom,
  discardedCardsFrom,
  milledCardsFrom,
  contextualCardsFrom,
  getConditionalSubjectCard,
  cardsShareCardType,
  isPermanentAttacking,
  anyCreatureAttackedThisTurn,
  sourceDealtDamageToOpponentThisTurn,
  findBattlefieldPermanentByName,
  countCreaturesControlledBy,
  countExiledCardsWithSource,
  findExiledCardWithSource,
  getPlayerPoisonCount,
  getStackSpellCard,
  getCastManaSpendSource,
  isPermanentModified,
  noColoredManaWasSpentToCast,
  objectHasKeyword,
  getControlledTypeEnteredThisTurnCount,
  controllerCastBothCreatureAndNoncreatureThisTurn,
  getEnchantedCreatureFromAura,
  getStackItemTargetCount,
  permanentHasExiledCards,
  isNonbasicLand,
  getSourceCounterCount,
  getLastAntecedentCreaturePower,
} from './oracleIRExecutorConditionalStepExtendedClauseHelpers';


import { evaluateThisWayClause } from './oracleIRExecutorConditionalStepExtendedThisWay';
import { tryEvaluateExtendedWarriorDamageClause } from './oracleIRExecutorConditionalStepExtendedWarriorDamage';
import { tryEvaluateExtendedProwlClause } from './oracleIRExecutorConditionalStepExtendedProwl';
import { tryEvaluateExtendedLessonCardClause } from './oracleIRExecutorConditionalStepExtendedLessonCard';
import { tryEvaluateExtendedCycledCardClause } from './oracleIRExecutorConditionalStepExtendedCycledCard';
import { tryEvaluateExtendedVotedChoiceClause } from './oracleIRExecutorConditionalStepExtendedVotedChoice';
import { tryEvaluateExtendedCommanderControlClause } from './oracleIRExecutorConditionalStepExtendedCommanderControl';


function evaluateWouldReplacementClause(normalizedRaw: string): boolean | null {
  if (!/\bwould\b/.test(normalizedRaw)) return null;
  if (/would gain life/.test(normalizedRaw)) return true;
  if (/would draw a card/.test(normalizedRaw)) return true;
  if (/would be put into (?:a|your) graveyard/.test(normalizedRaw)) return true;
  if (/would die/.test(normalizedRaw)) return true;
  if (/would create .+ token instead/.test(normalizedRaw)) return true;
  if (/would deal .+ damage/.test(normalizedRaw)) return true;
  if (/would put one or more counters/.test(normalizedRaw)) return true;
  if (/would enter/.test(normalizedRaw)) return true;
  if (/would lose the game/.test(normalizedRaw)) return true;
  if (/would mill/.test(normalizedRaw)) return true;
  if (/would lose life/.test(normalizedRaw)) return true;
  if (/would be destroyed/.test(normalizedRaw)) return true;
  if (/would counter a spell/.test(normalizedRaw)) return true;
  if (/would cause you to draw a card/.test(normalizedRaw)) return true;
  return null;
}

export function evaluateExtendedConditionalClause(params: ExtendedConditionalParams): boolean | null {
  const {
    normalizedRaw,
    raw,
    nextState,
    controllerId,
    ctx,
    lastActionOutcome,
    lastMovedCards,
    lastDiscardedCards,
    lastExcessDamageDealtThisWay,
  } = params;

  const thisWay = evaluateThisWayClause(params);
  if (thisWay !== null) return thisWay;

  const would = evaluateWouldReplacementClause(normalizedRaw);
  if (would !== null) return would;

  {
    const bulk368 = evaluateBatch368BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      getCastManaSpendSource,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getControlledTypeEnteredThisTurnCount,
      getGraveyardCards,
      getSourceCounterCount,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      isPermanentAttacking,
      cardMatchesChosenColor,
      contextualCardsFrom,
      movedCardsFrom,
      objectHasAnyCounters,
      getTeamPlayerIds,
    });
    if (bulk368 !== null) return bulk368;
  }

  {
    const bulk369 = evaluateBatch369BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      getCastManaSpendSource,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      isPermanentAttacking,
      cardMatchesChosenColor,
      contextualCardsFrom,
      movedCardsFrom,
      objectHasAnyCounters,
      getCreaturePower,
      getEnchantedCreatureFromAura,
    });
    if (bulk369 !== null) return bulk369;
  }

  {
    const bulk370 = evaluateBatch370BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      getCastManaSpendSource,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      cardMatchesChosenColor,
      contextualCardsFrom,
      movedCardsFrom,
      getCreaturePower,
      getEnchantedCreatureFromAura,
    });
    if (bulk370 !== null) return bulk370;
  }

  {
    const bulk371 = evaluateBatch371BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      cardMatchesChosenColor,
      contextualCardsFrom,
      movedCardsFrom,
      getCreaturePower,
      getPlayerHandCount,
    });
    if (bulk371 !== null) return bulk371;
  }

  {
    const bulk372 = evaluateBatch372BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      movedCardsFrom,
    });
    if (bulk372 !== null) return bulk372;
  }

  {
    const bulk373 = evaluateBatch373BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
    });
    if (bulk373 !== null) return bulk373;
  }

  {
    const bulk374 = evaluateBatch374BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      discardedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
      cardMatchesChosenColor,
    });
    if (bulk374 !== null) return bulk374;
  }

  {
    const bulk375 = evaluateBatch375BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      discardedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
    });
    if (bulk375 !== null) return bulk375;
  }

  {
    const bulk376 = evaluateBatch376BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      discardedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
    });
    if (bulk376 !== null) return bulk376;
  }

  {
    const bulk377 = evaluateBatch377BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      discardedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
    });
    if (bulk377 !== null) return bulk377;
  }

  {
    const bulk378 = evaluateBatch378BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      discardedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
    });
    if (bulk378 !== null) return bulk378;
  }

  {
    const bulk379 = evaluateBatch379BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      discardedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
    });
    if (bulk379 !== null) return bulk379;
  }

  {
    const bulk380 = evaluateBatch380BulkConditionalClause({
      normalizedRaw,
      nextState,
      controllerId,
      ctx,
      lastActionOutcome,
      lastMovedCards,
      lastDiscardedCards,
      lastExcessDamageDealtThisWay,
      getConditionalSubjectCard,
      getReferencedObject,
      controlledCreatures,
      getGraveyardCards,
      getControllerLife,
      parseSmallNumberWord,
      objectHasType,
      objectHasKeyword,
      getPlayerHandCount,
      getCreaturePower,
      getCreatureToughness,
      movedCardsFrom,
      discardedCardsFrom,
      isPermanentAttackingFn: isPermanentAttacking,
    });
    if (bulk380 !== null) return bulk380;
  }

  {
    const warriorDamage = tryEvaluateExtendedWarriorDamageClause(params);
    if (warriorDamage !== null) return warriorDamage;
  }

  {
    const prowl = tryEvaluateExtendedProwlClause(params);
    if (prowl !== null) return prowl;
  }


  {
    const lessonCard = tryEvaluateExtendedLessonCardClause(params);
    if (lessonCard !== null) return lessonCard;
  }


  {
    const cycledCard = tryEvaluateExtendedCycledCardClause(params);
    if (cycledCard !== null) return cycledCard;
  }

  {
    const votedChoice = tryEvaluateExtendedVotedChoiceClause(params);
    if (votedChoice !== null) return votedChoice;
  }

  {
    const commanderControl = tryEvaluateExtendedCommanderControlClause(params);
    if (commanderControl !== null) return commanderControl;
  }


  return null;
}
