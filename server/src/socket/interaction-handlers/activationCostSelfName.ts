/**
 * socket/interaction-handlers/activationCostSelfName.ts
 *
 * Oracle text names the source in some activation costs ("Sacrifice Test Legend",
 * "Exile Perpetual Timepiece" in older printings, legendary short names). Cost handlers recognize
 * self references as "~" / "this ...", so rewrite the printed name (full name, each face of a
 * multi-face card, and the short name before a comma) to "~" in the cost text only.
 *
 * Public entry symbols: normalizeSelfNameInActivationCost.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
}

function selfNameVariants(cardName: string): string[] {
  const names = new Set<string>();
  for (const face of String(cardName || '').split(/\s*\/\/\s*/)) {
    const full = face.trim();
    if (full.length < 3) continue;
    names.add(full);
    const comma = full.indexOf(',');
    if (comma >= 3) names.add(full.slice(0, comma).trim());
  }
  // Longest first so "Ob Nixilis, the Adversary" wins over "Ob Nixilis".
  return [...names].sort((a, b) => b.length - a.length);
}

/** Replace the source's printed name with "~" inside an activation cost string. */
export function normalizeSelfNameInActivationCost(costText: string, cardName: string): string {
  let out = String(costText || '');
  if (!out) return out;
  for (const name of selfNameVariants(cardName)) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'gi');
    out = out.replace(re, (_m, lead: string) => `${lead}~`);
  }
  return out;
}
