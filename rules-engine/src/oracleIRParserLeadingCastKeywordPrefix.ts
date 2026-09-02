/**
 * Origin: oracleIRParserUtils.ts
 * Cluster: leading cost / typal keywords glued onto the next instruction after
 *   reminder parentheticals (the terminating period lives inside the reminder)
 *   are stripped. "Delve Target player sacrifices…" must parse as the sacrifice.
 * Public: stripLeadingCastKeywordPrefix, stripTrailingCastKeywordSuffix
 */

const CAST_KEYWORD =
  '(?:bargain|delve|aftermath|changeling|convoke|improvise|devoid|epic|spree|fuse|infusion|flash|cascade|storm|rebound|undying|persist|undaunted|ascend|freerunning|foretell|flashback|cycling|kicker|multikicker|spell\\s+mastery|reinforce\\s+\\d+|teamwork\\s+\\d+|suspend\\s+\\d+)';

const CAST_KEYWORD_COST =
  '(?:\\s*(?:[-—–]\\s*)?(?:\\{[^}]+\\})+|\\s*[-—–]\\s*(?:sacrifice|discard)\\s+a\\s+\\w+|\\s*[-—–])?';

const CAST_KEYWORD_REMINDER = '(?:\\s*\\([^)]*\\))?';

const CAST_KEYWORD_PREFIX = new RegExp(
  `^${CAST_KEYWORD}${CAST_KEYWORD_COST}${CAST_KEYWORD_REMINDER}(?:\\s+|$)`,
  'i',
);

const CAST_KEYWORD_ONLY = new RegExp(
  `^${CAST_KEYWORD}${CAST_KEYWORD_COST}${CAST_KEYWORD_REMINDER}\\.?$`,
  'i',
);

const CAST_KEYWORD_TRAILING = new RegExp(
  `\\s+(?:flashback|fuse|aftermath|cycling|suspend\\s+\\d+|reinforce\\s+\\d+)${CAST_KEYWORD_COST}${CAST_KEYWORD_REMINDER}\\.?$`,
  'i',
);

export function stripLeadingCastKeywordPrefix(clause: string): string {
  let working = String(clause || '').trim();
  if (!working) return working;

  for (let i = 0; i < 4; i += 1) {
    if (CAST_KEYWORD_ONLY.test(working)) return '';
    const match = working.match(CAST_KEYWORD_PREFIX);
    if (!match) break;
    const remainder = working.slice(match[0].length).trim();
    if (!remainder) return '';
    working = remainder;
  }

  return working;
}

export function stripTrailingCastKeywordSuffix(clause: string): string {
  return String(clause || '').replace(CAST_KEYWORD_TRAILING, '').trim();
}
