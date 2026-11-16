// server/src/state/modules/replacementBatch91ScryReplacements.ts
// B91: "If you would scry a number of cards, scry that many cards plus N instead" (Kenessos).
// Public: parseBatch91ScryPlusSentence, collectBatch91ScryReplacementSpecs,
// collectBatch91ScryReplacementSpecsFromState, getOracleScryAmountBonus, adjustScryCount.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD_COUNTS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const SCRY_PLUS_RE =
  /if you would scry a number of cards,\s*scry that many cards plus (one|two|three|four|five|six|seven|eight|nine|ten|\d+) instead/gi;

export function parseBatch91ScryPlusSentence(oracle: string): Array<{ plus: number }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ plus: number }> = [];
  SCRY_PLUS_RE.lastIndex = 0;
  for (const m of text.matchAll(SCRY_PLUS_RE)) {
    const raw = String(m[1] || '').trim().toLowerCase();
    const plus = WORD_COUNTS[raw] ?? parseInt(raw, 10);
    if (Number.isFinite(plus) && plus > 0) out.push({ plus: Math.floor(plus) });
  }
  return out;
}

export function collectBatch91ScryReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch91ScryPlusSentence(oracle).map((entry, i) => ({
    id: `${source.sourcePermanentId}:scry-plus-${entry.plus}${i ? `-${i}` : ''}`,
    event: 'scry' as ReplacementEffectSpec['event'],
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { scryingPlayerIsSourceController: true },
    instead: { modify: 'add_flat', value: entry.plus },
    effectId: `controller-scry-plus-${entry.plus}`,
    reason: 'controller_scry_plus_n',
    metadata: { scryPlus: entry.plus },
  } as ReplacementEffectSpec));
}

export function collectBatch91ScryReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch91ScryReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function getOracleScryAmountBonus(state: unknown, playerId: string): number {
  const pid = String(playerId || '').trim();
  if (!pid) return 0;
  let bonus = 0;
  for (const spec of collectBatch91ScryReplacementSpecsFromState(state)) {
    if (String(spec.sourceController || '') !== pid) continue;
    bonus += Math.max(0, Math.floor(Number((spec.metadata as any)?.scryPlus || spec.instead?.value || 0)));
  }
  return bonus;
}

/** Apply Kenessos-style plus-N replacements to a would-scry count. */
export function adjustScryCount(state: unknown, playerId: string, count: number): number {
  const base = Math.max(0, Math.floor(Number(count) || 0));
  if (base <= 0) return base;
  return base + getOracleScryAmountBonus(state, playerId);
}
