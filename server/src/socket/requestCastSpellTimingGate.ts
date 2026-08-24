/**
 * Origin: game-actions.ts (requestCastSpellForSocket).
 * Cluster: sorcery-speed flash grants at request time.
 * Entry: requestCastSpellGrantsFlash.
 *
 * Top-library permissions (Elsha, durable free-cast / flexible mana) grant flash
 * the same way completeCastSpell already honors canCastFromTop().grantsFlash.
 */

export function requestCastSpellGrantsFlash(options: {
  castSourceZone?: string;
  commanderGrantsFlash?: boolean;
  ignoreTimingRestrictions?: boolean;
  typeLine?: string;
  oracleText?: string;
  sneakGrantsTiming?: boolean;
  topLibraryGrantsFlash?: boolean;
}): boolean {
  const typeForTiming = String(options.typeLine || '').toLowerCase();
  const oracleForTiming = String(options.oracleText || '').toLowerCase();
  return (
    (options.castSourceZone === 'command' && options.commanderGrantsFlash === true)
    || options.ignoreTimingRestrictions === true
    || typeForTiming.includes('instant')
    || /\bflash\b/i.test(oracleForTiming)
    || options.sneakGrantsTiming === true
    || options.topLibraryGrantsFlash === true
  );
}
