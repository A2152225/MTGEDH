// server/src/state/planeswalker/templates/resolve-handlers/loyaltyTemplateHelpers.ts
// Origin parent: server/src/state/planeswalker/templates/resolve.ts
// Cluster moved: shuffleInPlace, isNonAuraPermanentCard
// Public entry symbols: shuffleInPlace, isNonAuraPermanentCard
// Used by restartGameWithKarnExemptions and later loyalty template case families.

export function shuffleInPlace<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

export function isNonAuraPermanentCard(card: any): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (!typeLine) return false;

  // Explicitly exclude Auras.
  if (typeLine.includes('aura')) return false;

  // Permanent types.
  return (
    typeLine.includes('artifact') ||
    typeLine.includes('creature') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('land') ||
    typeLine.includes('planeswalker') ||
    typeLine.includes('battle')
  );
}
