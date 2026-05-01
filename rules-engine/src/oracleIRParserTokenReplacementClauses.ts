import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

function splitTokenTypes(raw: string): string[] {
  return normalizeOracleText(raw)
    .replace(/\s+tokens?$/i, '')
    .split(/\s*,\s*|\s+or\s+|\s+and\s+/i)
    .map(value => value.replace(/^(?:or|and)\s+/i, '').trim().toLowerCase())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

export function tryParseTokenCreationReplacementClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;
  const normalized = normalizeOracleText(clause).replace(/[.]+$/g, '').trim();
  if (!normalized) return null;

  const oneOfEachMatch = normalized.match(
    /^if\s+(you|they|that player|target player)?\s*would\s+create\s+a\s+(.+?)\s+token,\s+instead\s+create\s+one\s+of\s+each$/i
  );
  if (oneOfEachMatch) {
    const tokenTypes = splitTokenTypes(String(oneOfEachMatch[2] || ''));
    if (tokenTypes.length > 1) {
      return withMeta({
        kind: 'modify_token_creation',
        who: parsePlayerSelector(String(oneOfEachMatch[1] || 'you').trim()),
        tokenTypes,
        mode: 'replace_with_one_of_each',
        raw: rawClause,
      });
    }
  }

  const addOneMatch = normalized.match(
    /^if\s+(you|they|that player|target player)?\s*would\s+create\s+one\s+or\s+more\s+(.+?)\s+tokens?,\s+instead\s+create\s+those\s+tokens\s+plus\s+an\s+additional\s+(.+?)\s+token$/i
  );
  if (addOneMatch) {
    const tokenTypes = splitTokenTypes(String(addOneMatch[2] || ''));
    const additionalToken = normalizeOracleText(String(addOneMatch[3] || '')).trim().toLowerCase();
    if (tokenTypes.length > 0 && (!additionalToken || tokenTypes.includes(additionalToken))) {
      return withMeta({
        kind: 'modify_token_creation',
        who: parsePlayerSelector(String(addOneMatch[1] || 'you').trim()),
        tokenTypes,
        mode: 'add_additional_token',
        additionalAmount: parseQuantity('one'),
        raw: rawClause,
      });
    }
  }

  return null;
}
