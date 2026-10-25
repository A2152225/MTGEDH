import type { GameState, PlayerID } from '../../../../shared/src/types.js';

/**
 * Static "play with ... revealed" designations (Revelation, Wandering Eye, Telepathy,
 * Wizened Snitches, Field of Dreams, Future Sight style). Server-computed flags for the client:
 * state.revealedInformation = { handsRevealed, libraryTopRevealed, sources }.
 */
type RevealedInformation = NonNullable<GameState['revealedInformation']>;

function lower(text: unknown): string {
  return typeof text === 'string' ? text.toLowerCase().replace(/\u2019/g, "'") : '';
}

export function computeRevealedInformation(state: GameState): RevealedInformation {
  const players: PlayerID[] = (state.players || []).map(p => p.id);
  const hands = new Set<PlayerID>();
  const tops = new Set<PlayerID>();
  const sources = new Set<string>();
  const apply = (oracle: string, controller: PlayerID | undefined, name: string) => {
    let hit = false;
    if (/(?:^|[\n.]\s*)(?:players|each player) play(?:s)? with their hands? revealed/.test(oracle)) { players.forEach(p => hands.add(p)); hit = true; }
    else if (/your opponents play with their hands revealed/.test(oracle)) { players.forEach(p => { if (p !== controller) hands.add(p); }); hit = true; }
    if (controller && /(?:^|[\n.]\s*)(?:you )?play with your hand revealed/.test(oracle)) { hands.add(controller); hit = true; }
    if (/(?:players|each player) play(?:s)? with the top card of their librar(?:y|ies) revealed/.test(oracle)) { players.forEach(p => tops.add(p)); hit = true; }
    else if (controller && /(?:^|[\n.]\s*)(?:you )?play with the top card of your library revealed/.test(oracle)) { tops.add(controller); hit = true; }
    if (hit) sources.add(name);
  };
  for (const perm of state.battlefield || []) {
    if (!perm || !perm.card) continue;
    apply(lower(perm.card.oracle_text), perm.controller, String(perm.card.name || 'permanent'));
  }
  const plane: unknown = Reflect.get(state, 'activePlane');
  if (plane && typeof plane === 'object') {
    const rec = plane as Record<string, unknown>;
    apply(lower(rec.oracle_text), undefined, typeof rec.name === 'string' ? rec.name : 'plane');
  }
  return { handsRevealed: [...hands].sort(), libraryTopRevealed: [...tops].sort(), sources: [...sources].sort() };
}

/** Refresh state.revealedInformation; returns true when the flags changed. */
export function refreshRevealedInformationFlags(state: GameState): boolean {
  const next = computeRevealedInformation(state);
  const empty = !next.handsRevealed.length && !next.libraryTopRevealed.length;
  const prev = state.revealedInformation;
  if (empty && !prev) return false;
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return false;
  if (empty) { delete state.revealedInformation; return true; }
  state.revealedInformation = next;
  return true;
}
