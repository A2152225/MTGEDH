// server/src/state/modules/replacementBatch93ScryReplacements.ts
// B93: "If you would scry a number of cards, draw that many cards instead."
// Public: parseBatch93ScryToDrawSentence, collectBatch93ScryReplacementSpecs,
// collectBatch93ScryReplacementSpecsFromState, shouldReplaceScryWithDraw,
// applyScryReplacedByDraw.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const SCRY_TO_DRAW_RE = /if you would scry a number of cards, draw that many cards instead/i;

export function parseBatch93ScryToDrawSentence(oracle: string): boolean {
  return SCRY_TO_DRAW_RE.test(normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'"));
}

export function collectBatch93ScryReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  if (!parseBatch93ScryToDrawSentence(oracle)) return [];
  return [{
    id: `${source.sourcePermanentId}:scry-becomes-draw`,
    event: 'scry' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { scryingPlayerIsSourceController: true },
    instead: {},
    effectId: 'scry-becomes-draw',
    reason: 'scry_becomes_draw',
    metadata: { replaceScryWithDraw: true },
  } as ReplacementEffectSpec];
}

export function collectBatch93ScryReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch93ScryReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function shouldReplaceScryWithDraw(state: any, playerId: string): boolean {
  const pid = String(playerId || '');
  return collectBatch93ScryReplacementSpecsFromState(state).some((s) =>
    s.effectId === 'scry-becomes-draw' && String(s.sourceController) === pid,
  );
}

/** Move `count` cards from library to hand (a scry replaced by a draw). */
export function applyScryReplacedByDraw(state: any, playerId: string, count: number): any[] {
  const pid = String(playerId || '');
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!pid || !state || n <= 0) return [];
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const library: any[] = Array.isArray(state.zones[pid].library) ? state.zones[pid].library : [];
  const hand: any[] = Array.isArray(state.zones[pid].hand) ? state.zones[pid].hand : [];
  const drawn = library.splice(0, n);
  hand.push(...drawn);
  state.zones[pid].library = library;
  state.zones[pid].hand = hand;
  return drawn;
}
