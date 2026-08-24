export function isPermanentTypeLine(typeLine?: string): boolean {
  if (!typeLine) return false;
  const tl = typeLine.toLowerCase();
  if (/\binstant\b/.test(tl) || /\bsorcery\b/.test(tl)) return false;
  return /\b(creature|artifact|enchantment|planeswalker|battle)\b/.test(tl);
}

/**
 * Permanent *card* test (rule 110.4a) for cards outside the battlefield, e.g.
 * "target permanent card in your graveyard". Unlike isPermanentTypeLine, which
 * gates permanent spells, this includes lands.
 */
export function isPermanentCardTypeLine(typeLine?: string): boolean {
  const tl = String(typeLine || '').toLowerCase();
  if (!tl) return false;
  return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some((type) =>
    tl.includes(type),
  );
}
