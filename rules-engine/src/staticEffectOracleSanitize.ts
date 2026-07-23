/**
 * Sanitize oracle text before regex-based static-effect scans.
 * Loyalty abilities that create emblems quote the emblem's effect — that text must not
 * be treated as a continuous static ability on the source permanent (e.g. Elspeth, Sun's Champion).
 */

/** Remove "… gets an emblem with \"…\"" clauses (supports multiple quoted abilities). */
export function stripQuotedEmblemClausesForStaticScan(text: string): string {
  let result = String(text || '');
  result = result.replace(
    /(?:you|target player|target opponent|each opponent|as this (?:permanent|creature) enters, you) gets? an emblem with\s*,?\s*(?:"[^"]*"(?:\s+and\s+"[^"]*")*)/gi,
    '',
  );
  return result;
}

/** Backgrounds grant quoted triggered abilities to commanders — not static keyword grants. */
export function stripCommanderGrantedAbilityQuotesForStaticScan(text: string): string {
  return String(text || '').replace(/commander\s+creatures?\s+you\s+own\s+have\s+"[^"]*"/gi, '');
}

export function sanitizeOracleTextForStaticEffectScan(text: string): string {
  return stripCommanderGrantedAbilityQuotesForStaticScan(
    stripQuotedEmblemClausesForStaticScan(text),
  );
}
