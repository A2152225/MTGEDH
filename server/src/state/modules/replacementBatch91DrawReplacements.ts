// server/src/state/modules/replacementBatch91DrawReplacements.ts
// B91: Tomorrow, Azami's Familiar (draw becomes look at top N, one to hand,
// rest to bottom) and Reed Richards (first extra draw each turn becomes four).
// Public: parseBatch91DrawSentence, collectBatch91DrawReplacementSpecs,
// collectBatch91DrawReplacementSpecsFromState, applyTomorrowLookPutDraw,
// consumeReedRichardsFirstTimeThisTurn.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD_COUNTS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const TOMORROW_RE =
  /if you would draw a card, look at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards of your library instead(?:\. put one of those cards into your hand and the rest on the bottom of your library in any order)?/gi;
const REED_RE =
  /the first time you would draw a card each turn except the first card you draw during each of your draw steps, you draw (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards instead/gi;

function parseCount(raw: string): number | undefined {
  const t = String(raw || '').trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return WORD_COUNTS[t];
}

export function parseBatch91DrawSentence(sentence: string): Array<{ kind: 'tomorrow'; look: number } | { kind: 'reed'; cards: number }> {
  const s = normalizeOraclePatternText(String(sentence || '')).toLowerCase().replace(/\u2019/g, "'").replace(/\.$/, '');
  const out: Array<{ kind: 'tomorrow'; look: number } | { kind: 'reed'; cards: number }> = [];
  TOMORROW_RE.lastIndex = 0;
  for (const t of s.matchAll(TOMORROW_RE)) {
    const look = parseCount(t[1]);
    if (look && look > 0) out.push({ kind: 'tomorrow', look });
  }
  REED_RE.lastIndex = 0;
  for (const r of s.matchAll(REED_RE)) {
    const cards = parseCount(r[1]);
    if (cards && cards > 0) out.push({ kind: 'reed', cards });
  }
  return out;
}

export function collectBatch91DrawReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  for (const raw of text.split(/\n+/)) {
    const s = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    for (const parsed of parseBatch91DrawSentence(s)) {
      if (parsed.kind === 'tomorrow') {
        specs.push({
          id: `${source.sourcePermanentId}:draw-look-top-${parsed.look}`,
          event: 'card-draw',
          sourcePermanentId: source.sourcePermanentId,
          sourceController: source.sourceController,
          sourceName: source.sourceName,
          match: { drawingPlayerIsSourceController: true, exactDrawCount: 1 },
          instead: { choiceRequired: true },
          effectId: 'controller-draw-look-top-put-one-in-hand',
          reason: 'controller_draw_look_top_put_one_in_hand',
          metadata: { lookAtLibraryTop: parsed.look, putOneInHandRestBottom: true },
        } as ReplacementEffectSpec);
      } else {
        specs.push({
          id: `${source.sourcePermanentId}:first-extra-draw-becomes-${parsed.cards}`,
          event: 'card-draw',
          sourcePermanentId: source.sourcePermanentId,
          sourceController: source.sourceController,
          sourceName: source.sourceName,
          match: {
            drawingPlayerIsSourceController: true,
            skipWhenEventMetadataTrue: 'isFirstDrawStepDraw',
          },
          instead: { modify: 'add_flat', value: Math.max(0, parsed.cards - 1) },
          effectId: 'first-extra-draw-this-turn-becomes-n',
          reason: 'first_extra_draw_this_turn_becomes_n',
          metadata: {
            firstTimeThisTurnKey: 'reedRichardsFirstExtraDrawUsedThisTurn',
            replaceDrawCountWith: parsed.cards,
          },
        } as ReplacementEffectSpec);
      }
    }
  }
  return specs;
}

export function collectBatch91DrawReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string; oracleText?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch91DrawReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function consumeReedRichardsFirstTimeThisTurn(state: any, sourcePermanentId: string, playerId: string): boolean {
  const key = 'reedRichardsFirstExtraDrawUsedThisTurn';
  state[key] = state[key] || {};
  const pid = String(playerId || '');
  const sid = String(sourcePermanentId || '');
  const used = state[key][`${sid}:${pid}`] === true;
  if (used) return false;
  state[key][`${sid}:${pid}`] = true;
  return true;
}

export function wasReedRichardsUsedThisTurn(state: any, sourcePermanentId: string, playerId: string): boolean {
  const map = (state as any)?.reedRichardsFirstExtraDrawUsedThisTurn || {};
  return map[`${String(sourcePermanentId || '')}:${String(playerId || '')}`] === true;
}

/**
 * Resolve Tomorrow's replacement once the player has chosen which of the looked
 * cards goes to hand. Remaining cards are put on the bottom in `bottomOrder`
 * (or original leftover order).
 */
export function applyTomorrowLookPutDraw(
  state: any,
  playerId: string,
  lookCount: number,
  chosenCardId?: string,
  bottomOrder?: string[],
): { handCard?: any; bottomed: any[] } {
  const pid = String(playerId || '');
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const library: any[] = Array.isArray(state.zones[pid].library) ? state.zones[pid].library : [];
  const n = Math.min(Math.max(0, Math.floor(Number(lookCount) || 0)), library.length);
  const looked = library.splice(0, n);
  const idOf = (c: any) => String(c?.id || c?.card?.id || c?.oracle_id || '');
  let chosenIdx = chosenCardId ? looked.findIndex((c) => idOf(c) === String(chosenCardId)) : 0;
  if (chosenIdx < 0) chosenIdx = 0;
  const handCard = looked.splice(chosenIdx, 1)[0];
  if (Array.isArray(bottomOrder) && bottomOrder.length) {
    looked.sort((a, b) => {
      const ia = bottomOrder.indexOf(idOf(a));
      const ib = bottomOrder.indexOf(idOf(b));
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }
  const hand: any[] = Array.isArray(state.zones[pid].hand) ? state.zones[pid].hand : [];
  if (handCard) hand.push(handCard);
  state.zones[pid].hand = hand;
  state.zones[pid].library = library.concat(looked);
  return { handCard, bottomed: looked };
}

/** Mark Reed used after a non-draw-step summarize actually considered the first extra draw. */
export function consumeReedRichardsAfterSummarize(state: any, playerId: string, metadata?: Record<string, unknown>): void {
  if (!state || metadata?.isFirstDrawStepDraw === true) return;
  const pid = String(playerId || '');
  for (const spec of collectBatch91DrawReplacementSpecsFromState(state)) {
    if (String(spec.sourceController || '') !== pid) continue;
    if ((spec.metadata as any)?.firstTimeThisTurnKey !== 'reedRichardsFirstExtraDrawUsedThisTurn') continue;
    consumeReedRichardsFirstTimeThisTurn(state, String(spec.sourcePermanentId || ''), pid);
  }
}
