import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

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

function parseAttachmentTargetFromClause(clauseText: string) {
  const normalized = normalizeOracleText(clauseText);
  const match = normalized.match(/\battached to (it|that creature)\b/i);
  if (!match) return undefined;
  return parseObjectSelector(String(match[1] || '').trim());
}

function buildSimpleCreateTokenLeadPattern(): RegExp {
  const playerSubjectPrefixNoCapture =
    "(?:(?:you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'â€™-]*?(?:'s|â€™s)? (?:controller|owner))\\s+)?";
  return new RegExp(
    `^(${playerSubjectPrefixNoCapture}create(?:s)?\\s+(?:a|an|\\d+|x|[a-z]+)\\s+(?:tapped\\s+)?(?:.+?)\\s+(?:creature\\s+)?token(?:s)?(?:\\s+tapped\\b)?(?:\\s+with\\s+[^,.]+?\\s+counters?\\s+on\\s+(?:it|them))?(?:\\s+attached\\s+to\\s+(?:it|that creature))?)\\s+and\\s+(.+)$`,
    'i'
  );
}

export function tryParseSimpleCreateTokenClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { clause, rawClause, withMeta } = args;

  const createCopy = clause.match(
    new RegExp(
      `^${PLAYER_SUBJECT_PREFIX}create(?:s)?\\s+(a|an|\\d+|x|[a-z]+)\\s+token(?:s)?\\s+that(?:'s| are)\\s+(?:a\\s+copy|copies)\\s+of\\s+(.+)$`,
      'i'
    )
  );
  if (createCopy) {
    const rawWho = String(createCopy[1] || '').trim().toLowerCase();
    const who =
      rawWho === 'its owner'
        ? ({ kind: 'owner_of_moved_cards' } as const)
        : parsePlayerSelector(createCopy[1]);
    const amount = parseQuantity(createCopy[2]);
    const token = `copy of ${String(createCopy[3] || '').trim()}`.trim();
    const withCounters = parseWithCountersFromClause(clause);
    const battlefieldAttachedTo = parseAttachmentTargetFromClause(clause);
    return withMeta({
      kind: 'create_token',
      who,
      amount,
      token,
      withCounters,
      battlefieldAttachedTo,
      raw: rawClause,
    });
  }

  const create = clause.match(
    new RegExp(
      `^${PLAYER_SUBJECT_PREFIX}create(?:s)?\\s+(a|an|\\d+|x|[a-z]+)\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?\\b`,
      'i'
    )
  );
  if (create) {
    const rawWho = String(create[1] || '').trim().toLowerCase();
    const who =
      rawWho === 'its owner'
        ? ({ kind: 'owner_of_moved_cards' } as const)
        : parsePlayerSelector(create[1]);
    const amount = parseQuantity(create[2]);
    const entersTapped = Boolean(create[3]) || /\btoken(?:s)?\s+tapped\b/i.test(clause);
    const token = String(create[4] || '').trim();
    const withCounters = parseWithCountersFromClause(clause);
    const battlefieldAttachedTo = parseAttachmentTargetFromClause(clause);
    return withMeta({
      kind: 'create_token',
      who,
      amount,
      token,
      entersTapped: entersTapped || undefined,
      withCounters,
      battlefieldAttachedTo,
      raw: rawClause,
    });
  }

  const createDefault = clause.match(/^create(?:s)?\s+(a|an|\d+|x|[a-z]+)\s+(tapped\s+)?(.+?)\s+(?:creature\s+)?token(?:s)?\b/i);
  if (createDefault) {
    const entersTapped = Boolean(createDefault[2]) || /\btoken(?:s)?\s+tapped\b/i.test(clause);
    const withCounters = parseWithCountersFromClause(clause);
    const battlefieldAttachedTo = parseAttachmentTargetFromClause(clause);
    return withMeta({
      kind: 'create_token',
      who: { kind: 'you' },
      amount: parseQuantity(createDefault[1]),
      token: String(createDefault[3] || '').trim(),
      entersTapped: entersTapped || undefined,
      withCounters,
      battlefieldAttachedTo,
      raw: rawClause,
    });
  }

  return null;
}

export function splitConservativeCreateTokenLeadClause(args: {
  rawClause: string;
  parseEffectClauseToStep: (rawClause: string) => OracleEffectStep;
}): string[] | null {
  const normalized = normalizeOracleText(args.rawClause).trim();
  if (!normalized) return null;

  const match = normalized.match(buildSimpleCreateTokenLeadPattern());
  if (!match) return null;

  const left = String(match[1] || '').trim();
  const right = String(match[2] || '').trim();
  if (!left || !right) return null;

  const create = tryParseSimpleCreateTokenClause({
    clause: left,
    rawClause: left,
    withMeta: <T extends OracleEffectStep>(step: T): T => step,
  });
  if (!create || create.kind !== 'create_token') return null;

  const parsedRight = args.parseEffectClauseToStep(right);
  if (!parsedRight || parsedRight.kind === 'unknown') return null;

  return [left, right];
}
