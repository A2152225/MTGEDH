// Labels for cards revealed by "play with ... revealed" effects (state.revealedInformation, server view adds revealedBy).
export function revealedByLabel(names?: unknown): string | null {
  if (!Array.isArray(names)) return null;
  const list = names.map((n) => String(n || '').trim()).filter(Boolean);
  return list.length ? `Revealed by ${list.join(', ')}` : null;
}

/** True when the library top is revealed to every player (shown face up rather than as a peek). */
export function isLibraryTopRevealedToAll(top: unknown): boolean {
  return Boolean(top && (top as any).revealedToAll);
}
