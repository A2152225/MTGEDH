// server/src/state/modules/replacementBatch93DiesReplacements.ts
// B93: "If a nontoken creature an opponent controls would die, instead exile
// it and you gain N life." Public: parseBatch93DiesSentence,
// collectBatch93DiesReplacementSpecs, collectBatch93DiesReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

const DIE_EXILE_GAIN_RE =
  /if an? (nontoken )?creature an opponent controls would die, instead exile it and you gain (one|two|three|four|five|\d+) life/i;

export function parseBatch93DiesSentence(oracle: string): Array<{ nontokenOnly: boolean; life: number }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ nontokenOnly: boolean; life: number }> = [];
  const m = text.match(DIE_EXILE_GAIN_RE);
  if (m) {
    const raw = String(m[2] || '2').toLowerCase();
    const life = WORD[raw] ?? parseInt(raw, 10);
    if (life > 0) out.push({ nontokenOnly: Boolean(m[1]), life });
  }
  return out;
}

export function collectBatch93DiesReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return parseBatch93DiesSentence(oracle).map((entry, i) => ({
    id: `${source.sourcePermanentId}:opponent-creature-die-exile-gain-life${i ? `-${i}` : ''}`,
    event: 'zone-change' as const,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
    match: {
      sourceZone: 'battlefield',
      destinationZone: 'graveyard',
      objectTypeLineIncludes: 'creature',
      objectControllerIsOpponentOfSource: true,
    },
    instead: { redirectZone: 'exile' },
    effectId: 'opponent-creature-die-exile-gain-life',
    reason: 'opponent_creature_die_exile_gain_life',
    metadata: { nontokenOnly: entry.nontokenOnly, gainLife: entry.life, sourcePermanentId: source.sourcePermanentId, sourceController: source.sourceController },
  } as ReplacementEffectSpec));
}

export function collectBatch93DiesReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch93DiesReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId, sourceController, sourceName: String((rec.card as any)?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
