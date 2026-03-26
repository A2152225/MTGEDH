import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const KEYWORD_ABILITIES = new Set([
  'flying',
  'trample',
  'vigilance',
  'lifelink',
  'deathtouch',
  'reach',
  'menace',
  'hexproof',
  'indestructible',
  'first strike',
  'double strike',
  'haste',
  'ward',
]);

function parseKeywordAbilityList(raw: string): string[] | null {
  const normalized = String(raw || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  const parts = normalized
    .split(/\s*,\s*|\s+and\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const abilities: string[] = [];
  for (const part of parts) {
    if (!KEYWORD_ABILITIES.has(part)) return null;
    if (!abilities.includes(part)) abilities.push(part);
  }

  return abilities.length > 0 ? abilities : null;
}

export function tryParseTemporaryAbilityClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  {
    const m = clause.match(/^(?:until end of turn,\s+)?(.+?)\s+gains?\s+(.+?)\s+until end of turn$/i);
    if (m) {
      const abilities = parseKeywordAbilityList(String(m[2] || '').trim());
      if (abilities) {
        return withMeta({
          kind: 'grant_temporary_ability',
          target: parseObjectSelector(String(m[1] || '').trim()),
          duration: 'end_of_turn',
          abilities,
          raw: rawClause,
        });
      }
    }
  }

  {
    const m = clause.match(/^(?:until end of turn,\s+)?(.+?)\s+can't be blocked(?:\s+this turn)?$/i);
    if (m) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'this_turn',
        effectText: ["can't be blocked"],
        raw: rawClause,
      });
    }
  }

  {
    const m = clause.match(/^(?:until end of turn,\s+)?(.+?)\s+can't be blocked by creatures with power (\d+) or less(?:\s+this turn)?$/i);
    if (m) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'this_turn',
        effectText: [`can't be blocked by creatures with power ${String(m[2] || '').trim()} or less`],
        raw: rawClause,
      });
    }
  }

  {
    const m = clause.match(/^(?:until end of turn,\s+)?(.+?)\s+can't be blocked by creatures with greater power(?:\s+this turn)?$/i);
    if (m) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'this_turn',
        effectText: ["can't be blocked by creatures with greater power"],
        raw: rawClause,
      });
    }
  }

  return null;
}
