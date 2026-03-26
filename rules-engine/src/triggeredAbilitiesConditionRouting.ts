import {
  evaluateBattalionAttackCondition,
  evaluateControlledPermanentEntersCondition,
  evaluateControlCondition,
  evaluateDefendingPlayerLifeLeadCondition,
  evaluateDiesTriggerCondition,
  evaluateEvolveComparisonCondition,
  evaluateEvolveEntersCondition,
  evaluateGraveyardCondition,
  evaluateHandCondition,
  evaluateLifeTotalCondition,
  evaluateNoNamedCounterCondition,
  evaluateOpponentControlCondition,
  evaluateQualifiedSpellCastCondition,
  evaluateRenownedCondition,
  evaluateSelfBecomesMonstrousCondition,
  evaluateSelfEntersBattlefieldCondition,
  evaluateSelfCastSpellCondition,
  evaluateTargetedSpellCastCondition,
  evaluateTrainingAttackCondition,
  evaluateTapStateTriggerCondition,
} from './triggeredAbilitiesConditionEvaluators';
import type { TriggerEventData } from './triggeredAbilitiesEventData';

function splitCompositeCondition(condition: string, delimiter: 'and' | 'or'): string[] | null {
  const normalized = String(condition || '').trim();
  if (!normalized) return null;
  if (delimiter === 'or' && /\bor\s+(?:more|less)\b/i.test(normalized)) {
    return null;
  }

  const pattern = delimiter === 'and' ? /\s+and\s+/i : /\s+or\s+/i;
  const parts = normalized.split(pattern).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

function evaluateSelfInGraveyardCondition(
  conditionLower: string,
  controllerId: string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  if (
    conditionLower !== 'this card is in your graveyard' &&
    conditionLower !== 'this permanent is in your graveyard' &&
    conditionLower !== 'it is in your graveyard'
  ) {
    return null;
  }

  const controllerGraveyard = Array.isArray(eventData.graveyard) ? eventData.graveyard : [];
  const normalizedSourceId = String(sourceId || '').trim();
  if (normalizedSourceId) {
    return controllerGraveyard.includes(normalizedSourceId);
  }

  return controllerGraveyard.length > 0 && eventData.sourceControllerId === controllerId;
}

function evaluateZoneProvenanceCondition(
  conditionLower: string,
  eventData: TriggerEventData
): boolean | null {
  const castFromGraveyard =
    conditionLower === 'it was cast from your graveyard' ||
    conditionLower === 'you cast it from your graveyard';
  if (castFromGraveyard) {
    return String(eventData.castFromZone || '').trim().toLowerCase() === 'graveyard';
  }

  if (conditionLower === 'it entered from your graveyard') {
    return String(eventData.enteredFromZone || '').trim().toLowerCase() === 'graveyard';
  }

  return null;
}

function evaluateSelfCastCondition(
  conditionLower: string,
  controllerId: string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  if (
    conditionLower !== 'you cast this spell' &&
    conditionLower !== 'you cast this card' &&
    conditionLower !== 'you cast this creature'
  ) {
    return null;
  }

  if (String(eventData.sourceControllerId || '').trim() !== String(controllerId || '').trim()) {
    return false;
  }

  const normalizedSourceId = String(sourceId || '').trim();
  const triggeringSourceId = String(eventData.sourceId || '').trim();
  if (normalizedSourceId && triggeringSourceId) {
    return normalizedSourceId === triggeringSourceId;
  }

  return Boolean(triggeringSourceId);
}

/**
 * Evaluate a trigger condition string against the event data.
 */
export function evaluateTriggerCondition(
  condition: string,
  controllerId: string,
  eventData?: TriggerEventData,
  sourceId?: string
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
  if (
    conditionLower === 'defending player has the most life or is tied for the most life' ||
    conditionLower === 'the defending player has the most life or is tied for the most life'
  ) {
    return evaluateDefendingPlayerLifeLeadCondition(conditionLower, eventData);
  }
  const renowned = evaluateRenownedCondition(conditionLower, eventData);
  if (renowned !== null) {
    return renowned;
  }
  const trainingAttack = evaluateTrainingAttackCondition(conditionLower, controllerId, eventData, sourceId);
  if (trainingAttack !== null) {
    return trainingAttack;
  }
  const battalionAttack = evaluateBattalionAttackCondition(conditionLower, controllerId, eventData, sourceId);
  if (battalionAttack !== null) {
    return battalionAttack;
  }
  const targetedSpellCast = evaluateTargetedSpellCastCondition(conditionLower, controllerId, eventData, sourceId);
  if (targetedSpellCast !== null) {
    return targetedSpellCast;
  }
  const qualifiedSpellCast = evaluateQualifiedSpellCastCondition(conditionLower, controllerId, eventData);
  if (qualifiedSpellCast !== null) {
    return qualifiedSpellCast;
  }
  const selfCastSpell = evaluateSelfCastSpellCondition(conditionLower, controllerId, eventData, sourceId);
  if (selfCastSpell !== null) {
    return selfCastSpell;
  }
  const controlledPermanentEnters = evaluateControlledPermanentEntersCondition(
    conditionLower,
    controllerId,
    eventData,
    sourceId
  );
  if (controlledPermanentEnters !== null) {
    return controlledPermanentEnters;
  }
  const selfEnters = evaluateSelfEntersBattlefieldCondition(conditionLower, eventData, sourceId);
  if (selfEnters !== null) {
    return selfEnters;
  }
  const selfBecomesMonstrous = evaluateSelfBecomesMonstrousCondition(conditionLower, eventData, sourceId);
  if (selfBecomesMonstrous !== null) {
    return selfBecomesMonstrous;
  }
  const evolveEnters = evaluateEvolveEntersCondition(conditionLower, controllerId, eventData, sourceId);
  if (evolveEnters !== null) {
    return evolveEnters;
  }
  const evolveComparison = evaluateEvolveComparisonCondition(conditionLower, eventData, sourceId);
  if (evolveComparison !== null) {
    return evolveComparison;
  }
  const noNamedCounter = evaluateNoNamedCounterCondition(conditionLower, eventData);
  if (noNamedCounter !== null) {
    return noNamedCounter;
  }
  const selfCast = evaluateSelfCastCondition(conditionLower, controllerId, eventData, sourceId);
  if (selfCast !== null) {
    return selfCast;
  }
  const andParts = splitCompositeCondition(conditionLower, 'and');
  if (andParts) {
    return andParts.every(part => evaluateTriggerCondition(part, controllerId, eventData, sourceId));
  }

  const orParts = splitCompositeCondition(conditionLower, 'or');
  if (orParts) {
    return orParts.some(part => evaluateTriggerCondition(part, controllerId, eventData, sourceId));
  }

  const isPutIntoGraveyardFromBattlefield =
    /\bis put into (?:(?:a|an|your|its owner's|their owner's)\s+)?graveyard from the battlefield\b/i.test(conditionLower);
  const isDiesStyleCondition = conditionLower.includes('dies') || /\bdie\b/i.test(conditionLower) || isPutIntoGraveyardFromBattlefield;

  if (isDiesStyleCondition) {
    return evaluateDiesTriggerCondition(conditionLower, controllerId, eventData, sourceId);
  }

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

  const selfInGraveyard = evaluateSelfInGraveyardCondition(conditionLower, controllerId, eventData, sourceId);
  if (selfInGraveyard !== null) {
    return selfInGraveyard;
  }

  const provenance = evaluateZoneProvenanceCondition(conditionLower, eventData);
  if (provenance !== null) {
    return provenance;
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
