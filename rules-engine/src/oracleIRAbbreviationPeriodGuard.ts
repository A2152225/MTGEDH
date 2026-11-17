/**
 * Origin: oracleIRParserUtils.ts `splitIntoClauses` and triggerEffectTextExtraction.ts `splitSentences`.
 * Cluster: title-abbreviation period guard (e.g. "Dr. Crusher" must not split into two sentences).
 * Public entry: shouldSkipSentencePeriodSplit.
 */

const TITLE_ABBREVIATION_BEFORE_PERIOD = /(?:^|\s)(?:Dr|Mr|Mrs|Ms|Lt|St|Capt|Gen|Col|Sgt|Prof|Rev)$/;

/**
 * True when a "." after `textBeforePeriod` ends a title abbreviation (Dr., Mr., ...) and the text
 * after the period starts with an uppercase letter (a name), so it is not a sentence boundary.
 */
export function shouldSkipSentencePeriodSplit(textBeforePeriod: string, textAfterPeriod: string): boolean {
  if (!TITLE_ABBREVIATION_BEFORE_PERIOD.test(String(textBeforePeriod || ''))) return false;
  const nextNonSpace = String(textAfterPeriod || '').match(/\S/)?.[0] ?? '';
  return /^[A-Z]$/.test(nextNonSpace);
}
