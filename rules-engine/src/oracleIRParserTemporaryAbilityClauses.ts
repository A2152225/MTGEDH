import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const KEYWORD_ABILITIES = new Set([
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
  'fear',
  'intimidate',
  'shadow',
  'horsemanship',
  'first strike',
  'double strike',
  'haste',
  'ward',
  'myriad',
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
    const normalized = normalizeOracleText(clause).trim();
    const m = normalized.match(/^(?:until end of turn,\s+)?(.+?)\s+gains?\s+"([^"]+)"(?:\s+until end of turn)?$/i);
    if (m && (/^until end of turn,/i.test(normalized) || /\buntil end of turn$/i.test(normalized))) {
      const targetText = String(m[1] || '').trim();
      const grantedText = String(m[2] || '').trim();
      if (/\bgraveyard\b/i.test(targetText) && /^(?:you may\s+(?:cast|play)\s+this card from your graveyard|(?:flashback|escape|retrace|jump-start|harmonize)\b)/i.test(grantedText)) {
        return null;
      }
      if (grantedText) {
        return withMeta({
          kind: 'grant_temporary_ability',
          target: parseObjectSelector(targetText),
          duration: 'end_of_turn',
          effectText: [grantedText],
          raw: rawClause,
        });
      }
    }
  }

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

  {
    const m = clause.match(/^(?:until end of turn,\s+)?(.+?)\s+can attack(?:\s+this turn)? as though it did(?:n't| not) have defender$/i);
    if (m) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'this_turn',
        effectText: ["can attack as though it didn't have defender"],
        raw: rawClause,
      });
    }
  }

  return null;
}
