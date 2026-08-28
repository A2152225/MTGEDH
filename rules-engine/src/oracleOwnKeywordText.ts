// Shared helper for "does this card's own oracle give IT keyword X?"
// Distinct from lord grants ("Other Dinosaurs you control have haste") and
// token-create tails ("create a ... token with haste").
// Public entry symbols: oracleTextHasOwnKeyword, oracleTextGrantsKeywordOnlyToOthers,
// grantedAbilityIsOwnKeyword.

import { stripCreateTokenGrantedAbilities } from './oracleReminderText.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `oracleText` prints the keyword on this permanent itself
 * (standalone keyword line/list, or "this creature has/gains X").
 * False for grants to others, including "Other [type]s you control have X".
 */
export function oracleTextHasOwnKeyword(oracleText: string, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const escaped = escapeRegExp(kw);

  const stripped = stripCreateTokenGrantedAbilities(String(oracleText || ''))
    .replace(/\([^)]*\)/g, ' ');

  const withoutOtherGrants = stripped.replace(
    new RegExp(
      String.raw`\bother\b[^.?\n]*\b(?:have|has|gains?)\b[^.?\n]*\b${escaped}\b[^.?\n]*`,
      'gi',
    ),
    ' ',
  );

  const standalone = new RegExp(
    String.raw`(^|[\n,.;])\s*${escaped}(?:\s*$|\s*[,.]|\s*\()`,
    'im',
  );
  if (standalone.test(withoutOtherGrants)) return true;

  const selfHas = new RegExp(
    String.raw`\bthis (?:creature|permanent)\s+(?:has|gains?)\s+${escaped}\b`,
    'i',
  );
  return selfHas.test(withoutOtherGrants);
}

/**
 * True when the only mention of `keyword` is a grant to others
 * ("Other Dinosaurs you control have haste"), not a printed self keyword.
 */
export function oracleTextGrantsKeywordOnlyToOthers(oracleText: string, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  if (oracleTextHasOwnKeyword(oracleText, kw)) return false;
  const escaped = escapeRegExp(kw);
  return new RegExp(
    String.raw`\bother\b[^.?\n]*\b(?:have|has|gains?)\b[^.?\n]*\b${escaped}\b`,
    'i',
  ).test(String(oracleText || ''));
}

/**
 * True when a grantedAbilities entry is the keyword itself (or printed self-haste
 * text), not lord wording that happens to contain the word.
 */
export function grantedAbilityIsOwnKeyword(entry: unknown, keyword: string): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  const text = String(entry || '').trim().toLowerCase();
  if (!text) return false;
  if (text === kw) return true;
  return oracleTextHasOwnKeyword(text, kw);
}
