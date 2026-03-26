import type { PlayerID } from '../../shared/src';
import type { TriggerEventData } from './triggeredAbilitiesEventData';

function evaluateDiesSubjectDescriptor(
  descriptor: string,
  permanentTypes: ReadonlySet<string>,
  creatureTypes: ReadonlySet<string>,
  isToken: boolean,
  colors: ReadonlySet<string>,
  isFaceDown: boolean
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

    if (normalizedCandidates.includes('face-down') || normalizedCandidates.includes('facedown')) {
      if (!isFaceDown) return false;
      continue;
    }

    const negativeMatch = normalizedToken.match(/^non-?(.+)$/);
    if (negativeMatch) {
      const negativeType = String(negativeMatch[1] || '').trim();
      if ((negativeType === 'face-down' || negativeType === 'facedown') && isFaceDown) {
        return false;
      }
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
  const sourceAttachedToPermanentIds = new Set(
    (eventData.sourceAttachedToPermanentIds || [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  const damagedByPermanentIds = new Set(
    (eventData.damagedByPermanentIds || [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  const normalizedSourceId = String(sourceId || '').trim();
  const triggeringPermanentId = String(eventData.targetPermanentId || eventData.sourceId || '').trim();
  const isToken = eventData.sourceIsToken === true || (eventData as any).isToken === true;
  const isFaceDown = eventData.sourceIsFaceDown === true || (eventData as any).faceDown === true;

  if (
    /^this (?:creature|permanent|card|artifact|enchantment|land|planeswalker|battle)\b/i.test(condition) &&
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
    (/^(?:enchanted creature|equipped creature|enchanted land|enchanted permanent)\b/i.test(condition)) &&
    (!normalizedSourceId || !attachedByPermanentIds.has(normalizedSourceId))
  ) {
    return false;
  }

  if (/\bdealt damage by this creature this turn\b/i.test(condition)) {
    return Boolean(normalizedSourceId) && damagedByPermanentIds.has(normalizedSourceId);
  }

  if (/\bdealt damage by equipped creature this turn\b/i.test(condition)) {
    if (damagedByPermanentIds.size === 0 || sourceAttachedToPermanentIds.size === 0) {
      return false;
    }

    for (const permanentId of sourceAttachedToPermanentIds) {
      if (damagedByPermanentIds.has(permanentId)) {
        return true;
      }
    }

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
    if (!evaluateDiesSubjectDescriptor(descriptor, permanentTypes, creatureTypes, isToken, colors, isFaceDown)) {
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

export function evaluateDefendingPlayerLifeLeadCondition(
  condition: string,
  eventData: TriggerEventData
): boolean {
  const normalized = String(condition || '').trim().toLowerCase();
  if (
    normalized !== 'defending player has the most life or is tied for the most life' &&
    normalized !== 'the defending player has the most life or is tied for the most life'
  ) {
    return false;
  }

  const defendingPlayerId = String(eventData.targetOpponentId || eventData.targetPlayerId || '').trim();
  const lifeTotals = eventData.playerLifeTotals || {};
  const defendingLife = Number((lifeTotals as any)?.[defendingPlayerId]);
  if (!defendingPlayerId || !Number.isFinite(defendingLife)) {
    return false;
  }

  const allLifeTotals = Object.values(lifeTotals)
    .map(value => Number(value))
    .filter(value => Number.isFinite(value));
  if (allLifeTotals.length === 0) {
    return false;
  }

  const maxLife = Math.max(...allLifeTotals);
  return defendingLife === maxLife;
}

export function evaluateRenownedCondition(
  condition: string,
  eventData: TriggerEventData
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  if (
    normalized !== "this creature isn't renowned" &&
    normalized !== "this permanent isn't renowned" &&
    normalized !== "it isn't renowned" &&
    normalized !== "this creature is not renowned" &&
    normalized !== "this permanent is not renowned" &&
    normalized !== "it is not renowned"
  ) {
    return null;
  }

  if (typeof eventData.sourceRenowned !== 'boolean') return null;
  return eventData.sourceRenowned === false;
}

export function evaluateNoNamedCounterCondition(
  condition: string,
  eventData: TriggerEventData
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  const match = normalized.match(
    /^(?:it|this creature|this permanent)\s+had\s+no\s+(?:an?\s+)?([^,.]+?)\s+counters?\s+on\s+it$/
  );
  if (!match) return null;

  const wantedCounter = String(match[1] || '').trim().toLowerCase();
  if (!wantedCounter) return null;

  const counters = (eventData.counters || {}) as Record<string, number>;
  const hasMatchingCounter = Object.entries(counters).some(
    ([name, amount]) => String(name || '').trim().toLowerCase() === wantedCounter && Number(amount) > 0
  );
  return !hasMatchingCounter;
}

export function evaluateTrainingAttackCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  if (normalized !== "this creature and at least one other creature with power greater than this creature's power attack") {
    return null;
  }

  const normalizedSourceId = String(sourceId || eventData.sourceId || '').trim();
  const battlefield = Array.isArray(eventData.battlefield) ? eventData.battlefield : [];
  const source = battlefield.find(entry => String(entry?.id || '').trim() === normalizedSourceId);
  if (!source) return false;

  const sourceControllerId = String(source.controllerId || eventData.sourceControllerId || controllerId || '').trim();
  const sourcePower = Number(source.power);
  const sourceIsAttacking = Boolean(source.attacking || source.defendingPlayerId || source.attackingPlayerId);
  if (!sourceControllerId || !sourceIsAttacking || !Number.isFinite(sourcePower)) {
    return false;
  }

  return battlefield.some(entry => {
    const entryId = String(entry?.id || '').trim();
    if (!entryId || entryId === normalizedSourceId) return false;
    if (String(entry?.controllerId || '').trim() !== sourceControllerId) return false;
    if (!entry?.types?.some(type => String(type || '').toLowerCase() === 'creature')) return false;

    const isAttacking = Boolean(entry.attacking || entry.defendingPlayerId || entry.attackingPlayerId);
    const power = Number(entry.power);
    return isAttacking && Number.isFinite(power) && power > sourcePower;
  });
}

export function evaluateBattalionAttackCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  if (normalized !== 'this and at least two other creatures attack') {
    return null;
  }

  const normalizedSourceId = String(sourceId || eventData.sourceId || '').trim();
  const battlefield = Array.isArray(eventData.battlefield) ? eventData.battlefield : [];
  const source = battlefield.find(entry => String(entry?.id || '').trim() === normalizedSourceId);
  if (!source) return false;

  const sourceControllerId = String(source.controllerId || eventData.sourceControllerId || controllerId || '').trim();
  const sourceIsAttacking = Boolean(source.attacking || source.defendingPlayerId || source.attackingPlayerId);
  const sourceIsCreature = Boolean(source.types?.some(type => String(type || '').toLowerCase() === 'creature'));
  if (!sourceControllerId || !sourceIsAttacking || !sourceIsCreature) {
    return false;
  }

  let otherAttackingCreatures = 0;
  for (const entry of battlefield) {
    const entryId = String(entry?.id || '').trim();
    if (!entryId || entryId === normalizedSourceId) continue;
    if (String(entry?.controllerId || '').trim() !== sourceControllerId) continue;
    if (!entry?.types?.some(type => String(type || '').toLowerCase() === 'creature')) continue;

    const isAttacking = Boolean(entry.attacking || entry.defendingPlayerId || entry.attackingPlayerId);
    if (!isAttacking) continue;

    otherAttackingCreatures += 1;
    if (otherAttackingCreatures >= 2) return true;
  }

  return false;
}

export function evaluateControlledPermanentEntersCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  const match = normalized.match(/^(?:a|an)\s+([a-z][a-z -]*)\s+enters(?:\s+the\s+battlefield)?\s+under\s+your\s+control$/);
  if (!match) {
    return null;
  }

  const enteringPermanentId = String(eventData.targetPermanentId || eventData.sourceId || '').trim();
  const normalizedSourceId = String(sourceId || '').trim();
  if (!enteringPermanentId) return false;
  if (normalizedSourceId && enteringPermanentId === normalizedSourceId) {
    return false;
  }

  const battlefield = Array.isArray(eventData.battlefield) ? eventData.battlefield : [];
  const enteringPermanent = battlefield.find(entry => String(entry?.id || '').trim() === enteringPermanentId);
  if (!enteringPermanent) return false;

  const enteringControllerId = String(
    enteringPermanent.controllerId || eventData.sourceControllerId || controllerId || ''
  ).trim();
  if (!enteringControllerId || enteringControllerId !== String(controllerId || '').trim()) {
    return false;
  }

  const wantedType = String(match[1] || '').trim().toLowerCase();
  if (!wantedType || wantedType === 'permanent') return true;

  return Boolean(
    enteringPermanent.types?.some(type => String(type || '').trim().toLowerCase() === wantedType)
  );
}

export function evaluateTargetedSpellCastCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  if (
    normalized !== 'you cast a spell that targets this creature' &&
    normalized !== 'you cast a spell that targets this permanent'
  ) {
    return null;
  }

  const normalizedSourceId = String(sourceId || '').trim();
  const triggeringControllerId = String(eventData.sourceControllerId || '').trim();
  if (!normalizedSourceId || !triggeringControllerId) {
    return false;
  }

  if (triggeringControllerId !== String(controllerId || '').trim()) {
    return false;
  }

  const targetedIds = new Set(
    [
      String(eventData.targetPermanentId || '').trim(),
      String(eventData.targetId || '').trim(),
      ...(
        Array.isArray(eventData.chosenObjectIds)
          ? eventData.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
          : []
      ),
    ].filter(Boolean)
  );

  return targetedIds.has(normalizedSourceId);
}

export function evaluateSelfCastSpellCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  if (
    normalized !== 'you cast this spell' &&
    normalized !== 'you cast this card'
  ) {
    return null;
  }

  const normalizedSourceId = String(sourceId || '').trim();
  const triggeringSpellId = String(eventData.sourceId || '').trim();
  const triggeringControllerId = String(eventData.sourceControllerId || '').trim();
  if (!normalizedSourceId || !triggeringSpellId || !triggeringControllerId) {
    return false;
  }

  return normalizedSourceId === triggeringSpellId && triggeringControllerId === String(controllerId || '').trim();
}

export function evaluateQualifiedSpellCastCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  const triggeringControllerId = String(eventData.sourceControllerId || '').trim();
  const normalizedControllerId = String(controllerId || '').trim();
  const spellType = String(eventData.spellType || '').trim().toLowerCase();
  const isCreatureSpell = spellType.includes('creature');
  const isInstantOrSorcerySpell = spellType.includes('instant') || spellType.includes('sorcery');
  const isOpponentCast = Boolean(triggeringControllerId) && triggeringControllerId !== normalizedControllerId;
  const isSelfCast = Boolean(triggeringControllerId) && triggeringControllerId === normalizedControllerId;

  switch (normalized) {
    case 'you cast a spell':
      return isSelfCast;
    case 'an opponent casts a spell':
    case 'opponent casts a spell':
      return isOpponentCast;
    case 'you cast a noncreature spell':
      return isSelfCast && !isCreatureSpell;
    case 'an opponent casts a noncreature spell':
    case 'opponent casts a noncreature spell':
      return isOpponentCast && !isCreatureSpell;
    case 'you cast an instant or sorcery spell':
      return isSelfCast && isInstantOrSorcerySpell;
    case 'an opponent casts an instant or sorcery spell':
    case 'opponent casts an instant or sorcery spell':
      return isOpponentCast && isInstantOrSorcerySpell;
    case 'an opponent casts their first noncreature spell each turn':
    case 'opponent casts their first noncreature spell each turn':
      return (
        isOpponentCast &&
        !isCreatureSpell &&
        Number(eventData.noncreatureSpellCastCountThisTurn || 0) === 1
      );
    default:
      return null;
  }
}

export function evaluateEvolveEntersCondition(
  condition: string,
  controllerId: PlayerID | string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  if (normalized !== 'another creature enters the battlefield under your control') {
    return null;
  }

  const enteringPermanentId = String(eventData.targetPermanentId || eventData.sourceId || '').trim();
  const normalizedSourceId = String(sourceId || '').trim();
  if (!enteringPermanentId) return false;
  if (normalizedSourceId && enteringPermanentId === normalizedSourceId) return false;

  const battlefield = Array.isArray(eventData.battlefield) ? eventData.battlefield : [];
  const enteringPermanent = battlefield.find(entry => String(entry?.id || '').trim() === enteringPermanentId);
  if (!enteringPermanent) return false;

  const enteringControllerId = String(
    enteringPermanent.controllerId || eventData.sourceControllerId || controllerId || ''
  ).trim();
  if (!enteringControllerId || enteringControllerId !== String(controllerId || '').trim()) {
    return false;
  }

  return Boolean(enteringPermanent.types?.some(type => String(type || '').toLowerCase() === 'creature'));
}

export function evaluateSelfEntersBattlefieldCondition(
  condition: string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  const match = normalized.match(/^this\s+([a-z ]+?)\s+enters(?:\s+the\s+battlefield)?$/i);
  if (!match) {
    return null;
  }

  const triggeringPermanentId = String(eventData.targetPermanentId || eventData.sourceId || '').trim();
  const normalizedSourceId = String(sourceId || '').trim();
  if (!triggeringPermanentId || !normalizedSourceId || triggeringPermanentId !== normalizedSourceId) {
    return false;
  }

  const subject = String(match[1] || '').trim().toLowerCase();
  if (!subject || subject === 'permanent') {
    return true;
  }

  const battlefield = Array.isArray(eventData.battlefield) ? eventData.battlefield : [];
  const triggeringPermanent = battlefield.find(entry => String(entry?.id || '').trim() === triggeringPermanentId);
  if (!triggeringPermanent) return false;

  return Boolean(triggeringPermanent.types?.some(type => String(type || '').toLowerCase() === subject));
}

export function evaluateEvolveComparisonCondition(
  condition: string,
  eventData: TriggerEventData,
  sourceId?: string
): boolean | null {
  const normalized = String(condition || '').trim().toLowerCase();
  if (
    normalized !== "that creature's power is greater than this creature's power or that creature's toughness is greater than this creature's toughness"
  ) {
    return null;
  }

  const battlefield = Array.isArray(eventData.battlefield) ? eventData.battlefield : [];
  const evolvingCreatureId = String(sourceId || '').trim();
  const enteringPermanentId = String(eventData.targetPermanentId || eventData.sourceId || '').trim();
  if (!evolvingCreatureId || !enteringPermanentId || evolvingCreatureId === enteringPermanentId) {
    return false;
  }

  const evolvingCreature = battlefield.find(entry => String(entry?.id || '').trim() === evolvingCreatureId);
  const enteringCreature = battlefield.find(entry => String(entry?.id || '').trim() === enteringPermanentId);
  if (!evolvingCreature || !enteringCreature) return false;

  const evolvingPower = Number(evolvingCreature.power);
  const evolvingToughness = Number(evolvingCreature.toughness);
  const enteringPower = Number(enteringCreature.power);
  const enteringToughness = Number(enteringCreature.toughness);
  if (
    !Number.isFinite(evolvingPower) ||
    !Number.isFinite(evolvingToughness) ||
    !Number.isFinite(enteringPower) ||
    !Number.isFinite(enteringToughness)
  ) {
    return false;
  }

  return enteringPower > evolvingPower || enteringToughness > evolvingToughness;
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
