/**
 * Rule 603: Handling Triggered Abilities
 *
 * Triggered abilities watch for events and trigger when those events occur.
 * They use "when," "whenever," or "at."
 *
 * Based on MagicCompRules 20251114.txt
 */

export { evaluateTriggerCondition } from './triggeredAbilitiesConditionRouting';
export { resolveInterveningIfClause } from './triggeredAbilitiesInterveningIf';
export { checkTrigger, findTriggeringAbilities } from './triggeredAbilitiesMatching';
export { parseTriggeredAbilitiesFromText } from './triggeredAbilitiesParsing';
export type {
  ProcessEventOracleExecutionOptions,
  ProcessEventOracleExecutionResult,
} from './triggeredAbilitiesExecution';
export {
  executeTriggeredAbilityEffectWithOracleIR,
  processEventAndExecuteTriggeredOracle,
} from './triggeredAbilitiesExecution';
export type { TriggerInstance, TriggerQueue } from './triggeredAbilitiesQueue';
export {
  createEmptyTriggerQueue,
  createTriggerInstance,
  processEvent,
  putTriggersOnStack,
  queueTrigger,
} from './triggeredAbilitiesQueue';
export type { ResolvedTriggeredAbilityChoice } from './triggeredAbilitiesChoiceSupport';
export {
  buildTriggeredAbilityChoiceEvents,
  buildTriggeredAbilityEventDataFromChoices,
} from './triggeredAbilitiesChoiceSupport';
export type { TriggerEventData } from './triggeredAbilitiesEventData';
export {
  buildOracleIRExecutionEventHintFromTriggerData,
  buildResolutionEventDataFromGameState,
  buildStackTriggerMetaFromEventData,
  buildTriggerEventDataFromPayloads,
} from './triggeredAbilitiesEventData';
export { TriggerEvent, TriggerKeyword, type ParsedTrigger, type TriggeredAbility } from './triggeredAbilitiesTypes';
export {
  checkMultipleTriggers,
  createAttacksTrigger,
  createCombatDamageToPlayerTrigger,
  createCompoundTrigger,
  createDiesTrigger,
  createETBTrigger,
  createEndStepTrigger,
  createLandfallTrigger,
  createLifeGainTrigger,
  createSacrificeTrigger,
  createSpellCastTrigger,
  createUpkeepTrigger,
} from './triggeredAbilitiesTemplates';
