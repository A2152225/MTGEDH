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
  'infect',
  'annihilator 1',
  'annihilator 2',
  'annihilator 3',
  'annihilator 4',
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
    .map(part => part.replace(/^and\s+/i, '').trim())
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
  const workingClause = normalizeOracleText(clause).replace(/^[\u2022â€¢]\s+/, '').trim();

  {
    const normalized = workingClause;
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
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+gains?\s+(.+?)\s+until end of turn$/i);
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

    const textGrant = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+gains?\s+(.+?)\s+until end of turn$/i);
    if (textGrant && (/^until end of turn,/i.test(workingClause) || /\buntil end of turn$/i.test(workingClause))) {
      const targetText = String(textGrant[1] || '').trim();
      const grantedText = String(textGrant[2] || '').trim();
      if (/\bgraveyard\b/i.test(targetText) && /^(?:flashback|escape|retrace|jump-start|harmonize)\b/i.test(grantedText)) return null;
      if (/^protection from the color of your choice$/i.test(grantedText)) return null;
      if (grantedText && !/\bgets?\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\b/i.test(targetText)) {
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
    const m = workingClause.match(/^(it|that creature|that permanent|that card|they)\s+gains?\s+(haste|trample|vigilance|lifelink|deathtouch|menace|reach|flying|first strike|double strike|indestructible|hexproof|infect)(?:\s+this\s+turn)?$/i);
    if (m) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'end_of_turn',
        abilities: [String(m[2] || '').trim().toLowerCase()],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+loses?\s+all\s+abilities\s+and\s+(?:has|have|becomes?)\s+(.+?\bbase\s+power\s+and\s+toughness\s+[^.]+)(?:\s+until\s+end\s+of\s+turn)?$/i);
    if (m && (/^until end of turn,/i.test(workingClause) || /\buntil end of turn\b/i.test(workingClause))) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['loses all abilities', String(m[2] || '').trim()],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+loses?\s+all\s+abilities(?:\s+until end of turn)?$/i);
    if (m && (/^until end of turn,/i.test(workingClause) || /\buntil end of turn\b/i.test(workingClause))) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: ['loses all abilities'],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+ha(?:s|ve)\s+base\s+power\s+and\s+toughness\s+([^\s]+)\s+and\s+(?:gains?|becomes?)\s+(.+)$/i);
    if (m && (/^until end of turn,/i.test(workingClause) || /\buntil end of turn\b/i.test(workingClause))) {
      const abilities = parseKeywordAbilityList(String(m[3] || '').replace(/\s+until end of turn$/i, '').trim());
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'end_of_turn',
        ...(abilities ? { abilities } : {}),
        effectText: [`has base power and toughness ${String(m[2] || '').trim()}`, ...(abilities ? [] : [String(m[3] || '').trim()])],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+gains?\s+(.+?)\s+until end of turn\s+and\s+(.+)$/i);
    if (m) {
      const abilities = parseKeywordAbilityList(String(m[2] || '').trim());
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'end_of_turn',
        ...(abilities ? { abilities } : {}),
        effectText: abilities ? [String(m[3] || '').trim()] : [String(m[2] || '').trim(), String(m[3] || '').trim()],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+can(?:not|(?:'|’)t)\s+be\s+the\s+targets?\s+of\s+(.+?)\s+this\s+turn$/i);
    if (m) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'this_turn',
        effectText: [`can't be the target of ${String(m[2] || '').trim()}`],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(.+?)\s+assigns\s+combat\s+damage\s+equal\s+to\s+its\s+toughness\s+rather\s+than\s+its\s+power\s+this\s+turn$/i);
    if (m) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'this_turn',
        effectText: ['assigns combat damage equal to its toughness rather than its power'],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+loses?\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
    if (m && !/^all\s+abilities$/i.test(String(m[2] || '').trim())) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'end_of_turn',
        effectText: [`loses ${String(m[2] || '').trim()}`],
        raw: rawClause,
      });
    }
  }

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+can't be blocked(?:\s+this turn)?$/i);
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
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+can't be blocked by creatures with power (\d+) or less(?:\s+this turn)?$/i);
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

  {
    const m = workingClause.match(/^(?:until end of turn,\s+)?(.+?)\s+can't be blocked\s+by\s+(.+?)(?:\s+this turn)?$/i);
    if (m && (/^until end of turn,/i.test(workingClause) || /\bthis turn\b/i.test(workingClause))) {
      return withMeta({
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(m[1] || '').trim()),
        duration: 'this_turn',
        effectText: [`can't be blocked by ${String(m[2] || '').trim()}`],
        raw: rawClause,
      });
    }
  }

  return null;
}
