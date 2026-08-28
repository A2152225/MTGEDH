// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParseHelpers.ts
// Origin parent: server/src/state/modules/staticEffectSpecOracleParsing.ts
// Cluster moved: ABILITY_WORDS through buildSpec (shared oracle-static parse helpers).
// Public entry symbols: ABILITY_WORDS, COLOR_WORDS, parseCardCountWord, parseBuffSegment,
//   parseAbilitiesFromTail, resolveChosenOptionsFromPermanent, pushPlayerAbilityGrantsFromList,
//   parseLordAbilitiesFromTail, parseLordCreatureType, buildSpec.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import { extractQuotedAbilityTexts } from '../../../../../shared/src/attachmentAbilityGrants.js';
import { isCreatureTypeWord, normalizeCreatureTypeWord } from '../../../../../shared/src/creatureTypes.js';
import type { StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpec.js';

export const ABILITY_WORDS = [
  'flying', 'indestructible', 'vigilance', 'trample', 'hexproof', 'shroud',
  'deathtouch', 'lifelink', 'haste', 'menace', 'reach', 'first strike',
  'double strike', 'protection', 'ward',
  'swampwalk', 'islandwalk', 'mountainwalk', 'forestwalk', 'plainswalk',
  'riot', 'exalted', 'skulk', 'intimidate', 'myriad',
  'wither', 'fear', 'horsemanship', 'prowess', 'training',
  'evolve', 'dethrone', 'unleash', 'melee', 'exploit', 'extort',
];

export const COLOR_WORDS = ['white', 'blue', 'black', 'red', 'green'];

const TAP_FOR_COLOR_GRANT: Record<string, string> = {
  w: 'tap_for_white',
  u: 'tap_for_blue',
  b: 'tap_for_black',
  r: 'tap_for_red',
  g: 'tap_for_green',
  c: 'tap_for_colorless',
};

export type StaticEffectSpecSource = {
  sourcePermanentId: string;
  sourceController: string;
  sourceName: string;
};

const SMALL_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1,
};

export function parseCardCountWord(raw: string): number | undefined {
  const lower = String(raw || '').toLowerCase();
  if (SMALL_NUMBER_WORDS[lower] !== undefined) return SMALL_NUMBER_WORDS[lower];
  const parsed = parseInt(lower, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseBuffSegment(seg: string): { power: number; toughness: number } | null {
  const match = String(seg || '').match(/([+-]?\d+)\s*\/\s*([+-]?\d+)/);
  if (!match) return null;
  const power = parseInt(match[1], 10);
  const toughness = parseInt(match[2], 10);
  if (Number.isNaN(power) || Number.isNaN(toughness)) return null;
  return { power, toughness };
}

export function parseAbilitiesFromTail(tail: string): string[] {
  const found: string[] = [];
  const text = String(tail || '');
  const lower = text.toLowerCase();
  for (const ability of ABILITY_WORDS) {
    if (new RegExp(`\\b${ability}\\b`, 'i').test(lower)) {
      found.push(ability);
    }
  }
  for (const match of lower.matchAll(/\b(afflict|toxic|fabricate|annihilator|bushido|rampage)\s+(\d+)\b/g)) {
    found.push(`${match[1]} ${match[2]}`);
  }
  const outlastMatch = lower.match(/\boutlast\s+(\{[^}]+\})/i);
  if (outlastMatch) found.push(`outlast ${outlastMatch[1]}`);
  if (/\{t\}(?:,[^:]*)?:\s*add\s+(?:one\s+)?mana of any(?: one)?(?: of this creature's)? color/i.test(lower)) {
    found.push('tap_for_any_color');
  }
  const tapAddMatch = lower.match(/\{t\}(?:,[^:]*)?:\s*add\s+([^.]+)/i);
  if (tapAddMatch && !/any\s+color/i.test(tapAddMatch[1])) {
    for (const symbolMatch of tapAddMatch[1].matchAll(/\{([wubrgc])\}/gi)) {
      const grant = TAP_FOR_COLOR_GRANT[String(symbolMatch[1] || '').toLowerCase()];
      if (grant) found.push(grant);
    }
  }
  for (const quoted of extractQuotedAbilityTexts(text)) {
    const trimmed = String(quoted || '').trim();
    if (trimmed) found.push(trimmed);
  }
  return [...new Set(found)];
}

export function resolveChosenOptionsFromPermanent(perm: BattlefieldPermanent): string[] {
  const chosenValues = Array.isArray((perm as any)?.chosenOptions)
    ? (perm as any).chosenOptions
    : [((perm as any)?.chosenOption ?? '')];
  return chosenValues
    .map((value: unknown) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length > 0 && ABILITY_WORDS.includes(value));
}

export function pushPlayerAbilityGrantsFromList(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  idSuffix: string,
  abilities: readonly string[],
): void {
  if (abilities.includes('hexproof')) {
    specs.push(buildSpec(
      source,
      `${idSuffix}-player-hexproof`,
      { kind: 'player_you' },
      { playerHexproof: true },
    ));
  }
  if (abilities.includes('shroud')) {
    specs.push(buildSpec(
      source,
      `${idSuffix}-player-shroud`,
      { kind: 'player_you' },
      { playerShroud: true },
    ));
  }
}

export function parseLordAbilitiesFromTail(tail: string): string[] {
  if (/abilities of your choice among/i.test(tail)) {
    return [];
  }
  return parseAbilitiesFromTail(tail);
}

export function parseLordCreatureType(raw: string): string {
  const lower = String(raw || '').trim().toLowerCase();
  if (!lower) return '';
  const normalized = normalizeCreatureTypeWord(lower);
  if (normalized) return normalized;
  // "Pegasus" / "Homunculus" already end in s; do not strip a valid type to "pegasu".
  if (isCreatureTypeWord(lower)) return lower;
  if (lower.endsWith('s') && lower.length > 2) {
    return lower.slice(0, -1);
  }
  return lower;
}

export function buildSpec(
  source: StaticEffectSpecSource,
  idSuffix: string,
  scope: StaticEffectSpec['scope'],
  grant: StaticEffectGrant,
  condition?: StaticEffectSpec['condition'],
): StaticEffectSpec {
  return {
    id: `${source.sourcePermanentId}:${idSuffix}`,
    scope,
    grant,
    condition,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
}
