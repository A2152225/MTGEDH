// server/src/state/modules/batch92SerumPowder.ts
// B92: "Any time you could mulligan and this card is in your hand, you may exile
// all the cards from your hand, then draw that many cards." This is an additional
// opening-hand action, not a replacement of the mulligan itself.
// Public: parseBatch92SerumPowderSentence, findSerumPowderInHand,
// applySerumPowderHandRestart, listSerumPowderOpeningHandActions.

import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const SERUM_RE =
  /any time you could mulligan and this card is in your hand, you may exile all the cards from your hand, then draw that many cards/i;

export function parseBatch92SerumPowderSentence(oracle: string): boolean {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  return SERUM_RE.test(text);
}

export function findSerumPowderInHand(state: any, playerId: string): any[] {
  const pid = String(playerId || '');
  const hand: any[] = state?.zones?.[pid]?.hand;
  return (Array.isArray(hand) ? hand : []).filter((c) => parseBatch92SerumPowderSentence(readCardOracleText(c?.card || c) || String(c?.oracle_text || '')));
}

/**
 * Exile the player's hand, then put that many cards from the library into the
 * hand. Does not itself consume a mulligan; the caller decides when the action
 * is legal (any time the player could mulligan).
 */
export function applySerumPowderHandRestart(state: any, playerId: string, sourceCardId?: string): { applied: boolean; exiled: any[]; drawn: any[]; reason?: string } {
  const pid = String(playerId || '');
  const empty = { applied: false, exiled: [] as any[], drawn: [] as any[] };
  if (!pid || !state) return { ...empty, reason: 'missing-state' };
  const copies = findSerumPowderInHand(state, pid);
  if (!copies.length) return { ...empty, reason: 'not-in-hand' };
  if (sourceCardId) {
    const ok = copies.some((c) => String(c?.id || c?.card?.id || '') === String(sourceCardId));
    if (!ok) return { ...empty, reason: 'source-not-in-hand' };
  }
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const hand: any[] = Array.isArray(state.zones[pid].hand) ? state.zones[pid].hand : [];
  const library: any[] = Array.isArray(state.zones[pid].library) ? state.zones[pid].library : [];
  const exile: any[] = Array.isArray(state.zones[pid].exile) ? state.zones[pid].exile : [];
  const count = hand.length;
  const exiled = hand.splice(0, hand.length);
  exile.push(...exiled);
  const drawn = library.splice(0, count);
  hand.push(...drawn);
  state.zones[pid].hand = hand;
  state.zones[pid].library = library;
  state.zones[pid].exile = exile;
  return { applied: true, exiled, drawn };
}

export function listSerumPowderOpeningHandActions(state: any, playerId: string): Array<{ sourceId: string; sourceName: string; description: string }> {
  return findSerumPowderInHand(state, playerId).map((c) => ({
    sourceId: String(c?.id || c?.card?.id || ''),
    sourceName: String(c?.name || c?.card?.name || 'Serum Powder'),
    description: 'Exile your hand, then draw that many cards (in addition to taking mulligans).',
  }));
}
