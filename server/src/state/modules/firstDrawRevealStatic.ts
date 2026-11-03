// server/src/state/modules/firstDrawRevealStatic.ts
// B51: "Reveal the first card you draw each turn" / "... on each of your turns" (Primitive Etchings, Rowen,
// Keranos, Serendib Djinn-style reveal statics). This is a static instruction applied at the draw point: the
// first card a player draws each turn is revealed while a permanent they control has the text. The
// "Whenever you reveal a <kind> card this way" follow-up triggers stay in triggers/card-draw.ts (trigger worker).
// Origin parent: zones-handlers/zonesDrawCards.ts processDrawTriggers (draw-number bookkeeping lives there).
// Public entry symbols: FIRST_DRAW_REVEAL_RE, firstDrawRevealSources, applyFirstDrawReveal.

export const FIRST_DRAW_REVEAL_RE = /\breveal the first card you draw (each turn|on each of your turns)\b/i;

const MAX_REVEAL_LOG = 20;

/** Names of permanents controlled by playerId that reveal that player's first draw this turn. */
export function firstDrawRevealSources(state: any, playerId: string): string[] {
  const out: string[] = [];
  const active = String(state?.turnPlayer || state?.activePlayer || '');
  for (const perm of state?.battlefield || []) {
    if (!perm || perm.faceDown || String(perm.controller || '') !== String(playerId)) continue;
    const m = FIRST_DRAW_REVEAL_RE.exec(String(perm?.card?.oracle_text || ''));
    if (!m) continue;
    if (m[1].toLowerCase() === 'on each of your turns' && active !== String(playerId)) continue;
    const name = String(perm?.card?.name || 'Permanent');
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Reveals drawnCard when it is the player's first draw this turn and a reveal source applies.
 * Marks the hand card (revealedOnDraw) and records state.revealedDraws / state.lastRevealedDraw for views
 * and logs. Returns the revealing source names (empty when nothing was revealed).
 */
export function applyFirstDrawReveal(ctx: any, playerId: string, drawNumber: number, drawnCard: any): string[] {
  const state = ctx?.state;
  if (!state || drawNumber !== 1 || !drawnCard) return [];
  const sources = firstDrawRevealSources(state, playerId);
  if (!sources.length) return [];
  const turn = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  try { drawnCard.revealedOnDraw = sources; } catch { /* frozen ref */ }
  const entry = {
    playerId: String(playerId),
    cardId: String(drawnCard.id || ''),
    name: String(drawnCard.name || ''),
    type_line: String(drawnCard.type_line || ''),
    revealedBy: sources,
    turn,
  };
  state.lastRevealedDraw = entry;
  const log = Array.isArray(state.revealedDraws) ? state.revealedDraws : (state.revealedDraws = []);
  log.push(entry);
  if (log.length > MAX_REVEAL_LOG) log.splice(0, log.length - MAX_REVEAL_LOG);
  return sources;
}
