import type { StackObject } from './spellCasting';
import { evaluateTriggerCondition } from './triggeredAbilitiesConditionRouting';
import { resolveInterveningIfClause } from './triggeredAbilitiesInterveningIf';
import { findTriggeringAbilities } from './triggeredAbilitiesMatching';
import {
  type TriggerEventData,
  buildStackTriggerMetaFromEventData,
} from './triggeredAbilitiesEventData';
import { type TriggerEvent, type TriggeredAbility } from './triggeredAbilitiesTypes';

/**
 * Trigger instance waiting to be put on stack.
 */
export interface TriggerInstance {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly effect: string;
  readonly triggerFilter?: string;
  readonly interveningIfClause?: string;
  readonly hasInterveningIf?: boolean;
  readonly triggerEventDataSnapshot?: TriggerEventData;
  readonly interveningIfWasTrueAtTrigger?: boolean;
  readonly targets?: readonly string[];
  readonly timestamp: number;
  readonly hasTriggered: boolean;
  readonly onStack: boolean;
}

/**
 * Trigger queue for managing pending triggers.
 */
export interface TriggerQueue {
  readonly triggers: readonly TriggerInstance[];
}

export function createEmptyTriggerQueue(): TriggerQueue {
  return { triggers: [] };
}

export function createTriggerInstance(
  ability: TriggeredAbility,
  timestamp: number,
  eventDataSnapshot?: TriggerEventData
): TriggerInstance {
  const resolvedInterveningIfClause = resolveInterveningIfClause(ability);
  const interveningIfWasTrueAtTrigger = resolvedInterveningIfClause
    ? evaluateTriggerCondition(resolvedInterveningIfClause, ability.controllerId, eventDataSnapshot)
    : undefined;

  return {
    id: `trigger-${timestamp}-${ability.id}`,
    abilityId: ability.id,
    sourceId: ability.sourceId,
    sourceName: ability.sourceName,
    controllerId: ability.controllerId,
    effect: ability.effect,
    triggerFilter: ability.triggerFilter,
    interveningIfClause: resolvedInterveningIfClause,
    hasInterveningIf: ability.hasInterveningIf,
    ...(eventDataSnapshot ? { triggerEventDataSnapshot: eventDataSnapshot } : {}),
    ...(interveningIfWasTrueAtTrigger !== undefined ? { interveningIfWasTrueAtTrigger } : {}),
    targets: ability.targets,
    timestamp,
    hasTriggered: true,
    onStack: false,
  };
}

export function queueTrigger(
  queue: Readonly<TriggerQueue>,
  trigger: TriggerInstance
): TriggerQueue {
  return {
    triggers: [...queue.triggers, trigger],
  };
}

export function putTriggersOnStack(
  queue: Readonly<TriggerQueue>,
  activePlayerId: string,
  turnOrder?: readonly string[]
): {
  queue: TriggerQueue;
  stackObjects: StackObject[];
  log: string[];
} {
  if (queue.triggers.length === 0) {
    return {
      queue,
      stackObjects: [],
      log: [],
    };
  }

  const logs: string[] = [];
  const normalizedTurnOrder = Array.isArray(turnOrder)
    ? turnOrder
      .map(id => String(id || '').trim())
      .filter(Boolean)
    : [];
  const activeIndexInTurnOrder = normalizedTurnOrder.indexOf(activePlayerId);
  const playerApnapRank = new Map<string, number>();
  if (activeIndexInTurnOrder >= 0) {
    for (let offset = 0; offset < normalizedTurnOrder.length; offset++) {
      const idx = (activeIndexInTurnOrder + offset) % normalizedTurnOrder.length;
      const playerId = normalizedTurnOrder[idx];
      if (!playerApnapRank.has(playerId)) {
        playerApnapRank.set(playerId, offset);
      }
    }
  }

  const sorted = [...queue.triggers].sort((a, b) => {
    const rankA = playerApnapRank.get(a.controllerId);
    const rankB = playerApnapRank.get(b.controllerId);

    if (rankA !== undefined && rankB !== undefined && rankA !== rankB) {
      return rankA - rankB;
    }

    if (a.controllerId === activePlayerId && b.controllerId !== activePlayerId) {
      return -1;
    }
    if (a.controllerId !== activePlayerId && b.controllerId === activePlayerId) {
      return 1;
    }
    return a.timestamp - b.timestamp;
  });

  const stackObjects: StackObject[] = sorted.map(trigger => {
    logs.push(`${trigger.sourceName} triggered ability goes on stack`);
    const triggerMetaBase = buildStackTriggerMetaFromEventData(
      trigger.effect,
      trigger.sourceId,
      trigger.controllerId,
      trigger.sourceName,
      trigger.triggerEventDataSnapshot
    );

    return {
      id: trigger.id,
      spellId: trigger.sourceId,
      cardName: `${trigger.sourceName} trigger`,
      controllerId: trigger.controllerId,
      targets: trigger.targets || [],
      triggerMeta: {
        ...triggerMetaBase,
        triggerFilter: trigger.triggerFilter,
        interveningIfClause: trigger.interveningIfClause,
        hasInterveningIf: trigger.hasInterveningIf,
        interveningIfWasTrueAtTrigger: trigger.interveningIfWasTrueAtTrigger,
      },
      timestamp: trigger.timestamp,
      type: 'ability',
    };
  });

  return {
    queue: createEmptyTriggerQueue(),
    stackObjects,
    log: logs,
  };
}

export function processEvent(
  event: TriggerEvent,
  abilities: readonly TriggeredAbility[],
  eventData?: TriggerEventData
): TriggerInstance[] {
  const triggeredAbilities = findTriggeringAbilities(abilities, event, eventData);
  const timestamp = Date.now();

  return triggeredAbilities.map(ability =>
    createTriggerInstance(ability, timestamp, eventData)
  );
}
