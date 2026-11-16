// server/src/state/modules/replacementBatch94EnergyReplacements.ts
// B94: "If you would get one or more {E} (energy counters), you get that
// many plus N {E} instead." Public: parseBatch94EnergySentence,
// collectBatch94EnergyReplacementSpecs, collectBatch94EnergyReplacementSpecsFromState,
// applyEnergyPlusNReplacement.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const ENERGY_RE = /if you would get (?:one or more )?\{e\}(?: \(energy counters\))?, you get that many plus (\d+|one|two|three) \{e\} instead/i;
const WORD: Record<string, number> = { one: 1, two: 2, three: 3 };

export function parseBatch94EnergySentence(oracle: string): { plus: number } | null {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const m = text.match(ENERGY_RE);
  if (!m) return null;
  const raw = String(m[1] || '1').toLowerCase();
  const plus = WORD[raw] ?? parseInt(raw, 10);
  return plus > 0 ? { plus } : null;
}

export function collectBatch94EnergyReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const parsed = parseBatch94EnergySentence(oracle);
  if (!parsed) return [];
  return [{
    id: `${source.sourcePermanentId}:energy-plus-n`,
    event: 'counter-placement' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { counterTypeIncludes: 'energy' },
    instead: { modify: 'add_flat' as const, value: parsed.plus },
    effectId: 'energy-plus-n',
    reason: 'energy_plus_n',
    metadata: { plus: parsed.plus },
  } as ReplacementEffectSpec];
}

export function collectBatch94EnergyReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch94EnergyReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

export function applyEnergyPlusNReplacement(state: any, playerId: string, amount: number): number {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  if (n <= 0) return n;
  const pid = String(playerId || '');
  const specs = collectBatch94EnergyReplacementSpecsFromState(state).filter((s) =>
    s.effectId === 'energy-plus-n' && String(s.sourceController) === pid,
  );
  let total = n;
  for (const spec of specs) total += Number((spec.metadata as any)?.plus || 0);
  return total;
}
