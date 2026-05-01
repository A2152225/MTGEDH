import type { OracleEffectStep } from './oracleIR';
import { normalizeOracleText, parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';

type WithMeta = <T extends OracleEffectStep>(step: T) => T;

const TOKEN_AMOUNT_PATTERN = '(?:twice\\s+x|that many|that much|a|an|\\d+|x|[a-z]+)';

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

function parseTokenQuantity(raw: string | undefined) {
  const s = String(raw || '').trim();
  if (/^twice\s+x$/i.test(s)) return { kind: 'x' as const };
  return parseQuantity(raw);
}

function hasTappedAndAttackingClause(clauseText: string): boolean {
  return /\bthat(?:'s| is| are)\s+tapped\s+and\s+attacking\b/i.test(clauseText);
}

function buildSimpleCreateTokenLeadPattern(): RegExp {
  const playerSubjectPrefixNoCapture =
    "(?:(?:you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 ,.'â€™-]*?(?:'s|â€™s)? (?:controller|owner))\\s+)?";
  return new RegExp(
    `^(${playerSubjectPrefixNoCapture}create(?:s)?\\s+${TOKEN_AMOUNT_PATTERN}\\s+(?:tapped\\s+)?(?:.+?)\\s+(?:creature\\s+)?token(?:s)?(?:\\s+tapped\\b)?(?:\\s+with\\s+[^,.]+?\\s+counters?\\s+on\\s+(?:it|them))?(?:\\s+attached\\s+to\\s+(?:it|that creature))?)\\s+and\\s+(.+)$`,
    'i'
  );
}

export function tryParseSimpleCreateTokenClause(args: {
  clause: string;
  rawClause: string;
  withMeta: WithMeta;
}): OracleEffectStep | null {
  const { rawClause, withMeta } = args;
  const clause = normalizeOracleText(args.clause)
    .replace(/^\(+\s*/, '')
    .replace(/\s*\)+\s*$/g, '')
    .replace(/[.]+$/g, '')
    .trim();

  const perOpponentAttackingCreate = clause.match(
    new RegExp(
      `^for each opponent,\\s+create\\s+(${TOKEN_AMOUNT_PATTERN})\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?(?:\\s+that(?:'s| is| are)\\s+tapped\\s+and\\s+attacking\\s+that\\s+player(?:\\s+or\\s+a\\s+planeswalker\\s+they\\s+control)?)?$`,
      'i'
    )
  );
  if (perOpponentAttackingCreate) {
    return withMeta({
      kind: 'create_token',
      who: { kind: 'you' },
      amount: parseTokenQuantity(perOpponentAttackingCreate[1]),
      token: String(perOpponentAttackingCreate[3] || '').trim(),
      entersTapped: Boolean(perOpponentAttackingCreate[2]) || /\btapped\s+and\s+attacking\b/i.test(clause) || undefined,
      attacking: 'each_opponent',
      raw: rawClause,
    });
  }

  const perPreventedDamageCreate = clause.match(
    new RegExp(
      `^for each 1 damage prevented this way,\\s+create\\s+(${TOKEN_AMOUNT_PATTERN})\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?\\b`,
      'i'
    )
  );
  if (perPreventedDamageCreate) {
    return withMeta({
      kind: 'create_token',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'damage_prevented_this_way' },
      token: String(perPreventedDamageCreate[3] || '').trim(),
      entersTapped: Boolean(perPreventedDamageCreate[2]) || /\btoken(?:s)?\s+tapped\b/i.test(clause) || undefined,
      raw: rawClause,
    });
  }

  const forEachCreate = clause.match(
    new RegExp(
      `^for each\\s+(.+?),\\s+(?:(you|they|that player|target player|target opponent)\\s+)?create(?:s)?\\s+(${TOKEN_AMOUNT_PATTERN})\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?\\b`,
      'i'
    )
  );
  if (forEachCreate) {
    const countedExpression = String(forEachCreate[1] || '').trim();
    if (/\bvote$/i.test(countedExpression)) return null;
    const tappedAndAttacking = hasTappedAndAttackingClause(clause);
    return withMeta({
      kind: 'create_token',
      who: parsePlayerSelector(forEachCreate[2]),
      amount: { kind: 'x' },
      token: String(forEachCreate[5] || '').trim(),
      entersTapped: Boolean(forEachCreate[4]) || tappedAndAttacking || undefined,
      ...(tappedAndAttacking ? { attacking: 'defending_player' as const } : {}),
      raw: rawClause,
    });
  }

  const createNumberEqual = clause.match(
    new RegExp(
      `^${PLAYER_SUBJECT_PREFIX}create(?:s)?\\s+a\\s+number\\s+of\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?\\s+equal\\s+to\\s+(.+)$`,
      'i'
    )
  );
  if (createNumberEqual) {
    const tappedAndAttacking = hasTappedAndAttackingClause(clause);
    return withMeta({
      kind: 'create_token',
      who: parsePlayerSelector(createNumberEqual[1]),
      amount: { kind: 'x' },
      token: String(createNumberEqual[3] || '').trim(),
      entersTapped: Boolean(createNumberEqual[2]) || tappedAndAttacking || undefined,
      ...(tappedAndAttacking ? { attacking: 'defending_player' as const } : {}),
      raw: rawClause,
    });
  }

  const createTokenCopy = clause.match(
    new RegExp(
      `^${PLAYER_SUBJECT_PREFIX}create(?:s)?\\s+(${TOKEN_AMOUNT_PATTERN})\\s+((?:(?!token\\s+cop).)*?)token\\s+cop(?:y|ies)(?:\\s+of\\s+(.+?))?(?:\\s+that(?:'s| is| are)\\s+tapped\\s+and\\s+attacking\\s+.+)?$`,
      'i'
    )
  );
  if (createTokenCopy) {
    const rawWho = String(createTokenCopy[1] || '').trim().toLowerCase();
    const who =
      rawWho === 'its owner'
        ? ({ kind: 'owner_of_moved_cards' } as const)
        : parsePlayerSelector(createTokenCopy[1]);
    const descriptor = String(createTokenCopy[3] || '').trim();
    const source = String(createTokenCopy[4] || 'it').trim();
    const token = `${descriptor ? `${descriptor} ` : ''}copy of ${source}`.trim();
    return withMeta({
      kind: 'create_token',
      who,
      amount: parseTokenQuantity(createTokenCopy[2]),
      token,
      entersTapped: hasTappedAndAttackingClause(clause) || undefined,
      ...(hasTappedAndAttackingClause(clause) ? { attacking: 'defending_player' as const } : {}),
      raw: rawClause,
    });
  }

  const createCopy = clause.match(
    new RegExp(
      `^${PLAYER_SUBJECT_PREFIX}create(?:s)?\\s+(${TOKEN_AMOUNT_PATTERN})\\s+token(?:s)?\\s+that(?:'s| are)\\s+(?:a\\s+copy|copies)\\s+of\\s+(.+)$`,
      'i'
    )
  );
  if (createCopy) {
    const rawWho = String(createCopy[1] || '').trim().toLowerCase();
    const who =
      rawWho === 'its owner'
        ? ({ kind: 'owner_of_moved_cards' } as const)
        : parsePlayerSelector(createCopy[1]);
    const amount = parseTokenQuantity(createCopy[2]);
    const token = `copy of ${String(createCopy[3] || '').trim()}`.trim();
    const withCounters = parseWithCountersFromClause(clause);
    const battlefieldAttachedTo = parseAttachmentTargetFromClause(clause);
    const tappedAndAttacking = hasTappedAndAttackingClause(clause);
    return withMeta({
      kind: 'create_token',
      who,
      amount,
      token,
      entersTapped: tappedAndAttacking || undefined,
      ...(tappedAndAttacking ? { attacking: 'defending_player' as const } : {}),
      withCounters,
      battlefieldAttachedTo,
      raw: rawClause,
    });
  }

  const create = clause.match(
    new RegExp(
      `^${PLAYER_SUBJECT_PREFIX}create(?:s)?\\s+(${TOKEN_AMOUNT_PATTERN})\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?\\b`,
      'i'
    )
  );
  if (create) {
    const rawWho = String(create[1] || '').trim().toLowerCase();
    const who =
      rawWho === 'its owner'
        ? ({ kind: 'owner_of_moved_cards' } as const)
        : parsePlayerSelector(create[1]);
    const amount = parseTokenQuantity(create[2]);
    const tappedAndAttacking = hasTappedAndAttackingClause(clause);
    const entersTapped = Boolean(create[3]) || /\btoken(?:s)?\s+tapped\b/i.test(clause) || tappedAndAttacking;
    const token = String(create[4] || '').trim();
    const withCounters = parseWithCountersFromClause(clause);
    const battlefieldAttachedTo = parseAttachmentTargetFromClause(clause);
    return withMeta({
      kind: 'create_token',
      who,
      amount,
      token,
      entersTapped: entersTapped || undefined,
      ...(tappedAndAttacking ? { attacking: 'defending_player' as const } : {}),
      withCounters,
      battlefieldAttachedTo,
      raw: rawClause,
    });
  }

  const createDefault = clause.match(new RegExp(`^create(?:s)?\\s+(${TOKEN_AMOUNT_PATTERN})\\s+(tapped\\s+)?(.+?)\\s+(?:creature\\s+)?token(?:s)?\\b`, 'i'));
  if (createDefault) {
    const tappedAndAttacking = hasTappedAndAttackingClause(clause);
    const entersTapped = Boolean(createDefault[2]) || /\btoken(?:s)?\s+tapped\b/i.test(clause) || tappedAndAttacking;
    const withCounters = parseWithCountersFromClause(clause);
    const battlefieldAttachedTo = parseAttachmentTargetFromClause(clause);
    return withMeta({
      kind: 'create_token',
      who: { kind: 'you' },
      amount: parseTokenQuantity(createDefault[1]),
      token: String(createDefault[3] || '').trim(),
      entersTapped: entersTapped || undefined,
      ...(tappedAndAttacking ? { attacking: 'defending_player' as const } : {}),
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
