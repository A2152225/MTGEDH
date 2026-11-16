// server/src/state/modules/replacementBatch105Collect.ts
// B105 replacement collect. Only families with a live apply hook.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { parseWouldConniveInsteadYouDrawThenConnives } from './batch105Parsers.js';

export function collectBatch105ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const asSpec = (spec: object) => (spec as unknown) as ReplacementEffectSpec;
  if (parseWouldConniveInsteadYouDrawThenConnives(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:would-connive-instead-you-draw-then-connives`,
      event: 'connive' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { creatureControllerIsSourceController: true } as any,
      instead: { extraDrawThenConnive: true } as any,
      effectId: 'would-connive-instead-you-draw-then-connives',
      reason: 'would_connive_instead_you_draw_then_connives',
    }));
  }
  return specs;
}

export function collectBatch105ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; card?: unknown; phasedOut?: boolean };
    if (rec.phasedOut === true) continue;
    const oracle = readCardOracleText(rec.card) || readCardOracleText(perm);
    if (!oracle) continue;
    specs.push(...collectBatch105ReplacementSpecs(oracle, {
      sourcePermanentId: String(rec.id || ''),
      sourceController: String(rec.controller || ''),
      sourceName: String((rec.card as { name?: string } | undefined)?.name || ''),
    }));
  }
  return specs;
}
