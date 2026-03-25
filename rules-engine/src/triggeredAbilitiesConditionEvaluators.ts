import type { PlayerID } from '../../shared/src';
import type { TriggerEventData } from './triggeredAbilitiesEventData';

function evaluateDiesSubjectDescriptor(
  descriptor: string,
  permanentTypes: ReadonlySet<string>,
  creatureTypes: ReadonlySet<string>,
  isToken: boolean,
  colors: ReadonlySet<string>
): boolean {
  const cleaned = String(descriptor || '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return true;

  const tokens = cleaned
    .split(/\s+/)
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);
  const ignored = new Set(['a', 'an', 'another', 'additional']);
  const normalizeToken = (token: string): string[] => {
    const normalized = String(token || '').trim().toLowerCase();
    if (!normalized) return [];
    const candidates = new Set<string>([normalized]);
    if (normalized.endsWith('ies') && normalized.length > 3) {
      candidates.add(`${normalized.slice(0, -3)}y`);
    }
    if (normalized.endsWith('es') && normalized.length > 2) {
      candidates.add(normalized.slice(0, -2));
    }
    if (normalized.endsWith('s') && normalized.length > 1) {
      candidates.add(normalized.slice(0, -1));
    }
    return [...candidates];
  };

  for (const token of tokens) {
    if (ignored.has(token)) continue;
    const normalizedCandidates = normalizeToken(token);
    const [normalizedToken] = normalizedCandidates;
    if (!normalizedToken) continue;

    if (normalizedCandidates.includes('nontoken')) {
      if (isToken) return false;
      continue;
    }

    if (normalizedCandidates.includes('token')) {
      if (!isToken) return false;
      continue;
    }

    if (normalizedCandidates.includes('multicolored')) {
      if (colors.size < 2) return false;
      continue;
    }

    const negativeMatch = normalizedToken.match(/^non-?(.+)$/);
    if (negativeMatch) {
      const negativeType = String(negativeMatch[1] || '').trim();
      if (negativeType && (permanentTypes.has(negativeType) || creatureTypes.has(negativeType))) {
        return false;
      }
      continue;
    }

    if (
      normalizedCandidates.includes('creature') ||
      normalizedCandidates.includes('land') ||
      normalizedCandidates.includes('artifact') ||
      normalizedCandidates.includes('enchantment') ||
      normalizedCandidates.includes('planeswalker') ||
      normalizedCandidates.includes('battle') ||
      normalizedCandidates.includes('permanent')
    ) {
      if (normalizedCandidates.includes('permanent')) {
        if (permanentTypes.size === 0) return false;
      } else if (!normalizedCandidates.some(candidate => permanentTypes.has(candidate))) {
        return false;
      }
      continue;
    }

    if (!normalizedCandidates.some(candidate => creatureTypes.has(candidate))) {
      return false;
    }
  }

  return true;
}

export function evaluateDiesTriggerCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean {
  const isPutIntoGraveyardFromBattlefield =
    /\bis put into (?:(?:a|an|your|its owner's|their owner's)\s+)?graveyard from the battlefield\b/i.test(condition);
  const isDiesStyleCondition = condition.includes('dies') || /\bdie\b/i.test(condition) || isPutIntoGraveyardFromBattlefield;
  if (!isDiesStyleCondition) {
    return false;
  }

  const subjectControllerId = String(eventData.sourceControllerId || '').trim();
  const subjectOwnerId = String(eventData.sourceOwnerId || '').trim();
  const permanentTypes = new Set((eventData.permanentTypes || []).map(type => String(type).toLowerCase()));
  const creatureTypes = new Set((eventData.creatureTypes || []).map(type => String(type).toLowerCase()));
  const colors = new Set((eventData.colors || []).map(color => String(color).toLowerCase()));
  const counters = eventData.counters || {};
  const keywords = new Set((eventData.keywords || []).map(keyword => String(keyword).toLowerCase()));
  const attachedByPermanentIds = new Set(
    (eventData.attachedByPermanentIds || [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  const normalizedSourceId = String(sourceId || '').trim();
  const triggeringPermanentId = String(eventData.targetPermanentId || eventData.sourceId || '').trim();
  const isToken = eventData.sourceIsToken === true || (eventData as any).isToken === true;

  if (
    /\bthis (?:creature|permanent|card|artifact|enchantment|land|planeswalker|battle)\b/i.test(condition) &&
    normalizedSourceId &&
    triggeringPermanentId &&
    normalizedSourceId !== triggeringPermanentId
  ) {
    return false;
  }

  if (condition.includes('creature') && !permanentTypes.has('creature')) {
    return false;
  }

  if (condition.includes('land') && !permanentTypes.has('land')) {
    return false;
  }

  if (condition.includes('permanent') && permanentTypes.size === 0) {
    return false;
  }

  if (
    (condition.includes('enchanted creature') ||
      condition.includes('equipped creature') ||
      condition.includes('enchanted land') ||
      condition.includes('enchanted permanent')) &&
    (!normalizedSourceId || !attachedByPermanentIds.has(normalizedSourceId))
  ) {
    return false;
  }

  if (condition.includes('you control') && subjectControllerId !== controllerId) {
    return false;
  }

  if (condition.includes('you own') && subjectOwnerId !== String(controllerId).trim()) {
    return false;
  }

  if (
    (condition.includes("you don't control") || condition.includes('you do not control')) &&
    (!subjectControllerId || subjectControllerId === String(controllerId).trim())
  ) {
    return false;
  }

  if (
    (condition.includes("don't own") || condition.includes('dont own') || condition.includes('do not own')) &&
    (!subjectOwnerId || subjectOwnerId === String(controllerId).trim())
  ) {
    return false;
  }

  if (
    (condition.includes('an opponent controls') || condition.includes('opponent controls')) &&
    (!subjectControllerId || subjectControllerId === controllerId)
  ) {
    return false;
  }

  if (condition.includes('without flying') && keywords.has('flying')) {
    return false;
  }

  if (condition.includes('with flying') && !condition.includes('without flying') && !keywords.has('flying')) {
    return false;
  }

  const counterMatch = condition.match(/\bwith\s+(?:an?\s+|one or more\s+)?([^,.]+?)\s+counters?\s+on\s+it\b/i);
  if (counterMatch) {
    const counterName = String(counterMatch[1] || '').trim().toLowerCase();
    const hasMatchingCounter = Object.entries(counters).some(
      ([name, amount]) => String(name || '').trim().toLowerCase() === counterName && Number(amount) > 0
    );
    if (!hasMatchingCounter) {
      return false;
    }
  }

  const subjectDescriptorMatch = condition.match(
    /^(?:(?:one or more|another)\s+)?(?:a|an)?\s*(.+?)\s+(?:you control|you own|you don't control|you do not control|an opponent controls|opponent controls)(?:\s+but\s+(?:don't|dont|do not)\s+own)?(?:\s+with\s+[^,]+?)?\s+dies?$/
  );
  if (subjectDescriptorMatch) {
    const descriptor = String(subjectDescriptorMatch[1] || '').trim();
    if (!evaluateDiesSubjectDescriptor(descriptor, permanentTypes, creatureTypes, isToken, colors)) {
      return false;
    }
  }

  return true;
}

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
