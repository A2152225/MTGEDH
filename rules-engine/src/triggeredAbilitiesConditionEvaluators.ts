import type { PlayerID } from '../../shared/src';
import type { TriggerEventData } from './triggeredAbilitiesEventData';

export function evaluateTapStateTriggerCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  expectedState: 'tapped' | 'untapped'
): boolean {
  const statePhrase = expectedState === 'tapped' ? 'becomes tapped' : 'becomes untapped';
  if (!condition.includes(statePhrase) && !condition.includes(` become ${expectedState}`)) {
    return false;
  }

  const subjectControllerId = String(eventData.sourceControllerId || '').trim();
  const permanentTypes = new Set((eventData.permanentTypes || []).map(type => String(type).toLowerCase()));
  const creatureTypes = new Set((eventData.creatureTypes || []).map(type => String(type).toLowerCase()));

  if (condition.includes('you control') && subjectControllerId !== controllerId) {
    return false;
  }

  if ((condition.includes('an opponent controls') || condition.includes('opponent controls')) &&
      (!subjectControllerId || subjectControllerId === controllerId)) {
    return false;
  }

  const typedSubjectMatch = condition.match(
    /(?:a|an|another|one or more)\s+(.+?)\s+(?:you control|an opponent controls|opponent controls)\s+become?s?\s+(?:tapped|untapped)/
  );

  if (typedSubjectMatch) {
    const subjectDescriptor = String(typedSubjectMatch[1] || '').trim();
    if (!subjectDescriptor) return false;

    if (subjectDescriptor.includes('creature')) {
      return permanentTypes.has('creature');
    }

    const relevantSubtypeTokens = subjectDescriptor
      .split(/[^a-z]+/)
      .map(token => token.trim())
      .filter(token => token.length > 0 && !['a', 'an', 'another', 'one', 'or', 'more'].includes(token));

    if (relevantSubtypeTokens.length === 0) {
      return false;
    }

    return relevantSubtypeTokens.every(token => creatureTypes.has(token));
  }

  if (condition.includes('this creature')) {
    return permanentTypes.has('creature');
  }

  if (condition.includes('this permanent')) {
    return permanentTypes.size > 0;
  }

  return true;
}

export function evaluateControlCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData
): boolean {
  const controlledByPlayer = (eventData.battlefield || []).filter(
    p => p.controllerId === controllerId
  );

  if (condition.includes('a creature') || condition.includes('creature')) {
    const creatures = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'creature')
    );

    const countMatch = condition.match(/(\d+)\s+or\s+more\s+creatures?/);
    if (countMatch) {
      return creatures.length >= parseInt(countMatch[1], 10);
    }

    return creatures.length > 0;
  }

  if (condition.includes('an artifact') || condition.includes('artifact')) {
    const artifacts = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'artifact')
    );

    const countMatch = condition.match(/(\d+)\s+or\s+more\s+artifacts?/);
    if (countMatch) {
      return artifacts.length >= parseInt(countMatch[1], 10);
    }

    return artifacts.length > 0;
  }

  if (condition.includes('an enchantment') || condition.includes('enchantment')) {
    const enchantments = controlledByPlayer.filter(
      p => p.types?.some(t => t.toLowerCase() === 'enchantment')
    );

    const countMatch = condition.match(/(\d+)\s+or\s+more\s+enchantments?/);
    if (countMatch) {
      return enchantments.length >= parseInt(countMatch[1], 10);
    }

    return enchantments.length > 0;
  }

  if (condition.includes('permanent')) {
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+permanents?/);
    if (countMatch) {
      return controlledByPlayer.length >= parseInt(countMatch[1], 10);
    }
    return controlledByPlayer.length > 0;
  }

  return true;
}

export function evaluateOpponentControlCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData
): boolean {
  const opponentPermanents = (eventData.battlefield || []).filter(
    p => p.controllerId !== controllerId && p.controllerId !== undefined
  );

  if (condition.includes('creature')) {
    const creatures = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'creature')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+creatures?/);
    if (countMatch) {
      return creatures.length >= parseInt(countMatch[1], 10);
    }
    return creatures.length > 0;
  }

  if (condition.includes('artifact')) {
    const artifacts = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'artifact')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+artifacts?/);
    if (countMatch) {
      return artifacts.length >= parseInt(countMatch[1], 10);
    }
    return artifacts.length > 0;
  }

  if (condition.includes('enchantment')) {
    const enchantments = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'enchantment')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+enchantments?/);
    if (countMatch) {
      return enchantments.length >= parseInt(countMatch[1], 10);
    }
    return enchantments.length > 0;
  }

  if (condition.includes('land')) {
    const lands = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'land')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+lands?/);
    if (countMatch) {
      return lands.length >= parseInt(countMatch[1], 10);
    }
    return lands.length > 0;
  }

  if (condition.includes('planeswalker')) {
    const planeswalkers = opponentPermanents.filter(
      p => p.types?.some(t => t.toLowerCase() === 'planeswalker')
    );
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+planeswalkers?/);
    if (countMatch) {
      return planeswalkers.length >= parseInt(countMatch[1], 10);
    }
    return planeswalkers.length > 0;
  }

  if (condition.includes('permanent')) {
    const countMatch = condition.match(/(\d+)\s+or\s+more\s+permanents?/);
    if (countMatch) {
      return opponentPermanents.length >= parseInt(countMatch[1], 10);
    }
    return opponentPermanents.length > 0;
  }

  return opponentPermanents.length > 0;
}

export function evaluateLifeTotalCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  if (eventData.lifeTotal === undefined) return true;

  const lessMatch = condition.match(/life\s+total\s+is\s+(\d+)\s+or\s+less/);
  if (lessMatch) {
    return eventData.lifeTotal <= parseInt(lessMatch[1], 10);
  }

  const greaterMatch = condition.match(/life\s+total\s+is\s+(\d+)\s+or\s+greater/);
  if (greaterMatch) {
    return eventData.lifeTotal >= parseInt(greaterMatch[1], 10);
  }

  return true;
}

export function evaluateGraveyardCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  const graveyardSize = eventData.graveyard?.length || 0;

  const countMatch = condition.match(/(\d+)\s+or\s+more\s+cards?\s+in/);
  if (countMatch) {
    return graveyardSize >= parseInt(countMatch[1], 10);
  }

  if (condition.includes('creature card')) {
    return graveyardSize > 0;
  }

  return true;
}

export function evaluateHandCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  const handSize = eventData.hand?.length || 0;
  const handSizeAtBeginningOfTurn = eventData.handAtBeginningOfTurn?.length;

  if (condition.includes('at the beginning of this turn')) {
    if (condition.includes('no cards in hand')) {
      return (handSizeAtBeginningOfTurn ?? handSize) === 0;
    }

    if (condition.includes('a card in hand')) {
      return (handSizeAtBeginningOfTurn ?? handSize) > 0;
    }
  }

  const moreMatch = condition.match(/(\d+)\s+or\s+more\s+cards\s+in\s+hand/);
  if (moreMatch) {
    return handSize >= parseInt(moreMatch[1], 10);
  }

  const fewerMatch = condition.match(/(\d+)\s+or\s+fewer\s+cards\s+in\s+hand/);
  if (fewerMatch) {
    return handSize <= parseInt(fewerMatch[1], 10);
  }

  if (condition.includes('no cards in hand')) {
    return handSize === 0;
  }

  return true;
}
