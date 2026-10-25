// server/src/state/modules/caseSolve.ts
// Cases (MKM): at the beginning of the controller's end step, an unsolved Case whose "To solve"
// condition holds becomes solved (perm.solved = true), which turns on its "Solved \u2014" statics
// (condition kind source_is_solved). Unrecognised "To solve" conditions never solve.
// Public entry symbols: evaluateCaseSolveCondition, processCaseSolveAtEndStep.

import { debug } from '../../utils/debug.js';

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20,
};
const num = (word: string): number => NUMBER_WORDS[word.toLowerCase()] ?? (Number(word) || 0);
const typeLineOf = (perm: any): string => String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
const singular = (word: string): string => word.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');

export function caseSolveText(oracle: string): string | undefined {
  const match = String(oracle || '').match(/^To solve\s*[\u2014-]\s*([^\n(]+?)\.?\s*(?:\(|$)/im);
  return match ? match[1].trim() : undefined;
}

/** True/false when the condition is understood, undefined when it is not. */
export function evaluateCaseSolveCondition(text: string, controller: string, state: any): boolean | undefined {
  const t = String(text || '').trim().replace(/\.$/, '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const mine = battlefield.filter((perm) => String(perm?.controller || '') === controller);
  const zone = state?.zones?.[controller] || {};
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^You've gained (\w+) or more life this turn$/i))) {
    return Number(state?.lifeGainedThisTurn?.[controller] || 0) >= num(m[1]);
  }
  if ((m = t.match(/^You control (\w+) or more (\w+)$/i))) {
    const type = singular(m[2]);
    return mine.filter((perm) => new RegExp(`\\b${type}s?\\b`).test(typeLineOf(perm))).length >= num(m[1]);
  }
  if ((m = t.match(/^You control an? legendary (\w+)$/i))) {
    const type = singular(m[1]);
    return mine.some((perm) => /\blegendary\b/.test(typeLineOf(perm)) && new RegExp(`\\b${type}\\b`).test(typeLineOf(perm)));
  }
  if ((m = t.match(/^There are (\w+) or more cards in your graveyard$/i))) {
    return (Array.isArray(zone.graveyard) ? zone.graveyard.length : Number(zone.graveyardCount || 0)) >= num(m[1]);
  }
  if ((m = t.match(/^(\w+) or more creatures attacked this turn$/i))) {
    return battlefield.filter((perm) => perm?.attackedThisTurn === true && /\bcreature\b/.test(typeLineOf(perm))).length >= num(m[1]);
  }
  if ((m = t.match(/^Creatures you control have total power (\d+) or greater$/i))) {
    const total = mine.filter((perm) => /\bcreature\b/.test(typeLineOf(perm)))
      .reduce((sum, perm) => sum + Number(perm?.effectivePower ?? perm?.basePower ?? perm?.card?.power ?? 0), 0);
    return total >= Number(m[1]);
  }
  if (/^You have no cards in hand$/i.test(t)) {
    return (Array.isArray(zone.hand) ? zone.hand.length : Number(zone.handCount || 0)) === 0;
  }
  if (/^There are five colors among permanents you control$/i.test(t)) {
    const colors = new Set<string>();
    for (const perm of mine) for (const c of (Array.isArray(perm?.card?.colors) ? perm.card.colors : [])) colors.add(String(c).toUpperCase());
    return ['W', 'U', 'B', 'R', 'G'].every((c) => colors.has(c));
  }
  if ((m = t.match(/^(\w+) or more creatures are damaged$/i))) {
    return battlefield.filter((perm) => /\bcreature\b/.test(typeLineOf(perm))
      && Number(perm?.damage ?? perm?.markedDamage ?? perm?.damageMarked ?? 0) > 0).length >= num(m[1]);
  }
  return undefined;
}

/**
 * CR 719.3c: "To solve" is a triggered ability with an intervening-if: "At the beginning of your end step,
 * if this Case is not solved and its requirement is met, solve it." Returns end-step triggers (tagged
 * stackItem.caseSolve) for the end-step trigger push so they use the stack, APNAP ordering and replay.
 */
export function getCaseSolveEndStepTriggers(ctx: any, turnPlayer: string): any[] {
  const state = ctx?.state;
  const out: any[] = [];
  for (const perm of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!perm || perm.solved === true || String(perm.controller || '') !== turnPlayer) continue;
    if (!/\bcase\b/.test(typeLineOf(perm))) continue;
    const text = caseSolveText(String(perm.card?.oracle_text || ''));
    if (!text || evaluateCaseSolveCondition(text, turnPlayer, state) !== true) continue;
    out.push({
      permanentId: perm.id,
      cardName: perm.card?.name || 'Case',
      controllerId: turnPlayer,
      description: 'Solve this Case.',
      effect: 'Solve this Case.',
      mandatory: true,
      imageUrl: perm.card?.image_uris?.small || perm.card?.image_uris?.normal,
      stackItem: { caseSolve: true, caseSolvePermanentId: perm.id },
    });
  }
  return out;
}

/** Resolves a caseSolve-tagged trigger (re-checking the intervening-if). True when handled. */
export function tryResolveCaseSolveTrigger(ctx: any, item: any): boolean {
  if (!item || item.caseSolve !== true) return false;
  const state = ctx?.state;
  const permId = String(item.caseSolvePermanentId || item.source || '');
  const perm = (Array.isArray(state?.battlefield) ? state.battlefield : []).find((p: any) => p?.id === permId);
  const controller = String(perm?.controller || '');
  const text = perm ? caseSolveText(String(perm.card?.oracle_text || '')) : undefined;
  if (perm && perm.solved !== true && text && evaluateCaseSolveCondition(text, controller, state) === true) {
    perm.solved = true;
    debug(2, `[case] ${perm.card?.name || perm.id} is solved`);
  } else {
    debug(2, `[case] solve trigger for ${permId} did nothing (gone, already solved, or requirement no longer met)`);
  }
  ctx.bumpSeq?.();
  return true;
}

/** Legacy immediate solve (no stack). Kept for callers/tests; turn flow uses getCaseSolveEndStepTriggers. */
export function processCaseSolveAtEndStep(ctx: any): void {
  const state = ctx?.state;
  const turnPlayer = String(state?.turnPlayer || '').trim();
  if (!turnPlayer) return;
  let changed = false;
  for (const perm of Array.isArray(state.battlefield) ? state.battlefield : []) {
    if (!perm || perm.solved === true || String(perm.controller || '') !== turnPlayer) continue;
    if (!/\bcase\b/.test(typeLineOf(perm))) continue;
    const text = caseSolveText(String(perm.card?.oracle_text || ''));
    if (!text || evaluateCaseSolveCondition(text, turnPlayer, state) !== true) continue;
    perm.solved = true;
    changed = true;
    debug(2, `[case] ${perm.card?.name || perm.id} is solved`);
  }
  if (changed) ctx.bumpSeq?.();
}
