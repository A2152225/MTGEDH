// Batch 18: empty-library draw replacements (CR 614.11).
//  - "If you would draw a card while your library has no cards in it, instead put N +1/+1 counters on ~" (Ormos)
//  - "If you would draw a card while your library has no cards in it, skip that draw instead" (Living Conundrum)
// Called per draw from drawCards before evaluateDrawReplacementEvent; returns true when the draw was replaced.
// Public entry symbols: applyBatch18EmptyLibraryDrawInstead.

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

interface B18DrawPerm { id?: string; controller?: string; phasedOut?: boolean; counters?: Record<string, number>; card?: { name?: string; oracle_text?: string } }
export interface B18DrawState { battlefield?: B18DrawPerm[]; batch18DrawReplacements?: Array<{ playerId: string; sourceName: string; effect: string; timestamp?: number }> }

const RE = /if you would draw a card while your library has no cards in it, (?:instead put (\w+) \+1\/\+1 counters? on (?:~|this creature|it|[a-z'][a-z' -]*)|skip that draw instead)/;

export function applyBatch18EmptyLibraryDrawInstead(state: B18DrawState | undefined, playerId: string, libraryCount: number): boolean {
  if (!state || libraryCount > 0) return false;
  for (const p of Array.isArray(state.battlefield) ? state.battlefield : []) {
    if (!p?.card || p.phasedOut === true || String(p.controller || '') !== playerId) continue;
    const name = String(p.card.name || '');
    let oracle = String(p.card.oracle_text || '').toLowerCase();
    if (name) oracle = oracle.split(name.toLowerCase()).join('~');
    const m = oracle.match(RE);
    if (!m) continue;
    let effect = 'skipped the draw';
    if (m[1]) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
      if (!n) continue;
      p.counters = p.counters || {};
      p.counters['+1/+1'] = (Number(p.counters['+1/+1']) || 0) + n;
      effect = `put ${n} +1/+1 counter(s) instead of drawing`;
    }
    state.batch18DrawReplacements = Array.isArray(state.batch18DrawReplacements) ? state.batch18DrawReplacements : [];
    state.batch18DrawReplacements.push({ playerId, sourceName: name || 'Unknown', effect, timestamp: Date.now() });
    return true;
  }
  return false;
}