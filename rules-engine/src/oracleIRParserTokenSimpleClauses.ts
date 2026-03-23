import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const PLAYER_SUBJECT_PREFIX =
  "(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'’-]*?(?:'s|’s)? (?:controller|owner))\\s+)?";

function parseWithCountersFromClause(clauseText: string): Record<string, number> | undefined {
  const s = normalizeOracleText(clauseText);
  if (!/\bwith\b/i.test(s) || !/\bcounters?\b/i.test(s)) return undefined;

  const m = s.match(/\bwith\s+(a|an|\d+|x|[a-z]+)\s+([^,.]+?)\s+counters?\s+on\s+(?:it|them)\b/i);
  if (!m) return undefined;

  if (/\bof your choice\b/i.test(m[0])) return undefined;

  const qty = parseQuantity(m[1]);
  if (qty.kind !== 'number') return undefined;
  const n = Math.max(0, qty.value | 0);
  if (n <= 0) return undefined;

  let counterType = String(m[2] || '').trim();
  if (!counterType) return undefined;

  counterType = counterType
    .replace(/\s+/g, ' ')
    .replace(/\+\s*1\s*\/\s*\+\s*1/g, '+1/+1')
    .replace(/\-\s*1\s*\/\s*\-\s*1/g, '-1/-1');

  counterType = counterType.replace(/^additional\s+/i, '');
  counterType = counterType.replace(/\bcounters?\b/gi, '').trim();
  if (!counterType) return undefined;

  return { [counterType]: n };
}

export function tryParseSimpleCreateTokenClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  const create = clause.match(
    new RegExp(
      `^${PLAYER_SUBJECT_PREFIX}create(?:s)?\\s+(a|an|\\d+|x|[a-z]+)\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?\\b`,
      'i'
    )
  );
  if (create) {
    const who = parsePlayerSelector(create[1]);
    const amount = parseQuantity(create[2]);
    const entersTapped = Boolean(create[3]) || /\btoken(?:s)?\s+tapped\b/i.test(clause);
    const token = String(create[4] || '').trim();
    const withCounters = parseWithCountersFromClause(clause);
    return withMeta({
      kind: 'create_token',
      who,
      amount,
      token,
      entersTapped: entersTapped || undefined,
      withCounters,
      raw: rawClause,
    });
  }

  const createDefault = clause.match(/^create(?:s)?\s+(a|an|\d+|x|[a-z]+)\s+(tapped\s+)?(.+?)\s+(?:creature\s+)?token(?:s)?\b/i);
  if (createDefault) {
    const entersTapped = Boolean(createDefault[2]) || /\btoken(?:s)?\s+tapped\b/i.test(clause);
    const withCounters = parseWithCountersFromClause(clause);
    return withMeta({
      kind: 'create_token',
      who: { kind: 'you' },
      amount: parseQuantity(createDefault[1]),
      token: String(createDefault[3] || '').trim(),
      entersTapped: entersTapped || undefined,
      withCounters,
      raw: rawClause,
    });
  }

  return null;
}
