// server/src/state/modules/replacementBatch91ProliferateReplacements.ts
// B91: "If you would proliferate, proliferate twice/N times instead" (Tekuthal).
// Rules-correct: two (or N) separate proliferate actions / prompts, and
// replacement-created actions skip re-application (CR 614.5). Multiple copies
// use the highest listed multiplier rather than stacking 2x2=4, matching the
// pre-existing getProliferateActionCount boolean behavior.
// Public: parseBatch91ProliferateSentence, collectBatch91ProliferateReplacementSpecs,
// collectBatch91ProliferateReplacementSpecsFromState, getOracleProliferateActionCount,
// nameTableProliferateAlreadyCoveredByOracle.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD_COUNTS: Record<string, number> = {
  twice: 2,
  'two times': 2,
  'three times': 3,
  'four times': 4,
};

const PROLIFERATE_RE =
  /if you would proliferate,\s*proliferate (twice|two times|three times|four times|\d+ times) instead/gi;

export function parseBatch91ProliferateSentence(oracle: string): Array<{ times: number }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ times: number }> = [];
  PROLIFERATE_RE.lastIndex = 0;
  for (const m of text.matchAll(PROLIFERATE_RE)) {
    const raw = String(m[1] || '').trim().toLowerCase();
    const times = WORD_COUNTS[raw] ?? (raw.endsWith(' times') ? parseInt(raw, 10) : NaN);
    if (Number.isFinite(times) && times > 1) out.push({ times: Math.floor(times) });
  }
  return out;
}

export function nameTableProliferateAlreadyCoveredByOracle(oracle: string): boolean {
  return parseBatch91ProliferateSentence(oracle).length > 0;
}

export function collectBatch91ProliferateReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch91ProliferateSentence(oracle).map((entry, i) => ({
    id: `${source.sourcePermanentId}:proliferate-times-${entry.times}${i ? `-${i}` : ''}`,
    event: 'proliferate' as ReplacementEffectSpec['event'],
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { proliferatingPlayerIsSourceController: true },
    instead: { modify: 'add_flat', value: entry.times },
    effectId: `controller-proliferate-${entry.times}-times`,
    reason: 'controller_proliferate_times_instead',
    metadata: { proliferateTimes: entry.times },
  } as ReplacementEffectSpec));
}

export function collectBatch91ProliferateReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch91ProliferateReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

/** Highest listed proliferate-times replacement for this player (1 if none). */
export function getOracleProliferateActionCount(state: unknown, playerId: string): number {
  const pid = String(playerId || '').trim();
  if (!pid) return 1;
  let best = 1;
  for (const spec of collectBatch91ProliferateReplacementSpecsFromState(state)) {
    if (String(spec.sourceController || '') !== pid) continue;
    const times = Math.max(1, Math.floor(Number((spec.metadata as any)?.proliferateTimes || spec.instead?.value || 1)));
    if (times > best) best = times;
  }
  return best;
}
