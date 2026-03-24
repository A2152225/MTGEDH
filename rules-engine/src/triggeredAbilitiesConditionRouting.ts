import {
  evaluateControlCondition,
  evaluateGraveyardCondition,
  evaluateHandCondition,
  evaluateLifeTotalCondition,
  evaluateOpponentControlCondition,
  evaluateTapStateTriggerCondition,
} from './triggeredAbilitiesConditionEvaluators';
import type { TriggerEventData } from './triggeredAbilitiesEventData';

/**
 * Evaluate a trigger condition string against the event data.
 */
export function evaluateTriggerCondition(
  condition: string,
  controllerId: string,
  eventData?: TriggerEventData
): boolean {
  if (!condition) {
    return true;
  }

  if (!eventData) {
    const conditionLower = condition.toLowerCase().trim();
    if (conditionLower === 'you' || conditionLower === 'your' ||
        conditionLower === 'opponent' || conditionLower === 'an opponent' ||
        conditionLower === 'each') {
      return false;
    }

    return false;
  }

  const conditionLower = condition.toLowerCase().trim();

  if (conditionLower.includes('becomes tapped') || conditionLower.includes(' become tapped')) {
    return evaluateTapStateTriggerCondition(conditionLower, controllerId, eventData, 'tapped');
  }

  if (conditionLower.includes('becomes untapped') || conditionLower.includes(' become untapped')) {
    return evaluateTapStateTriggerCondition(conditionLower, controllerId, eventData, 'untapped');
  }

  if (conditionLower === 'you' || conditionLower === 'your') {
    return eventData.sourceControllerId === controllerId;
  }

  if (conditionLower === 'opponent' || conditionLower === 'an opponent') {
    return eventData.sourceControllerId !== undefined &&
      eventData.sourceControllerId !== controllerId;
  }

  if (conditionLower === 'each') {
    return true;
  }

  if (conditionLower.includes('if you control') || conditionLower.startsWith('you control ')) {
    return evaluateControlCondition(conditionLower, controllerId, eventData);
  }

  if (conditionLower.includes('if an opponent controls') || conditionLower.startsWith('an opponent controls ')) {
    return evaluateOpponentControlCondition(conditionLower, controllerId, eventData);
  }

  if (conditionLower.includes('life total')) {
    return evaluateLifeTotalCondition(conditionLower, eventData);
  }

  if (conditionLower.includes('graveyard')) {
    return evaluateGraveyardCondition(conditionLower, eventData);
  }

  if (conditionLower.includes('cards in hand') || conditionLower.includes('card in hand')) {
    return evaluateHandCondition(conditionLower, eventData);
  }

  if (conditionLower.includes('your turn')) {
    return eventData.isYourTurn === true;
  }

  if (conditionLower.includes("opponent's turn") || conditionLower.includes('opponents turn')) {
    return eventData.isOpponentsTurn === true;
  }

  return false;
}
