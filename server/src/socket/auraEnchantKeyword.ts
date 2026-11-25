/**
 * Aura detection and Enchant-keyword parsing.
 *
 * Type line "Aura" is not enough to know a card targets as it is cast, and
 * "Enchant ..." is often not the first oracle line (Flash, Kicker, etc.).
 * Find the Enchant keyword line anywhere in the oracle text.
 */

export function findEnchantKeywordClause(oracleText: string | null | undefined): string | null {
  const text = String(oracleText || '');
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\([^)]*\)/g, ' ').trim();
    if (/^enchant\s+\S/i.test(line)) return line;
  }
  const m = text.match(/(?:^|[\n\r.;])\s*(enchant\s+(?:player|opponent|permanent|artifact|creature|land|enchantment|planeswalker)\b[^\n]*)/i);
  return m ? m[1].trim() : null;
}

export function isAuraSpell(typeLine?: string | null, oracleText?: string | null): boolean {
  if (!/\baura\b/i.test(String(typeLine || ''))) return false;
  return findEnchantKeywordClause(oracleText) != null;
}
