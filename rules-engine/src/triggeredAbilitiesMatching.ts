import { evaluateTriggerCondition } from './triggeredAbilitiesConditionRouting';
import { resolveInterveningIfClause } from './triggeredAbilitiesInterveningIf';
import type { TriggerEventData } from './triggeredAbilitiesEventData';
import { TriggerEvent, type TriggeredAbility, type TriggerEvent as TriggerEventType } from './triggeredAbilitiesTypes';

/**
 * Check if an event would trigger an ability.
 */
export function checkTrigger(
  ability: TriggeredAbility,
  event: TriggerEventType,
  eventData?: TriggerEventData
): boolean {
  const eventMatches =
    ability.event === event ||
    (event === TriggerEvent.DIES && ability.event === TriggerEvent.CONTROLLED_CREATURE_DIED);

  if (!eventMatches) {
    return false;
  }

  if (ability.triggerFilter) {
    const triggerFilter = String(ability.triggerFilter || '').toLowerCase();
    if (triggerFilter.includes('another creature')) {
      const triggeringPermanentId = String(eventData?.targetPermanentId || eventData?.sourceId || '').trim();
      if (triggeringPermanentId && triggeringPermanentId === String(ability.sourceId || '').trim()) {
        return false;
      }
    }

    if (!evaluateTriggerCondition(ability.triggerFilter, ability.controllerId, eventData, ability.sourceId)) {
      return false;
    }
  }

  const resolvedInterveningIfClause = resolveInterveningIfClause(ability);
  if (resolvedInterveningIfClause) {
    if (!evaluateTriggerCondition(resolvedInterveningIfClause, ability.controllerId, eventData, ability.sourceId)) {
      return false;
    }
  }

  if (ability.condition && !ability.triggerFilter && !resolvedInterveningIfClause) {
    if (!evaluateTriggerCondition(ability.condition, ability.controllerId, eventData, ability.sourceId)) {
      return false;
    }
  }

  return true;
}

export function findTriggeringAbilities(
  abilities: readonly TriggeredAbility[],
  event: TriggerEventType,
  eventData?: TriggerEventData
): TriggeredAbility[] {
  return abilities.filter(ability => checkTrigger(ability, event, eventData));
}
