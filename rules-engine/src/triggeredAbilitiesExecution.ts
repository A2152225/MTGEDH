import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionOptions, OracleIRExecutionResult } from './oracleIRExecutor';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from './oracleIRExecutor';
import { parseOracleTextToIR } from './oracleIRParser';
import {
  buildEnrichedTriggerExecutionEventData,
  normalizeTriggerContextId,
} from './triggeredAbilitiesChoiceSupport';
import { evaluateTriggerCondition } from './triggeredAbilitiesConditionRouting';
import { resolveInterveningIfClause } from './triggeredAbilitiesInterveningIf';
import { findTriggeringAbilities } from './triggeredAbilitiesMatching';
import { createTriggerInstance, type TriggerInstance } from './triggeredAbilitiesQueue';
import {
  type TriggerEventData,
  buildOracleIRExecutionEventHintFromTriggerData,
  buildResolutionEventDataFromGameState,
} from './triggeredAbilitiesEventData';
import { type TriggerEvent, type TriggeredAbility } from './triggeredAbilitiesTypes';

export interface ProcessEventOracleExecutionResult {
  readonly state: GameState;
  readonly triggers: readonly TriggerInstance[];
  readonly executions: readonly OracleIRExecutionResult[];
  readonly log: readonly string[];
}

export interface ProcessEventOracleExecutionOptions extends OracleIRExecutionOptions {
  readonly resolutionEventData?: TriggerEventData;
}

export function executeTriggeredAbilityEffectWithOracleIR(
  state: GameState,
  ability: Pick<TriggeredAbility, 'controllerId' | 'sourceId' | 'sourceName' | 'effect'>,
  eventData?: TriggerEventData,
  options: OracleIRExecutionOptions = {}
): OracleIRExecutionResult {
  const ir = parseOracleTextToIR(ability.effect, ability.sourceName);
  const steps = ir.abilities.flatMap(a => a.steps);
  const normalizedEventData = buildEnrichedTriggerExecutionEventData(state, ability, eventData, {
    inferTapOrUntapChoice: true,
  });

  const canAutoAllowOptional =
    Boolean(normalizedEventData?.targetPermanentId && normalizedEventData?.tapOrUntapChoice) &&
    steps.some(step => step.kind === 'tap_or_untap' && Boolean((step as any).optional)) &&
    steps.every(step => !Boolean((step as any).optional) || step.kind === 'tap_or_untap');

  const executionOptions =
    canAutoAllowOptional && !options.allowOptional
      ? { ...options, allowOptional: true }
      : options;

  const hint = buildOracleIRExecutionEventHintFromTriggerData(normalizedEventData);
  const ctx = buildOracleIRExecutionContext(
    {
      controllerId: (normalizeTriggerContextId(ability.controllerId) ?? ability.controllerId) as PlayerID,
      sourceId: ability.sourceId,
      sourceName: ability.sourceName,
    },
    hint
  );

  return applyOracleIRStepsToGameState(state, steps, ctx, {
    ...executionOptions,
    selectedModeIds: normalizedEventData?.selectedModeIds,
  });
}

export function processEventAndExecuteTriggeredOracle(
  state: GameState,
  event: TriggerEvent,
  abilities: readonly TriggeredAbility[],
  eventData?: TriggerEventData,
  options: ProcessEventOracleExecutionOptions = {}
): ProcessEventOracleExecutionResult {
  const triggeredAbilities = findTriggeringAbilities(abilities, event, eventData);
  const timestamp = Date.now();

  const triggers: TriggerInstance[] = [];
  const executions: OracleIRExecutionResult[] = [];
  const log: string[] = [];

  let nextState = state;

  for (let idx = 0; idx < triggeredAbilities.length; idx++) {
    const ability = triggeredAbilities[idx];
    const executionEventData = buildEnrichedTriggerExecutionEventData(state, ability, eventData, {
      inferTapOrUntapChoice: false,
    });
    const trigger = createTriggerInstance(ability, timestamp + idx, executionEventData);
    triggers.push(trigger);

    const resolvedInterveningIfClause = resolveInterveningIfClause(ability);

    if (ability.hasInterveningIf && !resolvedInterveningIfClause) {
      log.push(`${ability.sourceName} trigger skipped at resolution (intervening-if missing clause)`);
      continue;
    }

    if (resolvedInterveningIfClause) {
      const resolutionData =
        options.resolutionEventData ??
        buildResolutionEventDataFromGameState(nextState, ability.controllerId, executionEventData);
      const stillTrue = evaluateTriggerCondition(resolvedInterveningIfClause, ability.controllerId, resolutionData);
      if (!stillTrue) {
        log.push(`${ability.sourceName} trigger skipped at resolution (intervening-if false)`);
        continue;
      }
    }

    const execution = executeTriggeredAbilityEffectWithOracleIR(nextState, ability, executionEventData, options);
    executions.push(execution);
    nextState = execution.state;

    log.push(`${ability.sourceName} triggered ability processed`);
    log.push(...execution.log);
  }

  return {
    state: nextState,
    triggers,
    executions,
    log,
  };
}
