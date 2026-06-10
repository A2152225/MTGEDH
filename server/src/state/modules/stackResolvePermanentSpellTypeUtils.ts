export function isPermanentTypeLine(typeLine?: string): boolean {
  if (!typeLine) return false;
  const tl = typeLine.toLowerCase();
  if (/\binstant\b/.test(tl) || /\bsorcery\b/.test(tl)) return false;
  return /\b(creature|artifact|enchantment|planeswalker|battle)\b/.test(tl);
}
