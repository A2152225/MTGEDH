// server/src/state/modules/turnFaceUpCounterPlacement.ts
// B49: counters placed as part of turning a permanent face up (not triggers, so no stack):
// - Megamorph (CR 702.37b): one +1/+1 counter.
// - "As ~ is turned face up, put five +1/+1 counters on it." (Hooded Hydra, Bubble Smuggler) and the
//   "As ~ enters or is turned face up, put N ... counters on it" template when N is a fixed number.
// B50: the additions are routed through the counter-placement replacement pipeline (Hardened Scales,
// Doubling Season, Corpsejack Menace ...) when the game state is available, mirroring
// counters_tokens.applyCounterModifications (imported from replacement-effects directly to avoid a cycle).
// Origin parents: the three morphTurnFaceUp appliers (applyEventExecuteEffectEvents, triggerDelayedEffectUtils,
// resolutionCascadeDanceDevourSuspendMorphResponseHandlers), which previously inlined only the megamorph counter.
// Public entry symbols: turnFaceUpCounterAdditions, applyTurnFaceUpCounters.
import { evaluateCounterPlacementReplacementEvent } from './replacement-effects.js';

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function selfRefLower(card: any): string {
  const text = String(card?.oracle_text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const name = String(card?.name || '').split('//')[0].trim().toLowerCase();
  let t = name ? text.split(name).join('~') : text;
  const short = name.split(',')[0].trim();
  if (short && short !== name) t = t.split(short).join('~');
  return t.replace(/\bthis (?:creature|permanent|artifact|enchantment|land)\b/g, '~');
}

const AS_TURNED_UP_RE = /\bas ~ (?:enters or )?is turned face up, put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([+-]\d+\/[+-]\d+|[a-z]+) counters? on it\b/g;

/** Counter additions for turning actualCard face up, keyed by counter name. */
export function turnFaceUpCounterAdditions(actualCard: any): Record<string, number> {
  const out: Record<string, number> = {};
  const text = selfRefLower(actualCard);
  if (/\bmegamorph\b/.test(text)) out['+1/+1'] = (out['+1/+1'] || 0) + 1;
  for (const m of text.matchAll(AS_TURNED_UP_RE)) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]] || 0;
    if (n > 0) out[m[2]] = (out[m[2]] || 0) + n;
  }
  return out;
}

function modifiedFaceUpDeltas(gameState: any, permanent: any, adds: Record<string, number>): Record<string, number> {
  if (!gameState || !permanent?.id) return adds;
  const onBattlefield = (gameState.battlefield || []).some((p: any) => p?.id === permanent.id);
  if (!onBattlefield) return adds;
  try {
    const replacement = evaluateCounterPlacementReplacementEvent({
      state: gameState,
      targetPermanentId: permanent.id,
      controllerId: permanent.controller,
      deltas: adds,
    } as any);
    return ((replacement?.metadata as any)?.modifiedDeltas as Record<string, number> | undefined) || adds;
  } catch {
    return adds;
  }
}

/**
 * Mutates permanent.counters with the face-up counters (after counter-placement replacements when
 * gameState is given). Returns the counters actually applied.
 */
export function applyTurnFaceUpCounters(permanent: any, actualCard: any, gameState?: any): Record<string, number> {
  const base = turnFaceUpCounterAdditions(actualCard);
  if (!permanent || !Object.keys(base).length) return base;
  const adds = modifiedFaceUpDeltas(gameState, permanent, base);
  const counters = permanent.counters = permanent.counters || {};
  for (const k of Object.keys(adds)) {
    const n = Number(adds[k]) || 0;
    if (n > 0) counters[k] = (Number(counters[k]) || 0) + n;
  }
  return adds;
}
