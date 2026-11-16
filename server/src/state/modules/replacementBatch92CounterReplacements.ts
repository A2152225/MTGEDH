// server/src/state/modules/replacementBatch92CounterReplacements.ts
// B92: "If a [modular] triggered ability would put one or more +1/+1 counters
// on a creature you control, that many plus N +1/+1 counters are put on it instead."
// Public: parseBatch92CounterSentence, collectBatch92CounterReplacementSpecs,
// collectBatch92CounterReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const PLUS_RE =
  /if a(?:n? (modular) )?triggered ability would put one or more \+1\/\+1 counters on a creature you control, that many plus (one|two|three|four|five|\d+) \+1\/\+1 counters are put on it instead/i;

export function parseBatch92CounterSentence(oracle: string): Array<{ plus: number; modularOnly: boolean }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ plus: number; modularOnly: boolean }> = [];
  PLUS_RE.lastIndex = 0;
  for (const m of text.matchAll(new RegExp(PLUS_RE, 'gi'))) {
    const raw = String(m[2] || '').trim().toLowerCase();
    const plus = WORD[raw] ?? parseInt(raw, 10);
    if (Number.isFinite(plus) && plus > 0) out.push({ plus: Math.floor(plus), modularOnly: Boolean(m[1]) });
  }
  return out;
}

export function collectBatch92CounterReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch92CounterSentence(oracle).map((entry, i) => ({
    id: `${source.sourcePermanentId}:triggered-p1p1-plus-${entry.plus}${i ? `-${i}` : ''}`,
    event: 'counter-placement' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: {
      counterTypeIncludes: '+1/+1',
      targetControllerIsSourceController: true,
    },
    instead: { modify: 'add_flat' as const, value: entry.plus },
    effectId: entry.modularOnly ? 'modular-triggered-p1p1-plus-n' : 'triggered-p1p1-plus-n',
    reason: entry.modularOnly ? 'modular_triggered_p1p1_plus_n' : 'triggered_p1p1_plus_n',
    metadata: { plus: entry.plus, modularOnly: entry.modularOnly, causeIsTriggeredAbility: true },
  } as ReplacementEffectSpec));
}

export function collectBatch92CounterReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch92CounterReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
