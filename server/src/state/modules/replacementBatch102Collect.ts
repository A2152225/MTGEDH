// server/src/state/modules/replacementBatch102Collect.ts
// B102 replacement collect: Void Maw ("If another creature would die, exile it instead").
// Wired through collectReplacementEffectSpecsFromState and movePermanentToGraveyard.
// Public: collectBatch102ReplacementSpecs, collectBatch102ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { parseAnotherCreatureWouldDieExile, parseOpponentsCreaturesCantGetP1P1 } from './batch102Parsers.js';

export function collectBatch102ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const asSpec = (spec: object) => (spec as unknown) as ReplacementEffectSpec;
  if (parseAnotherCreatureWouldDieExile(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:another-creature-die-exile`,
      event: 'zone-change',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectTypeLineIncludes: 'creature', objectIsNotSource: true },
      instead: { redirectZone: 'exile' },
      effectId: 'another-creature-die-exile-instead',
      reason: 'another_creature_die_exile_instead',
    }));
  }
  if (parseOpponentsCreaturesCantGetP1P1(text)) {
    specs.push(asSpec({
      id: `${source.sourcePermanentId}:opponents-cant-get-p1p1`,
      event: 'counter-placement',
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { counterKind: '+1/+1', permanentControllerIsOpponent: true, objectTypeLineIncludes: 'creature' },
      instead: { skipEvent: true },
      effectId: 'opponents-creatures-cant-get-p1p1',
      reason: 'opponents_creatures_cant_get_p1p1',
    }));
  }
  return specs;
}

export function collectBatch102ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
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
    specs.push(...collectBatch102ReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}
