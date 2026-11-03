// server/src/state/modules/viewFirstDrawReveal.ts
// View-side projection for B51 first-draw reveal statics (Primitive Etchings, Rowen): the hand card that
// applyFirstDrawReveal flagged (revealedOnDraw) is shown face up to every viewer, but only during the turn it
// was drawn and only while it is still the recorded reveal (state.revealedDraws). Face-down cards stay hidden.
// Mutates only the per-viewer view zones it is given.
// Public entry symbols: applyFirstDrawRevealToZones.

export function applyFirstDrawRevealToZones(state: any, zones: Record<string, any>): void {
  const log = Array.isArray(state?.revealedDraws) ? state.revealedDraws : [];
  if (!log.length || !zones) return;
  const turn = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  const byCard = new Map<string, any>();
  for (const e of log) if (e && Number(e.turn) === turn && e.cardId) byCard.set(String(e.playerId) + "|" + String(e.cardId), e);
  if (!byCard.size) return;
  for (const [pid, z] of Object.entries(zones)) {
    if (!z || !Array.isArray(z.hand)) continue;
    z.hand = z.hand.map((c: any) => {
      if (!c || c.faceDown || !Array.isArray(c.revealedOnDraw) || !c.revealedOnDraw.length) return c;
      const e = byCard.get(String(pid) + "|" + String(c.id));
      return e ? { ...c, known: true, revealedBy: c.revealedOnDraw } : c;
    });
  }
}
