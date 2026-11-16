// server/src/state/modules/replacementBatch92AssembleReplacements.ts
// B92: "If a [type] you control would assemble a Contraption, it assembles N
// Contraptions instead." Parser and collector only — the engine has no assemble
// apply path yet, so this lands for census and a future hook.
// Public: parseBatch92AssembleSentence, collectBatch92AssembleReplacementSpecs,
// collectBatch92AssembleReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { two: 2, three: 3, four: 4, twice: 2 };

const ASSEMBLE_RE =
  /if an? ([a-z]+) you control would assemble an? ([a-z]+), it assembles (two|three|four|twice|\d+) \2s? instead/i;

export function parseBatch92AssembleSentence(oracle: string): Array<{ assemblerType: string; assembledType: string; times: number }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ assemblerType: string; assembledType: string; times: number }> = [];
  for (const m of text.matchAll(new RegExp(ASSEMBLE_RE, 'gi'))) {
    const raw = String(m[3] || '').trim().toLowerCase();
    const times = WORD[raw] ?? parseInt(raw, 10);
    if (!Number.isFinite(times) || times < 2) continue;
    out.push({
      assemblerType: String(m[1] || '').trim(),
      assembledType: String(m[2] || '').trim(),
      times: Math.floor(times),
    });
  }
  return out;
}

export function collectBatch92AssembleReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch92AssembleSentence(oracle).map((entry, i) => ({
    id: `${source.sourcePermanentId}:assemble-${entry.assembledType}-times-${entry.times}${i ? `-${i}` : ''}`,
    event: 'keyword-action-repetition' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: { keywordAction: 'assemble', assemblerTypeIs: entry.assemblerType, controllerIsSourceController: true },
    instead: { setTimes: entry.times },
    effectId: 'assemble-contraption-times-n',
    reason: 'assemble_contraption_times_n',
    metadata: { assemblerType: entry.assemblerType, assembledType: entry.assembledType, times: entry.times },
  } as unknown as ReplacementEffectSpec));
}

export function collectBatch92AssembleReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch92AssembleReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
