/**
 * Generic kicker cost helpers for on-cast intervening-if clauses
 * ("if it was kicked" / "if it was kicked with its {G} kicker").
 */

export function normalizeKickerManaCost(cost: string): string {
  return String(cost || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\{([WUBRGC\d]+)\}/gi, (_, inner: string) => `{${String(inner).toUpperCase()}}`);
}

/** Parse "Kicker {G}" / "Kicker {G} and/or {1}{U}" into distinct cost options. */
export function parseKickerCostOptions(oracleText: string): string[] {
  const text = String(oracleText || '');
  const match = text.match(/\bkicker\s+((?:\{[^}]+\}(?:\s*(?:and\/or|or|,)\s*)?)+)/i);
  if (!match) return [];
  const raw = String(match[1] || '');
  const costs: string[] = [];
  for (const piece of raw.matchAll(/\{[^}]+\}(?:\s*\{[^}]+\})*/g)) {
    const normalized = normalizeKickerManaCost(String(piece[0] || ''));
    if (normalized && !costs.includes(normalized)) costs.push(normalized);
  }
  return costs;
}

export function collectPaidKickerCosts(source: any): string[] {
  if (!source || typeof source !== 'object') return [];
  const fromArray = Array.isArray(source.paidKickerCosts)
    ? source.paidKickerCosts
    : Array.isArray(source.card?.paidKickerCosts)
      ? source.card.paidKickerCosts
      : [];
  const out: string[] = [];
  for (const entry of fromArray) {
    const normalized = normalizeKickerManaCost(String(entry || ''));
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export function sourceWasKicked(source: any): boolean | null {
  if (!source || typeof source !== 'object') return null;
  const explicit = source.wasKicked ?? source.card?.wasKicked;
  if (typeof explicit === 'boolean') return explicit;
  const count = Number(
    source.kickerPaidCount
    ?? source.timesKicked
    ?? source.kickedTimes
    ?? source.card?.kickerPaidCount
    ?? source.card?.timesKicked
    ?? source.card?.kickedTimes,
  );
  if (Number.isFinite(count)) return count > 0 ? true : null;
  const paid = collectPaidKickerCosts(source);
  if (paid.length > 0) return true;
  return null;
}

export function sourceWasKickedWithCost(source: any, costText: string): boolean | null {
  const wanted = normalizeKickerManaCost(costText);
  if (!wanted) return sourceWasKicked(source);
  const paid = collectPaidKickerCosts(source);
  if (paid.length > 0) {
    return paid.some((cost) => cost === wanted);
  }
  // No per-cost ledger: fall back to generic kicked flag (best-effort).
  return sourceWasKicked(source);
}
