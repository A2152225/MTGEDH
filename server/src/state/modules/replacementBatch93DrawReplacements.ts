// server/src/state/modules/replacementBatch93DrawReplacements.ts
// B93: Quantum Riddler (draw N becomes N+1 while you have one or fewer cards
// in hand) and Archmage Ascension (optional search-your-library instead of
// drawing, while the source has six or more quest counters).
// Public: parseBatch93DrawSentence, collectBatch93DrawReplacementSpecs,
// collectBatch93DrawReplacementSpecsFromState, applyQuantumRiddlerDrawBonus,
// applyArchmageAscensionSearchInstead.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const RIDDLER_RE =
  /as long as you have (one|1|\d+) or fewer cards in hand, if you would draw (one|1|\d+) or more cards, you draw that many (?:cards )?plus (one|1|\d+) instead/i;
const ARCHMAGE_RE =
  /as long as (?:this enchantment|this permanent|~|[^.]+?) has (six|6|\d+) or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle/i;

export function parseBatch93DrawSentence(oracle: string): Array<{ kind: 'draw-plus-while-hand-at-most'; handMax: number; plus: number } | { kind: 'optional-search-instead'; minQuest: number }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ kind: 'draw-plus-while-hand-at-most'; handMax: number; plus: number } | { kind: 'optional-search-instead'; minQuest: number }> = [];
  const r = text.match(RIDDLER_RE);
  if (r) {
    const n = (raw: string) => WORD[raw] ?? parseInt(raw, 10);
    const handMax = n(String(r[1] || '1'));
    const plus = n(String(r[3] || '1'));
    if (handMax >= 0 && plus > 0) out.push({ kind: 'draw-plus-while-hand-at-most', handMax, plus });
  }
  const a = text.match(ARCHMAGE_RE);
  if (a) {
    const minQuest = WORD[String(a[1] || 'six')] ?? parseInt(String(a[1] || '6'), 10);
    if (minQuest > 0) out.push({ kind: 'optional-search-instead', minQuest });
  }
  return out;
}

function handCount(state: any, playerId: string): number {
  const hand = state?.zones?.[playerId]?.hand;
  return Array.isArray(hand) ? hand.length : 0;
}

function questCountersOn(perm: any): number {
  const c = perm?.counters || {};
  return Number(c.quest ?? c['quest'] ?? 0) || 0;
}

export function collectBatch93DrawReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
  extras?: { questCounters?: number },
): ReplacementEffectSpec[] {
  return parseBatch93DrawSentence(oracle).map((entry, i) => {
    if (entry.kind === 'draw-plus-while-hand-at-most') {
      return {
        id: `${source.sourcePermanentId}:draw-plus-while-hand-at-most${i ? `-${i}` : ''}`,
        event: 'card-draw' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { drawingPlayerIsSourceController: true },
        instead: { modify: 'add_flat' as const, value: entry.plus },
        effectId: 'draw-plus-while-hand-at-most',
        reason: 'draw_plus_while_hand_at_most',
        metadata: { handMax: entry.handMax, plus: entry.plus, appliesToWholeDrawEvent: true },
      } as ReplacementEffectSpec;
    }
    return {
      id: `${source.sourcePermanentId}:optional-search-instead-of-draw${i ? `-${i}` : ''}`,
      event: 'card-draw' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { drawingPlayerIsSourceController: true },
      instead: { choiceRequired: true },
      effectId: 'optional-search-instead-of-draw',
      reason: 'optional_search_instead_of_draw',
      metadata: { minQuest: entry.minQuest, questCounters: extras?.questCounters ?? 0 },
    } as ReplacementEffectSpec;
  });
}

export function collectBatch93DrawReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string }; counters?: Record<string, number> };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch93DrawReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }, { questCounters: questCountersOn(rec) }));
  }
  return specs;
}

/** Apply +N once to a whole draw event when the controller's hand is at most handMax. */
export function applyQuantumRiddlerDrawBonus(state: any, playerId: string, count: number): number {
  const pid = String(playerId || '');
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!pid || n <= 0) return n;
  const specs = collectBatch93DrawReplacementSpecsFromState(state).filter((s) =>
    s.effectId === 'draw-plus-while-hand-at-most' && String(s.sourceController) === pid,
  );
  if (!specs.length) return n;
  let total = n;
  for (const spec of specs) {
    const handMax = Number((spec.metadata as any)?.handMax ?? 1);
    const plus = Number((spec.metadata as any)?.plus ?? 1);
    if (handCount(state, pid) <= handMax) total += plus;
  }
  return total;
}

/**
 * Replace a single card-draw with a library search if the player opted in and
 * the source still has enough quest counters. Does not itself prompt.
 */
export function applyArchmageAscensionSearchInstead(
  state: any,
  playerId: string,
  chosenCardId: string,
): { applied: boolean; drawn?: any; reason?: string } {
  const pid = String(playerId || '');
  const empty = { applied: false as const };
  if (!pid || !state) return { ...empty, reason: 'missing-state' };
  const specs = collectBatch93DrawReplacementSpecsFromState(state).filter((s) =>
    s.effectId === 'optional-search-instead-of-draw' && String(s.sourceController) === pid,
  );
  const ready = specs.find((s) => Number((s.metadata as any)?.questCounters ?? 0) >= Number((s.metadata as any)?.minQuest ?? 6));
  if (!ready) return { ...empty, reason: 'not-ready' };
  const library: any[] = Array.isArray(state.zones?.[pid]?.library) ? state.zones[pid].library : [];
  const idx = library.findIndex((c: any) => String(c?.id || c?.card?.id || '') === String(chosenCardId));
  if (idx < 0) return { ...empty, reason: 'card-not-in-library' };
  const [picked] = library.splice(idx, 1);
  state.zones[pid].hand = Array.isArray(state.zones[pid].hand) ? state.zones[pid].hand : [];
  state.zones[pid].hand.push(picked);
  // Caller shuffles; we mark the library as needing a shuffle.
  state.zones[pid].library = library;
  state.zones[pid].libraryNeedsShuffle = true;
  return { applied: true, drawn: picked };
}
