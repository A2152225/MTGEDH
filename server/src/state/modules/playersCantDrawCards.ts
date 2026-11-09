// server/src/state/modules/playersCantDrawCards.ts
// "Players can't draw cards." (Maralen of the Mornsong, Omen Machine) and
// "Your opponents can't draw cards." A prohibited draw does nothing: it is not
// a draw from an empty library (CR 101.2, 121.3) and draw triggers don't fire.
// B56: also "Each player/opponent can't draw more than N card(s) each turn"
// (Spirit of the Labyrinth / Narset, Parter of Veils / Leovold).
// Public entry symbols: isCardDrawProhibited, getCardDrawCapRemaining.

const ALL_RE = /(?:^|[\n.]\s*)players can(?:'t|not) draw cards\b/i;
const OPP_RE = /(?:^|[\n.]\s*)your opponents can(?:'t|not) draw cards\b/i;
const ALL_CAP_RE = /(?:^|[\n.]\s*)each player can(?:'t|not) draw more than (\w+) cards? each turn\b/i;
const OPP_CAP_RE = /(?:^|[\n.]\s*)each opponent can(?:'t|not) draw more than (\w+) cards? each turn\b/i;

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCountWord(raw: string): number {
  const lower = String(raw || '').trim().toLowerCase();
  if (COUNT_WORDS[lower] != null) return COUNT_WORDS[lower];
  const n = Number.parseInt(lower, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function oracleText(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
}

/**
 * Remaining draws allowed this turn under per-turn caps, or null when unlimited.
 * Absolute "can't draw cards" yields 0.
 */
export function getCardDrawCapRemaining(state: any, playerId: string): number | null {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const pid = String(playerId || '');
  const drawn = Number(state?.cardsDrawnThisTurn?.[pid] || 0);
  let cap: number | null = null;

  for (const perm of battlefield) {
    if (!perm || perm.phasedOut) continue;
    const text = oracleText(perm);
    if (ALL_RE.test(text)) return 0;
    if (OPP_RE.test(text) && String(perm.controller || '') !== pid) return 0;

    const allCap = text.match(ALL_CAP_RE);
    if (allCap) {
      const n = parseCountWord(allCap[1]);
      if (n > 0) cap = cap == null ? n : Math.min(cap, n);
    }
    const oppCap = text.match(OPP_CAP_RE);
    if (oppCap && String(perm.controller || '') !== pid) {
      const n = parseCountWord(oppCap[1]);
      if (n > 0) cap = cap == null ? n : Math.min(cap, n);
    }
  }

  if (cap == null) return null;
  return Math.max(0, cap - drawn);
}

export function isCardDrawProhibited(state: any, playerId: string): boolean {
  const remaining = getCardDrawCapRemaining(state, playerId);
  return remaining === 0;
}
