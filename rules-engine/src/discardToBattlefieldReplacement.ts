/**
 * discardToBattlefieldReplacement.ts
 *
 * Replacement reader (Loxodon Smiter, Wilt-Leaf Liege, Obstinate Baloth, Dodecapod...):
 * "If a spell or ability an opponent controls causes you to discard ~, put it onto the battlefield
 *  [with N +1/+1 counters on it] instead of putting it into your graveyard."
 * Applied after a discard commits: matching cards discarded because of an opponent-controlled
 * source move from the graveyard to the battlefield.
 */
import type { GameState, PlayerID } from '../../shared/src';

const RE =
  /if a spell or ability an opponent controls causes you to discard (?:this card|~|[^,]+?), put it onto the battlefield(?: with (a|an|one|two|three|\d+) \+1\/\+1 counters? on it)? instead of putting it into your graveyard/i;

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };

export function matchDiscardToBattlefieldReplacement(oracleText: string): { plusOneCounters: number } | null {
  const m = String(oracleText || '').match(RE);
  if (!m) return null;
  const raw = (m[1] || '').toLowerCase();
  const n = raw ? (WORDS[raw] ?? (Number(raw) || 0)) : 0;
  return { plusOneCounters: n };
}

export function applyDiscardToBattlefieldReplacements(
  state: GameState,
  playerId: PlayerID,
  discardedCards: readonly any[],
  sourceControllerId: string | undefined,
): { state: GameState; redirected: string[] } {
  const redirected: string[] = [];
  if (!sourceControllerId || String(sourceControllerId) === String(playerId)) return { state, redirected };
  const hits = (discardedCards || [])
    .map((card: any) => ({ card, spec: matchDiscardToBattlefieldReplacement(String(card?.oracle_text || '')) }))
    .filter((h) => h.spec && h.card?.id);
  if (!hits.length) return { state, redirected };
  const ids = new Set(hits.map((h) => String(h.card.id)));
  const strip = (gy: any) => (Array.isArray(gy) ? gy.filter((c: any) => !ids.has(String(c?.id))) : gy);
  const players = (state.players || []).map((p: any) => (p.id === playerId ? { ...p, graveyard: strip(p.graveyard) } : p));
  const zones: any = { ...((state as any).zones || {}) };
  if (zones[playerId]) {
    const graveyard = strip(zones[playerId].graveyard);
    zones[playerId] = { ...zones[playerId], graveyard, graveyardCount: Array.isArray(graveyard) ? graveyard.length : zones[playerId].graveyardCount };
  }
  const battlefield = [...(((state as any).battlefield as any[]) || [])];
  for (const { card, spec } of hits) {
    const { zone: _z, ...cardData } = card || {};
    battlefield.push({
      id: String(card.id),
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSick: true,
      counters: spec!.plusOneCounters > 0 ? { '+1/+1': spec!.plusOneCounters } : {},
      card: { ...cardData, zone: 'battlefield' },
    });
    redirected.push(String(card.id));
  }
  return { state: { ...(state as any), players, zones, battlefield } as GameState, redirected };
}