import type { OracleEffectStep, OraclePlayerSelector, OracleQuantity } from './oracleIR';
import {
  isThoseOpponentsPossessiveSource,
  normalizeClauseForParse,
  normalizeOracleText,
  parsePlayerSelector,
  parseQuantity,
} from './oracleIRParserUtils';

export function tryParseMultiCreateTokensClause(rawClause: string): OracleEffectStep[] | null {
  const normalized = normalizeClauseForParse(rawClause);
  const clause = normalized.clause;
  const sequence = normalized.sequence;
  const optional = normalized.optional;

  const withMeta = <T extends OracleEffectStep>(step: T, meta: { sequence?: 'then'; optional?: boolean }): T => {
    const out: any = { ...step };
    if (meta.sequence) out.sequence = meta.sequence;
    if (meta.optional) out.optional = meta.optional;
    return out;
  };

  const prefix = clause.match(
    /^(?:(you|each player|each opponent|each of those opponents|target player|target opponent|that player|that opponent|defending player|the defending player|he or she|they|its controller|its owner|that [a-z0-9][a-z0-9 -]*['â€™]s (?:controller|owner))\s+)?create(?:s)?\s+(.+)$/i
  );
  if (!prefix) return null;

  const who = parsePlayerSelector(prefix[1]);
  const rest = String(prefix[2] || '').trim();
  if (!rest) return null;

  const tokenRegex =
    /\b((?:(?!and\b)(?!then\b)(?:a|an|\d+|x|[a-z]+)))\s+(tapped\s+)?(.+?)\s+(?:creature\s+)?token(?:s)?\b(\s+tapped\b)?/gi;
  const matches: { amount: OracleQuantity; token: string; entersTapped?: boolean }[] = [];

  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(rest)) !== null) {
    const amount = parseQuantity(m[1]);
    const entersTapped = Boolean(m[2]) || Boolean(m[4]);
    const token = String(m[3] || '').trim();
    if (!token) continue;
    matches.push({ amount, token, entersTapped: entersTapped || undefined });
    if (tokenRegex.lastIndex === m.index) tokenRegex.lastIndex++;
  }

  if (matches.length < 2) return null;

  {
    const tokenRegexForReplace = new RegExp(tokenRegex.source, 'gi');
    const leftover = String(rest)
      .replace(tokenRegexForReplace, ' ')
      .replace(/[(),]/g, ' ')
      .replace(/\b(and|then)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (leftover && /[a-z0-9]/i.test(leftover)) return null;
  }

  const steps: OracleEffectStep[] = [];
  for (let idx = 0; idx < matches.length; idx++) {
    const meta = {
      sequence: idx === 0 ? sequence : undefined,
      optional,
    };
    steps.push(
      withMeta(
        {
          kind: 'create_token',
          who,
          amount: matches[idx].amount,
          token: matches[idx].token,
          entersTapped: matches[idx].entersTapped,
          raw: rawClause,
        },
        meta
      )
    );
  }

  return steps;
}

export function tryParseCreateTokenAndExileTopClause(
  rawClause: string,
  parseSingleClauseToStep: (rawClause: string) => OracleEffectStep
): OracleEffectStep[] | null {
  const normalized = normalizeClauseForParse(rawClause);
  const clause = normalized.clause;
  const sequence = normalized.sequence;
  const optional = normalized.optional;

  const lower = clause.toLowerCase();
  const splitNeedleCreateThenExile = ' and exile the top ';
  const splitNeedleExileThenCreate = ' and create ';
  const splitAtCreateThenExile = lower.indexOf(splitNeedleCreateThenExile);
  const splitAtExileThenCreate = lower.indexOf(splitNeedleExileThenCreate);
  if (splitAtCreateThenExile < 0 && splitAtExileThenCreate < 0) return null;

  const isCreateThenExile = splitAtCreateThenExile >= 0;
  const createPart = isCreateThenExile
    ? clause.slice(0, splitAtCreateThenExile).trim()
    : clause.slice(splitAtExileThenCreate + ' and '.length).trim();
  const exilePart = isCreateThenExile
    ? clause.slice(splitAtCreateThenExile + ' and '.length).trim()
    : clause.slice(0, splitAtExileThenCreate).trim();
  if (!createPart || !exilePart) return null;

  const created: OracleEffectStep[] | null =
    tryParseMultiCreateTokensClause(createPart) ||
    (() => {
      const step = parseSingleClauseToStep(createPart);
      return step.kind === 'create_token' ? [step] : null;
    })();
  if (!created || created.length === 0) return null;

  const normalizePossessive = (s: string): string => String(s || '').replace(/â€™/g, "'").trim().toLowerCase();
  const clean = normalizeOracleText(exilePart).trim();

  let amount: OracleQuantity | null = null;
  let who: OraclePlayerSelector | null = null;

  {
    const mMany = clean.match(
      /^exile\s+the\s+top\s+(a|an|\d+|x|[a-z]+)\s+cards?\s+of\s+(your|target player['â€™]s|target opponent['â€™]s|that player['â€™]s|that opponent['â€™]s|their|his or her|its owner['â€™]s|its controller['â€™]s|each player['â€™]s|each players['â€™]|each opponent['â€™]s|each opponents['â€™]|each of your opponents['â€™]|each of those opponents['â€™]|those opponents['â€™]|all of those opponents['â€™]|all those opponents['â€™])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
    );
    if (mMany) {
      amount = parseQuantity(mMany[1]);
      const src = normalizePossessive(mMany[2]);
      if (src === 'your') who = { kind: 'you' };
      else if (src === "target player's") who = { kind: 'target_player' };
      else if (src === "target opponent's") who = { kind: 'target_opponent' };
      else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
      else if (src === "that opponent's") who = { kind: 'target_opponent' };
      else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
      else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) {
        who = { kind: 'each_opponent' };
      } else if (isThoseOpponentsPossessiveSource(src)) {
        who = { kind: 'each_of_those_opponents' };
      }
    }
  }

  if (!amount) {
    const mOne = clean.match(
      /^exile\s+the\s+top\s+card\s+of\s+(your|target player['â€™]s|target opponent['â€™]s|that player['â€™]s|that opponent['â€™]s|their|his or her|its owner['â€™]s|its controller['â€™]s|each player['â€™]s|each players['â€™]|each opponent['â€™]s|each opponents['â€™]|each of your opponents['â€™]|each of those opponents['â€™]|those opponents['â€™]|all of those opponents['â€™]|all those opponents['â€™])\s+librar(?:y|ies)(?:\s+face down)?\s*$/i
    );
    if (mOne) {
      amount = { kind: 'number', value: 1 };
      const src = normalizePossessive(mOne[1]);
      if (src === 'your') who = { kind: 'you' };
      else if (src === "target player's") who = { kind: 'target_player' };
      else if (src === "target opponent's") who = { kind: 'target_opponent' };
      else if (src === 'their' || src === 'his or her' || src === "that player's" || src === "its controller's" || src === "its owner's") who = { kind: 'target_player' };
      else if (src === "that opponent's") who = { kind: 'target_opponent' };
      else if (src === "each player's" || src === "each players'") who = { kind: 'each_player' };
      else if (src === "each opponent's" || src === "each opponents'" || src.startsWith('each of your opponents')) {
        who = { kind: 'each_opponent' };
      } else if (isThoseOpponentsPossessiveSource(src)) {
        who = { kind: 'each_of_those_opponents' };
      }
    }
  }

  if (!amount || !who) return null;

  const withMeta = <T extends OracleEffectStep>(step: T): T => {
    const out: any = { ...step };
    if (sequence) out.sequence = sequence;
    if (optional) out.optional = optional;
    return out;
  };

  const createdWithMeta = created.map((s, idx) =>
    withMeta({ ...(s as any), sequence: idx === 0 ? (sequence as any) : undefined } as any)
  );
  const exileTop = withMeta({
    kind: 'exile_top',
    who,
    amount,
    raw: clean.endsWith('.') ? clean : `${clean}.`,
  });

  return isCreateThenExile ? [...createdWithMeta, exileTop] : [exileTop, ...createdWithMeta];
}
