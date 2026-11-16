// Batch 111 replacement specs. Damage lines are markers: the amount change
// is applied in collectBatch111DamageAdjustments so it is not applied twice.
// The optional skip-draw line is a real choice-bearing draw replacement.
// Public: collectBatch111ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  normalizeBatch111Oracle,
  parseColorSpellDamageDouble,
  parseDamageBecomesIfAtLeast,
  parseNoncombatDamageToOpponentPlus,
  parseOptionalSkipDraw,
} from './batch111Parsers.js';

function asSpec(spec: object): ReplacementEffectSpec {
  return spec as unknown as ReplacementEffectSpec;
}

export function collectBatch111ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  const specs: ReplacementEffectSpec[] = [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    const text = normalizeBatch111Oracle(readCardOracleText(rec.card), String(rec.card.name || ''));
    const base = {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card.name || 'Unknown'),
    };
    if (parseColorSpellDamageDouble(text) || parseNoncombatDamageToOpponentPlus(text) > 0 || parseDamageBecomesIfAtLeast(text)) {
      specs.push(asSpec({
        ...base,
        id: `${sourcePermanentId}:batch111-damage`,
        event: 'damage',
        match: {},
        instead: {},
        effectId: 'batch111-damage-adjustment',
        reason: 'batch111_damage_adjustment',
      }));
    }
    if (parseOptionalSkipDraw(text)) {
      specs.push(asSpec({
        ...base,
        id: `${sourcePermanentId}:optional-skip-draw`,
        event: 'card-draw',
        match: { drawingPlayerIsSourceController: true, exactDrawCount: 1 },
        instead: { choiceRequired: true },
        effectId: 'skip-draw-step-replacement',
        reason: 'optional_skip_draw',
        metadata: { optionalSkipAnyDraw: true },
      }));
    }
  }
  return specs;
}
