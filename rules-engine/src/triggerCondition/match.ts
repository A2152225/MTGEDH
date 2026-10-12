/**
 * Shared trigger-condition matcher.
 * Public: triggerConditionMatches.
 *
 * Compares a parsed condition to the event's subject and source. It does not
 * read oracle text.
 */

import type {
  TriggerConditionIR,
  TriggerMatchContext,
  TriggerMatchPermanent,
  TriggerMatchSource,
  TriggerSubjectFilter,
} from './types.js';

const CARD_TYPES = new Set([
  'creature',
  'artifact',
  'enchantment',
  'land',
  'planeswalker',
  'battle',
  'instant',
  'sorcery',
  'kindred',
  'tribal',
  'permanent',
  'aura',
  'equipment',
]);

function typeLineHasWord(typeLine: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z])${escaped}(?:$|[^a-z])`, 'i').test(typeLine);
}

function excludedWordPresent(subject: TriggerMatchPermanent, word: string): boolean {
  if (typeLineHasWord(subject.typeLine, word)) return true;
  return Boolean(subject.hasAllCreatureTypes) && !CARD_TYPES.has(word);
}

function counterCount(counters: Readonly<Record<string, number>> | undefined, name?: string): number {
  if (!counters) return 0;
  if (!name) {
    return Object.values(counters).reduce((sum, value) => sum + (Number(value) > 0 ? Number(value) : 0), 0);
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(counters)) {
    if (key.toLowerCase() === wanted) return Number(value) || 0;
  }
  return 0;
}

function subjectFilterMatches(
  filter: TriggerSubjectFilter,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  const typeLine = String(subject.typeLine || '');
  if (filter.token === 'nontoken' && subject.isToken) return false;
  if (filter.token === 'token' && !subject.isToken) return false;
  for (const word of filter.excludedWords) {
    if (excludedWordPresent(subject, word)) return false;
  }
  if (filter.excludedColors && filter.excludedColors.length > 0) {
    const colors = (subject.colors || []).map((color) => String(color || '').toLowerCase());
    if (filter.excludedColors.some((color) => colors.includes(color))) return false;
  }
  for (const supertype of filter.supertypes) {
    if (!typeLineHasWord(typeLine, supertype)) return false;
  }
  const keywords = (subject.keywords || []).map((keyword) => String(keyword || '').toLowerCase());
  for (const keyword of filter.keywordsWith) {
    if (!keywords.includes(keyword)) return false;
  }
  for (const keyword of filter.keywordsWithout) {
    if (keywords.includes(keyword)) return false;
  }
  for (const counter of filter.counters || []) {
    if (counterCount(subject.counters, counter.name) < counter.minimum) return false;
  }
  for (const stat of filter.stats || []) {
    const actual = stat.stat === 'power' ? subject.power : subject.toughness;
    if (actual === undefined || !Number.isFinite(actual)) return false;
    if (stat.op === 'gte' && actual < stat.value) return false;
    if (stat.op === 'lte' && actual > stat.value) return false;
  }
  if (filter.chosenType) {
    const chosen = String(source.chosenCreatureType || '').trim().toLowerCase();
    if (!chosen) return false;
    if (!typeLineHasWord(typeLine, chosen) && !subject.hasAllCreatureTypes) return false;
  }
  if (filter.dealtDamageBy === 'source' && !context?.dealtDamageBySource) return false;
  if (filter.dealtDamageBy === 'equipped' && !context?.dealtDamageByEquipped) return false;
  if (filter.faceDown && !subject.faceDown) return false;
  if (filter.goaded && !subject.goaded) return false;
  if (filter.attackingOrBlocking && !subject.attackingOrBlocking) return false;
  if (filter.commander && !subject.isCommander) return false;
  if (filter.historic) {
    const historic = typeLineHasWord(typeLine, 'artifact')
      || typeLineHasWord(typeLine, 'legendary')
      || typeLineHasWord(typeLine, 'saga');
    if (!historic) return false;
  }
  if (filter.colors && filter.colors.length > 0) {
    const colors = (subject.colors || []).map((color) => String(color || '').toLowerCase());
    if (!filter.colors.some((color) => colors.includes(color))) return false;
  }
  if (filter.owner === 'you' || filter.owner === 'not_you') {
    const ownerId = String(subject.ownerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!ownerId || !sourceController) return false;
    if (filter.owner === 'you' && ownerId !== sourceController) return false;
    if (filter.owner === 'not_you' && ownerId === sourceController) return false;
  }

  if (filter.groups && filter.groups.length > 0) {
    return filter.groups.some((group) => {
      if (group.types.length === 0 && group.subtypes.length === 0) return filter.anyObject;
      if (!group.types.every((word) => typeLineHasWord(typeLine, word))) return false;
      return group.subtypes.every((word) => typeLineHasWord(typeLine, word) || Boolean(subject.hasAllCreatureTypes));
    });
  }

  const pairCount = Math.max(filter.typeGroups.length, filter.subtypeGroups.length);
  if (pairCount === 0) return filter.anyObject || Boolean(
    filter.commander || filter.historic || (filter.colors && filter.colors.length > 0),
  );
  return Array.from({ length: pairCount }, (_, index) => index).some((index) => {
    const types = filter.typeGroups[index] || [];
    const subtypes = filter.subtypeGroups[index] || [];
    if (types.length === 0 && subtypes.length === 0) return false;
    if (types.length > 0 && !types.every((word) => typeLineHasWord(typeLine, word))) return false;
    if (subtypes.length > 0 && !subtypes.every((word) => (
      typeLineHasWord(typeLine, word) || Boolean(subject.hasAllCreatureTypes)
    ))) {
      return false;
    }
    return true;
  });
}

function alternativeMatches(
  alternative: TriggerConditionIR['alternatives'][number],
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  const subjectId = String(subject.id || '').trim();
  const sourceId = String(source.id || '').trim();
  if (alternative.source === 'another' && subjectId && sourceId && subjectId === sourceId) {
    return false;
  }
  if (alternative.source === 'self' && (!subjectId || !sourceId || subjectId !== sourceId)) {
    return false;
  }
  if (alternative.source === 'self_or_another' && (!subjectId || !sourceId)) {
    return false;
  }
  if (alternative.source === 'enchanted' || alternative.source === 'equipped') {
    const attachedToId = String(source.attachedToId || '').trim();
    if (!attachedToId || !subjectId || attachedToId !== subjectId) return false;
  }

  const subjectController = String(subject.controllerId || '').trim();
  const sourceController = String(source.controllerId || '').trim();
  if (alternative.controller === 'you' && subjectController !== sourceController) return false;
  if (alternative.controller === 'not_you' && subjectController === sourceController) return false;

  return subjectFilterMatches(alternative.subject, subject, source, context);
}

function qualifiersMatch(
  condition: TriggerConditionIR,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  if (condition.castFromZone) {
    const zone = String(context?.castFromZone || '').trim().toLowerCase();
    // Fail closed: an unknown zone never satisfies "from anywhere other than your hand"
    // or "from exile/graveyard/library". Only "from your hand" tolerates a missing zone,
    // because casts default to the hand.
    if (condition.castFromZone === 'not_hand') {
      if (!zone || zone === 'hand') return false;
    } else if (condition.castFromZone === 'hand') {
      if (zone && zone !== 'hand') return false;
    } else if (zone !== condition.castFromZone) {
      return false;
    }
  }

  if (condition.ordinal === 'first' && context?.spellOrdinal !== 1) return false;
  if (condition.ordinal === 'second' && context?.spellOrdinal !== 2) return false;

  if (condition.targets) {
    const targetController = String(context?.targetControllerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!targetController || !sourceController) return false;
    if (condition.targets === 'you' && targetController !== sourceController) return false;
    if (condition.targets === 'opponent' && targetController === sourceController) return false;
  }

  if (condition.whoseTurn) {
    const active = String(context?.activePlayerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!active) return false;
    if (condition.whoseTurn === 'you' && active !== sourceController) return false;
    if (condition.whoseTurn === 'each_opponent' && (!sourceController || active === sourceController)) return false;
    if (condition.whoseTurn === 'enchanted_player' && active !== String(context?.enchantedPlayerId || '').trim()) return false;
    if (condition.whoseTurn === 'monarch' && active !== String(context?.monarchPlayerId || '').trim()) return false;
    if (condition.whoseTurn === 'chosen_player' && active !== String(context?.chosenPlayerId || '').trim()) return false;
    if (condition.whoseTurn === 'enchanted_controller' && active !== String(context?.enchantedControllerId || '').trim()) return false;
    if (condition.whoseTurn === 'exiled_card_owner' && active !== String(context?.exiledCardOwnerId || '').trim()) return false;
  }

  if (condition.fromZone && condition.fromZone !== 'anywhere') {
    const fromZone = String(context?.fromZone || '').trim().toLowerCase();
    if (condition.fromZone === 'not_hand') {
      if (!fromZone || fromZone === 'hand') return false;
    } else if (fromZone !== condition.fromZone) {
      return false;
    }
  }

  if (condition.damageKind === 'combat' && String(context?.damageKind || '').trim().toLowerCase() !== 'combat') return false;
  if (condition.damageKind === 'noncombat' && String(context?.damageKind || '').trim().toLowerCase() === 'combat') return false;

  if (condition.zoneOwner && condition.zoneOwner !== 'any') {
    const zoneOwnerId = String(context?.zoneOwnerId || '').trim();
    const sourceController = String(source.controllerId || '').trim();
    if (!zoneOwnerId || !sourceController) return false;
    if (condition.zoneOwner === 'you' && zoneOwnerId !== sourceController) return false;
    if (condition.zoneOwner === 'not_you' && zoneOwnerId === sourceController) return false;
  }

  return true;
}

function libraryOwnerMatches(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context: TriggerMatchContext | undefined,
): boolean {
  if (!condition.libraryOwner || condition.libraryOwner === 'any') return true;
  const libraryOwnerId = String(context?.libraryOwnerId || '').trim();
  const wanted = condition.libraryOwner === 'source'
    ? String(source.controllerId || '').trim()
    : String(subject.controllerId || '').trim();
  return Boolean(libraryOwnerId && wanted && libraryOwnerId === wanted);
}

export function triggerConditionMatches(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context?: TriggerMatchContext,
): boolean {
  if (!qualifiersMatch(condition, source, context)) return false;
  if (!libraryOwnerMatches(condition, subject, source, context)) return false;
  if (condition.alternatives.length === 0) return Boolean(condition.whoseTurn);
  return condition.alternatives.some((alternative) => alternativeMatches(alternative, subject, source, context));
}
