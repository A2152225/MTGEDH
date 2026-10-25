// server/src/state/modules/playersCantDrawCards.ts
// "Players can't draw cards." (Maralen of the Mornsong, Omen Machine) and
// "Your opponents can't draw cards." A prohibited draw does nothing: it is not
// a draw from an empty library (CR 101.2, 121.3) and draw triggers don't fire.
// Public entry symbols: isCardDrawProhibited.

const ALL_RE = /(?:^|[\n.]\s*)players can(?:'t|not) draw cards\b/i;
const OPP_RE = /(?:^|[\n.]\s*)your opponents can(?:'t|not) draw cards\b/i;

export function isCardDrawProhibited(state: any, playerId: string): boolean {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const pid = String(playerId || '');
  for (const perm of battlefield) {
    if (!perm || perm.phasedOut) continue;
    const text = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
    if (ALL_RE.test(text)) return true;
    if (OPP_RE.test(text) && String(perm.controller || '') !== pid) return true;
  }
  return false;
}
