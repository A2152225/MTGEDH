import { evaluateTriggerCondition } from './triggeredAbilitiesConditionRouting';
import { resolveInterveningIfClause } from './triggeredAbilitiesInterveningIf';
import type { TriggerEventData } from './triggeredAbilitiesEventData';
import { type TriggeredAbility, type TriggerEvent } from './triggeredAbilitiesTypes';

/**
 * Check if an event would trigger an ability.
 */
export function checkTrigger(
  ability: TriggeredAbility,
  event: TriggerEvent,
  eventData?: TriggerEventData
): boolean {
  if (ability.event !== event) {
    return false;
  }

  if (ability.triggerFilter) {
    if (!evaluateTriggerCondition(ability.triggerFilter, ability.controllerId, eventData)) {
      return false;
    }
  }

  const resolvedInterveningIfClause = resolveInterveningIfClause(ability);
  if (resolvedInterveningIfClause) {
    if (!evaluateTriggerCondition(resolvedInterveningIfClause, ability.controllerId, eventData)) {
      return false;
    }
  }

  if (ability.condition && !ability.triggerFilter && !resolvedInterveningIfClause) {
    if (!evaluateTriggerCondition(ability.condition, ability.controllerId, eventData)) {
      return false;
    }
  }

  return true;
}

export function findTriggeringAbilities(
  abilities: readonly TriggeredAbility[],
  event: TriggerEvent,
  eventData?: TriggerEventData
): TriggeredAbility[] {
  return abilities.filter(ability => checkTrigger(ability, event, eventData));
}
