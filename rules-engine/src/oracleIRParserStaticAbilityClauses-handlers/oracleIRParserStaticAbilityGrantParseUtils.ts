/**
 * Origin parent: oracleIRParserStaticAbilityClauses.ts
 * Cluster moved: WithMeta plus static-ability grant parse helpers (keyword list, signed P/T, graveyard grant)
 * Public: WithMeta, STATIC_KEYWORD_ABILITIES, normalizeGraveyardGrantSelector,
 * parseGraveyardKeywordAbilityCost, normalizeWardAbilityPart, parseKeywordAbilityList,
 * extractQuotedAbilityText, parseSignedInt, isEphemeralGrantedAbilityTarget
 */

import type { OracleEffectStep } from '../oracleIR';
import { normalizeOracleText } from '../oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const STATIC_KEYWORD_ABILITIES = new Set([
  'banding',
  'flying',
  'trample',
  'vigilance',
  'lifelink',
  'deathtouch',
  'reach',
  'menace',
  'shroud',
  'hexproof',
  'indestructible',
  'defender',
  'fear',
  'intimidate',
  'shadow',
  'horsemanship',
  'first strike',
  'double strike',
  'haste',
  'flash',
  'ward',
  'disguise',
  'daybound',
  'myriad',
  'infect',
  'convoke',
  'improvise',
  'flanking',
  'exalted',
  'suspend',
  'umbra armor',
  'provoke',
  'haunt',
  'demonstrate',
  'affinity for artifacts',
  'afflict 3',
  'absorb 1',
  'frenzy 1',
  'poisonous 1',
  'plainswalk',
  'islandwalk',
  'swampwalk',
  'mountainwalk',
  'forestwalk',
  'desertwalk',
  'annihilator 1',
  'annihilator 2',
  'annihilator 3',
  'annihilator 4',
]);

function normalizeGraveyardGrantSelector(rawSelector: string, qualifier = ''): string {
  const selector = normalizeOracleText(rawSelector)
    .replace(/^(?:each|all)\s+/i, '')
    .trim();
  const cleanQualifier = normalizeOracleText(qualifier).trim();
  return `${selector}${cleanQualifier ? ` ${cleanQualifier}` : ''}`.replace(/\s+/g, ' ').trim();
}

function parseGraveyardKeywordAbilityCost(rawCost: string | undefined): string | undefined {
  const cost = normalizeOracleText(String(rawCost || ''))
    .replace(/[.)]+$/g, '')
    .trim();
  if (!cost) return undefined;
  if (/^(?:\{[^}]+\}\s*)+$/.test(cost)) return cost.replace(/\s+/g, '');
  if (/^pay\s+.+$/i.test(cost)) return cost;
  return undefined;
}

function normalizeWardAbilityPart(part: string): string | null {
  const match = String(part || '').trim().match(/^ward\s+\{([^}]+)\}$/i);
  if (!match) return null;
  const costBody = String(match[1] || '').trim();
  return /^\d+$/.test(costBody) ? `ward ${costBody}` : `ward {${costBody}}`;
}

function parseKeywordAbilityList(raw: string): string[] {
  const normalized = normalizeOracleText(raw)
    .replace(/"[^"]*"/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.;]/g, ' ')
    .replace(/\band\s*$/i, ' ')
    .replace(/^and\s+/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return [];

  const parts = normalized
    .split(/\s*,\s*|\s+and\s+/i)
    .map(part => part.replace(/^and\s+/i, '').trim())
    .filter(Boolean);

  const abilities: string[] = [];
  for (const part of parts) {
    const wardAbility = normalizeWardAbilityPart(part);
    if (wardAbility) {
      if (!abilities.includes(wardAbility)) abilities.push(wardAbility);
      continue;
    }
    if (!STATIC_KEYWORD_ABILITIES.has(part)) return [];
    if (!abilities.includes(part)) abilities.push(part);
  }

  return abilities;
}

function extractQuotedAbilityText(raw: string): string[] {
  const abilities: string[] = [];
  const text = normalizeOracleText(raw);
  const quoted = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(text)) !== null) {
    const abilityText = String(match[1] || '').trim();
    if (abilityText && !abilities.includes(abilityText)) abilities.push(abilityText);
  }
  return abilities;
}

function parseSignedInt(raw: string | undefined): number | undefined {
  const value = String(raw || '').trim();
  if (!/^[+-]?\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Object.is(parsed, -0) ? 0 : parsed;
}

function isEphemeralGrantedAbilityTarget(raw: string): boolean {
  const normalized = normalizeOracleText(raw).trim().toLowerCase();
  return /^(?:it|them|they|that (?:card|creature|permanent|artifact|enchantment|land|planeswalker|token)|those (?:cards|creatures|permanents|artifacts|enchantments|lands|planeswalkers|tokens))$/.test(normalized);
}
export type { WithMeta };
export {
  STATIC_KEYWORD_ABILITIES,
  normalizeGraveyardGrantSelector,
  parseGraveyardKeywordAbilityCost,
  normalizeWardAbilityPart,
  parseKeywordAbilityList,
  extractQuotedAbilityText,
  parseSignedInt,
  isEphemeralGrantedAbilityTarget,
};
