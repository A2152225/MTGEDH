/**
 * Origin parent: rules-engine/src/oracleIRParserEffectClauseToStep.ts
 * Cluster: may-cast a filtered spell from among just-milled cards (Summons of Saruman family).
 * Public: tryParseMayCastFromAmong
 * Leaf must not import oracleIR.ts or oracleIRParserEffectClauseToStep.ts.
 */

import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep';
import { normalizeOracleText, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const MAY_CAST_FROM_AMONG =
  /^you\s+may\s+cast\s+(?:an?\s+)?(.+?)\s+spell\s+with\s+mana\s+value\s+(x|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+or\s+less\s+from\s+among\s+(them|the\s+milled\s+cards|cards?\s+milled\s+this\s+way)\s+without\s+paying\s+its\s+mana\s+cost\.?$/i;

const SPELL_TYPE_WORDS = [
  'instant',
  'sorcery',
  'artifact',
  'creature',
  'enchantment',
  'planeswalker',
  'battle',
  'kindred',
] as const;

function normalizeClause(text: string): string {
  return normalizeOracleText(String(text || ''))
    .replace(/\s+\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '.')
    .trim();
}

function parseSpellTypes(typePhrase: string): readonly string[] {
  const phrase = String(typePhrase || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const types = SPELL_TYPE_WORDS.filter((typeWord) =>
    new RegExp(`\\b${typeWord}s?\\b`, 'i').test(phrase),
  );
  return types.length > 0 ? types : ['instant', 'sorcery'];
}

export function tryParseMayCastFromAmong(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeClause(clause);
  if (!normalized) return null;

  const match = normalized.match(MAY_CAST_FROM_AMONG);
  if (!match) return null;

  const amountText = String(match[2] || 'x').trim().toLowerCase();
  const maxManaValue = amountText === 'x'
    ? { kind: 'x' as const }
    : parseQuantity(amountText);

  return withMeta({
    kind: 'may_cast_from_among',
    among: 'milled_this_way',
    cardTypes: parseSpellTypes(String(match[1] || '')),
    maxManaValue,
    withoutPayingManaCost: true,
    optional: true,
    raw: rawClause,
  });
}
