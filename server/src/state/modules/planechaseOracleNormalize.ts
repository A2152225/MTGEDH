/**
 * Normalize Planechase / Archenemy oracle phrasing for trigger parsers and IR.
 * Older plane printings say "Whenever you roll {CHAOS}"; modern oracle uses
 * "Whenever chaos ensues". Phenomenon encounter and scheme-in-motion phrasing
 * is left intact.
 *
 * Public: normalizePlanechaseOracleText, isPlaneTypeLine, isPhenomenonTypeLine,
 * isSchemeTypeLine, isOngoingSchemeTypeLine, extractPlaneWorld.
 */

export function isPlaneTypeLine(typeLine: unknown): boolean {
  return /\bplane\b/i.test(String(typeLine || '')) && !/\bplaneswalker\b/i.test(String(typeLine || ''));
}

export function isPhenomenonTypeLine(typeLine: unknown): boolean {
  return /\bphenomenon\b/i.test(String(typeLine || ''));
}

export function isSchemeTypeLine(typeLine: unknown): boolean {
  return /\bscheme\b/i.test(String(typeLine || ''));
}

export function isOngoingSchemeTypeLine(typeLine: unknown): boolean {
  return /\bongoing\s+scheme\b/i.test(String(typeLine || ''));
}

export function extractPlaneWorld(typeLine: unknown): string | null {
  const match = String(typeLine || '').match(/\bplane\s*[—–-]\s*(.+)$/i);
  const world = String(match?.[1] || '').trim();
  return world || null;
}

/**
 * Rewrite chaos-symbol roll wording to the modern "chaos ensues" trigger so
 * triggerCondition / detectAbilityActivatedTriggers share one event family.
 */
export function normalizePlanechaseOracleText(oracleText: unknown): string {
  let text = String(oracleText || '');
  if (!text) return '';

  // Normalize chaos symbol glyphs / tokens before phrase rewrite.
  text = text
    .replace(/\{CHAOS\}/gi, '{CHAOS}')
    .replace(/\uE890/g, '{CHAOS}'); // Scryfall private-use chaos glyph when present

  text = text.replace(
    /whenever you roll \{CHAOS\},?/gi,
    'Whenever chaos ensues,',
  );
  text = text.replace(
    /whenever you roll the chaos symbol,?/gi,
    'Whenever chaos ensues,',
  );
  // Leading chaos symbol on its own line before the ability body.
  text = text.replace(/(^|\n)\s*\{CHAOS\}\s*(?=\S)/gi, '$1Whenever chaos ensues, ');
  text = text.replace(/whenever\s+chaos\s+ensues,?/gi, 'Whenever chaos ensues,');

  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
