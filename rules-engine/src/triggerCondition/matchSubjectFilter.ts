/**
 * Trigger-condition subject filter: does one permanent satisfy a parsed subject
 * (types, excluded words, counters, keywords...). Used by match.ts and matchQualifiers.ts.
 */

import type { TriggerMatchContext, TriggerMatchPermanent, TriggerMatchSource, TriggerSubjectFilter } from './types.js';

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

export function subjectFilterMatches(
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
    const actual = stat.stat === 'power' ? subject.power : stat.stat === 'toughness' ? subject.toughness : subject.manaValue;
    if (actual === undefined || !Number.isFinite(actual)) return false;
    if (stat.op === 'gte' && actual < stat.value) return false;
    if (stat.op === 'lte' && actual > stat.value) return false;
  }
  if (filter.chosenType) {
    const chosen = String(source.chosenCreatureType || '').trim().toLowerCase();
    if (!chosen) return false;
    if (!typeLineHasWord(typeLine, chosen) && !subject.hasAllCreatureTypes) return false;
  }
  if (filter.chosenColor) {
    const chosen = String(source.chosenColor || '').trim().toLowerCase();
    const letter = ({ white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g' } as Record<string, string>)[chosen] || chosen;
    if (!letter || !Array.isArray(subject.colors) || !subject.colors.map(String).map((c) => c.toLowerCase()).includes(letter)) return false;
  }
  if (filter.dealtDamageBy === 'source' && !context?.dealtDamageBySource) return false;
  if (filter.dealtDamageBy === 'equipped' && !context?.dealtDamageByEquipped) return false;
  if (filter.faceDown && !subject.faceDown) return false;
  if (filter.goaded && !subject.goaded) return false;
  if (filter.modified && subject.modified !== true) return false;
  if (filter.suspected && (subject as any).suspected !== true) return false;
  if (filter.doubleFaced && (subject as any).doubleFaced !== true) return false;
  if (filter.excludeBasicLand) {
    const tl = String(subject.typeLine || '');
    if (/\bbasic\b/i.test(tl) && /\bland\b/i.test(tl)) return false;
  }
  if (filter.keywordsWithAny && filter.keywordsWithAny.length > 0) {
    const kws = (subject.keywords || []).map((k) => String(k).toLowerCase());
    if (!filter.keywordsWithAny.some((k) => kws.includes(String(k).toLowerCase()))) return false;
  }
  if (filter.equipped && subject.equipped !== true) return false;
  if (filter.powerAboveBase) {
    const power = subject.power;
    const base = subject.basePower;
    if (power === undefined || base === undefined || !Number.isFinite(power) || !Number.isFinite(base) || power <= base) return false;
  }
  if (filter.attackingOrBlocking && !subject.attackingOrBlocking) return false;
  if (filter.combatRole === 'attacking' && subject.attacking !== true) return false;
  if (filter.combatRole === 'blocking' && subject.blocking !== true) return false;
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
  if (filter.colorsAll && filter.colorsAll.length > 0) {
    const colors = (subject.colors || []).map((color) => String(color || '').toLowerCase());
    if (!filter.colorsAll.every((color) => colors.includes(String(color).toLowerCase()))) return false;
  }
  if (filter.kicked && !subject.kicked) return false;
  if (filter.colorCount) {
    if (!Array.isArray(subject.colors)) return false;
    const count = new Set(subject.colors.map((color) => String(color || '').toLowerCase()).filter(Boolean)).size;
    if (filter.colorCount === 'colorless' && count !== 0) return false;
    if (filter.colorCount === 'monocolored' && count !== 1) return false;
    if (filter.colorCount === 'multicolored' && count < 2) return false;
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
    filter.commander || filter.historic || (filter.colors && filter.colors.length > 0) || (filter.colorsAll && filter.colorsAll.length > 0) || Boolean(filter.colorCount) || Boolean(filter.kicked),
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
