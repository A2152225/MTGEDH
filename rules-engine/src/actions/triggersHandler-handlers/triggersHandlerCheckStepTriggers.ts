// Origin parent: rules-engine/src/actions/triggersHandler.ts
// Cluster moved: checkStepTriggers.
// Public entry symbols: checkStepTriggers.
// Leaf must not import actions/triggersHandler.ts or triggersHandler-handlers/index.ts.

import type { GameState } from '../../../../shared/src';
import {
  TriggerEvent,
  executeTriggeredAbilityEffectWithOracleIR,
  processEvent,
  processEventAndExecuteTriggeredOracle,
  putTriggersOnStack,
  createEmptyTriggerQueue,
  buildTriggerEventDataFromPayloads,
  buildResolutionEventDataFromGameState,
} from '../../triggeredAbilities';
import {
  checkDelayedTriggers,
  processDelayedTriggers,
  type DelayedTriggerRegistry,
} from '../../delayedTriggeredAbilities';
import type {
  TriggerResult,
  StepTriggerProcessingOptions,
} from './triggersHandlerTypes.js';
import { getStackItems } from './triggersHandlerStackItems.js';
import { findTriggeredAbilities } from './triggersHandlerFindTriggeredAbilities.js';

/**
 * Check for beginning of step triggers
 */
export function checkStepTriggers(
  state: GameState,
  event: TriggerEvent,
  activePlayerId?: string,
  options: StepTriggerProcessingOptions = {}
): TriggerResult {
  const abilities = findTriggeredAbilities(state);
  const stepAbilities = abilities.filter(a => a.event === event);
  const logs: string[] = [];
  const autoExecuteOracle = Boolean(options.autoExecuteOracle);
  let nextState = state;
  let triggerInstances: any[] = [];
  let oracleStepsApplied = 0;
  let oracleStepsSkipped = 0;
  let oracleExecutions = 0;
  let oracleAutomationGaps = 0;

  const controllerIds = Array.from(
    new Set(stepAbilities.map(ability => String(ability.controllerId || '').trim()).filter(Boolean))
  );

  if (controllerIds.length === 0 && activePlayerId) {
    controllerIds.push(String(activePlayerId).trim());
  }

  for (const controllerId of controllerIds) {
    const controllerAbilities = stepAbilities.filter(
      ability => String(ability.controllerId || '').trim() === controllerId
    );
    if (controllerAbilities.length === 0) continue;

    const eventData = buildResolutionEventDataFromGameState(
      nextState,
      controllerId,
      buildTriggerEventDataFromPayloads(activePlayerId || controllerId, {
        sourceControllerId: activePlayerId || controllerId,
        affectedPlayerIds: activePlayerId ? [activePlayerId] : undefined,
      })
    );

    if (autoExecuteOracle) {
      const execution = processEventAndExecuteTriggeredOracle(
        nextState,
        event,
        controllerAbilities,
        eventData,
        {
          allowOptional: options.allowOptional,
          resolutionEventData: options.resolutionEventData,
        }
      );
      nextState = execution.state;
      triggerInstances.push(...execution.triggers);
      oracleStepsApplied += execution.executions.reduce((sum, r) => sum + (r.appliedSteps?.length || 0), 0);
      oracleStepsSkipped += execution.executions.reduce((sum, r) => sum + (r.skippedSteps?.length || 0), 0);
      oracleAutomationGaps += execution.executions.reduce((sum, r) => sum + (r.automationGaps?.length || 0), 0);
      oracleExecutions += execution.executions.length;
      logs.push(...execution.log);
      continue;
    }

    triggerInstances.push(...processEvent(event, controllerAbilities, eventData));
  }

  const delayedTriggerRegistry =
    options.delayedTriggerRegistry ||
    (((state as any).delayedTriggerRegistry || undefined) as DelayedTriggerRegistry | undefined);
  let updatedDelayedRegistry = delayedTriggerRegistry;
  const delayedEventType =
    event === TriggerEvent.BEGINNING_OF_UPKEEP
      ? 'upkeep'
      : event === TriggerEvent.BEGINNING_OF_END_STEP
        ? 'end_step'
        : event === TriggerEvent.BEGINNING_OF_COMBAT
          ? 'combat_begin'
          : event === TriggerEvent.END_OF_COMBAT
            ? 'combat_end'
            : event === TriggerEvent.CLEANUP_STEP
              ? 'cleanup'
              : null;

  if (delayedTriggerRegistry && delayedEventType) {
    const delayedCheck = checkDelayedTriggers(delayedTriggerRegistry, {
      type: delayedEventType,
      activePlayerId: activePlayerId as any,
      currentTurn:
        options.turnNumber ??
        Number((state as any).turnNumber ?? (state as any).turn ?? 0) ??
        0,
    });

    if (delayedCheck.triggersToFire.length > 0) {
      updatedDelayedRegistry = {
        ...delayedTriggerRegistry,
        triggers: delayedCheck.remainingTriggers,
        firedTriggerIds: [
          ...(Array.isArray(delayedTriggerRegistry.firedTriggerIds) ? delayedTriggerRegistry.firedTriggerIds : []),
          ...delayedCheck.triggersToFire.map(trigger => trigger.id),
        ],
      };

      triggerInstances.push(...processDelayedTriggers(delayedCheck.triggersToFire, Date.now()));
      logs.push(...delayedCheck.triggersToFire.map(trigger => `${trigger.sourceName} delayed trigger processed`));

      if (autoExecuteOracle) {
        for (const delayedTrigger of delayedCheck.triggersToFire) {
          const execution = executeTriggeredAbilityEffectWithOracleIR(
            nextState,
            {
              controllerId: delayedTrigger.controllerId,
              sourceId: delayedTrigger.sourceId,
              sourceName: delayedTrigger.sourceName,
              effect: delayedTrigger.effect,
            },
            delayedTrigger.eventDataSnapshot,
            { allowOptional: options.allowOptional }
          );
          nextState = execution.state;
          oracleExecutions += 1;
          oracleStepsApplied += execution.appliedSteps.length;
          oracleStepsSkipped += execution.skippedSteps.length;
          oracleAutomationGaps += execution.automationGaps.length;
          logs.push(...execution.log);
        }
      }
    }
  }

  if (autoExecuteOracle) {
    logs.unshift(
      `[triggers] Oracle auto-execution: executions=${oracleExecutions}, applied=${oracleStepsApplied}, skipped=${oracleStepsSkipped}, gaps=${oracleAutomationGaps}`
    );
  }

  if (triggerInstances.length === 0) {
    return {
      state: updatedDelayedRegistry
        ? ({ ...(nextState as any), delayedTriggerRegistry: updatedDelayedRegistry } as any)
        : nextState,
      triggersAdded: 0,
      oracleStepsApplied,
      oracleStepsSkipped,
      oracleExecutions,
      oracleAutomationGaps,
      logs,
    };
  }

  let queue = createEmptyTriggerQueue();
  for (const trigger of triggerInstances) {
    queue = { triggers: [...queue.triggers, trigger] };
  }

  const activeId = activePlayerId || state.players[state.activePlayerIndex || 0]?.id || '';
  const apnapTurnOrder = (() => {
    const ids = (state.players || []).map(p => String((p as any)?.id || '').trim()).filter(Boolean);
    if (ids.length === 0) return ids;
    const activeIdx = ids.indexOf(activeId);
    if (activeIdx < 0) return ids;
    return [...ids.slice(activeIdx), ...ids.slice(0, activeIdx)];
  })();
  const { stackObjects, log } = putTriggersOnStack(queue, activeId, apnapTurnOrder);
  logs.push(...log);

  return {
    state: {
      ...(nextState as any),
      ...(updatedDelayedRegistry ? { delayedTriggerRegistry: updatedDelayedRegistry } : {}),
      stack: [...getStackItems(nextState), ...stackObjects] as any,
    } as any,
    triggersAdded: stackObjects.length,
    oracleStepsApplied,
    oracleStepsSkipped,
    oracleExecutions,
    oracleAutomationGaps,
    logs,
  };
}

