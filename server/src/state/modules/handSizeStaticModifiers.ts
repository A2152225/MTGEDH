/**
 * Batch 23: static maximum hand size modifiers (CR 402.2).
 *  - "Your maximum hand size is N" (Null Profusion, Recycle, Necrodominance) sets the base.
 *  - "Your maximum hand size is increased/reduced by N" (Trusted Advisor, Thought Eater).
 *  - "Each opponent's maximum hand size is reduced by N" (Locust Miser, Jin-Gitaxias, Core Augur).
 *  - "Your maximum hand size is equal to the number of hour counters on this" (Midnight Oil).
 * Public entry symbols: computeStaticMaxHandSize.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseCount(raw: string): number | null {
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  return raw in NUMBER_WORDS ? NUMBER_WORDS[raw] : null;
}

function rec(obj: unknown): Record<string, unknown> | null {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
}

function oracleOf(perm: unknown): string {
  const text = rec(rec(perm)?.card)?.oracle_text;
  return typeof text === 'string' ? text.toLowerCase().replace(/\u2019/g, "'") : '';
}

const SET_RE = /\byour maximum hand size is (\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?! less| more)/g;
// B75: Cursed Rack — "The chosen player's maximum hand size is four."
const CHOSEN_SET_RE = /\bthe chosen player's maximum hand size is (\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g;
const MOD_RE = /\b(your|each opponent's|each player's) maximum hand size is (increased|reduced) by (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/g;
// B67: Midnight Oil — "Your maximum hand size is equal to the number of hour counters on this enchantment."
const EQUAL_COUNTERS_RE =
  /\byour maximum hand size is equal to the number of ([a-z0-9+/]+) counters? on (?:this(?: enchantment| artifact| permanent| card)?|~)\b/g;
// B77: Winter — delirium opponent hand size = 7 minus GY card types.
const DELIRIUM_OPP_HAND_RE =
  /as long as there are (\w+) or more card types among cards in your graveyard, each opponent's maximum hand size is equal to seven minus the number of those card types/g;

const CARD_TYPES = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery', 'tribal'];

function graveyardCardTypeCount(state: unknown, controller: string): number {
  const zones = rec(rec(state)?.zones) || {};
  const gy = rec(zones[controller])?.graveyard;
  if (!Array.isArray(gy)) return 0;
  const seen = new Set<string>();
  for (const card of gy) {
    const line = String(rec(rec(card)?.card)?.type_line || rec(card)?.type_line || '').toLowerCase();
    for (const t of CARD_TYPES) {
      if (new RegExp('\\b' + t + '\\b').test(line)) seen.add(t === 'tribal' ? 'kindred' : t);
    }
  }
  return seen.size;
}

function counterCount(perm: Record<string, unknown>, counterType: string): number {
  const counters = rec(perm.counters) || {};
  const wanted = counterType.toLowerCase();
  for (const [key, value] of Object.entries(counters)) {
    if (String(key).toLowerCase() === wanted) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
  }
  return 0;
}

export function computeStaticMaxHandSize(
  battlefield: unknown,
  playerId: string,
  base = 7,
  state?: unknown,
): number {
  if (!Array.isArray(battlefield)) return base;
  let size = base;
  let delta = 0;
  for (const perm of battlefield as unknown[]) {
    const r = rec(perm);
    if (!r || r.phasedOut === true) continue;
    const oracle = oracleOf(perm);
    if (!oracle.includes('maximum hand size')) continue;
    const mine = r.controller === playerId;
    if (mine) {
      for (const m of oracle.matchAll(SET_RE)) {
        const n = parseCount(m[1]);
        if (n !== null) size = n;
      }
      for (const m of oracle.matchAll(EQUAL_COUNTERS_RE)) {
        size = counterCount(r, m[1] || '');
      }
    }
    // B75: chosen-player hand-size set (Cursed Rack).
    for (const m of oracle.matchAll(CHOSEN_SET_RE)) {
      const chosen = String(
        r.chosenPlayer || r.chosenPlayerId || r.chosenOpponentId
        || rec(r.card)?.chosenPlayer || rec(r.card)?.chosenPlayerId || '',
      );
      if (!chosen || chosen !== playerId) continue;
      const n = parseCount(m[1]);
      if (n !== null) size = n;
    }
    // B77: Winter delirium — each opponent's max hand size = 7 - GY card types.
    for (const m of oracle.matchAll(DELIRIUM_OPP_HAND_RE)) {
      if (mine) continue;
      const threshold = parseCount(m[1] || '');
      if (threshold === null) continue;
      const types = graveyardCardTypeCount(state, String(r.controller || ''));
      if (types < threshold) continue;
      size = Math.min(size, Math.max(0, 7 - types));
    }
    for (const m of oracle.matchAll(MOD_RE)) {
      const applies = m[1] === "each player's" || (m[1] === 'your' ? mine : !mine);
      const n = parseCount(m[3]);
      if (!applies || n === null) continue;
      delta += m[2] === 'increased' ? n : -n;
    }
  }
  return Math.max(0, size + delta);
}
