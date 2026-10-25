// Origin parent: replacementEffectSpec.ts (collectReplacementEffectSpecsFromState)
// Damage replacements that do more than change an amount (CR 614.9 / 615):
//  - redirection: "All damage that would be dealt to you [and other permanents you control]
//    [by artifacts|by unblocked creatures] is dealt to ~|enchanted creature|equipped creature instead"
//    (Pariah, Palisade Giant, Martyrs of Korlis, Veteran Bodyguard) and Treacherous Link
//    ("All damage that would be dealt to enchanted creature is dealt to its controller instead").
//  - prevention with a +1/+1 counter cost (Phantom Centaur / Protean Hydra / Magma Pummeler).
// Public entry symbols: collectDamageSideEffectSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';
import { selfReferenceSentences } from './replacementEffectSpecDamagePreventionOracleTemplates.js';

const REDIRECT_TO_CONTROLLER = /^all damage that would be dealt to enchanted creature is dealt to its controller instead$/;
const REDIRECT_TO_PERMANENT =
  /^(as long as ~ is untapped, )?all damage that would be dealt to you( and other permanents you control)?( by artifacts| by unblocked creatures)? is dealt to (~|enchanted creature|equipped creature) instead$/;
const PREVENT_THEN_REMOVE_ONE = /^if damage would be dealt to ~, prevent that damage$/;
const REMOVE_ONE_FOLLOW_UP = /^remove an? \+1\/\+1 counter from ~$/;
const PREVENT_AND_REMOVE =
  /^if damage would be dealt to ~( while it has a \+1\/\+1 counter on it)?, prevent that damage and remove (an?|that many) \+1\/\+1 counters? from (?:it|~)$/;

// Batch 16: Phytohydra / Lichenthrope.
const DAMAGE_BECOMES_COUNTERS = /^if damage would be dealt to ~, put that many ([+-]1\/[+-]1) counters on (?:it|~) instead$/;

export function collectDamageSideEffectSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield as any[]) {
    if (!perm || typeof perm !== 'object' || !perm.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    const oracle = readCardOracleText(perm.card);
    if (!sourcePermanentId || !oracle || !/would be dealt/i.test(oracle)) continue;
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    const base = { sourcePermanentId, sourceController: String(perm.controller || '').trim(), sourceName };
    const sentences = selfReferenceSentences(oracle, sourceName);
    sentences.forEach((s, i) => {
      if (REDIRECT_TO_CONTROLLER.test(s)) {
        specs.push({
          ...base, id: `${sourcePermanentId}:damage-redirect-attached-controller`, event: 'damage-redirect', instead: {},
          effectId: 'damage-redirect', reason: 'damage_redirect', metadata: { redirectTo: 'attached-controller' },
        });
        return;
      }
      const r = s.match(REDIRECT_TO_PERMANENT);
      if (r) {
        specs.push({
          ...base, id: `${sourcePermanentId}:damage-redirect-${i}`, event: 'damage-redirect', instead: {},
          effectId: 'damage-redirect', reason: 'damage_redirect',
          metadata: {
            redirectTo: r[4] === '~' ? 'self' : 'attached',
            includeOtherPermanents: !!r[2],
            requiresUntapped: !!r[1],
            ...(r[3] ? { sourceFilter: r[3].includes('artifact') ? 'artifact' : 'unblocked-creature' } : {}),
          },
        });
        return;
      }
      if (PREVENT_THEN_REMOVE_ONE.test(s) && REMOVE_ONE_FOLLOW_UP.test(String(sentences[i + 1] || ''))) {
        specs.push({
          ...base, id: `${sourcePermanentId}:damage-prevent-remove-counter`, event: 'damage-prevention-cost', instead: {},
          effectId: 'damage-prevent-remove-counter', reason: 'damage_prevent_remove_counter',
          metadata: { counter: '+1/+1', removeMode: 'one', requiresCounter: false },
        });
        return;
      }
      const dc = s.match(DAMAGE_BECOMES_COUNTERS);
      if (dc) {
        specs.push({
          ...base, id: `${sourcePermanentId}:damage-becomes-counters`, event: 'damage-prevention-cost', instead: {},
          effectId: 'damage-becomes-counters', reason: 'damage_becomes_counters',
          metadata: { counter: dc[1], addCountersInstead: true },
        });
        return;
      }
      const p = s.match(PREVENT_AND_REMOVE);
      if (p) {
        specs.push({
          ...base, id: `${sourcePermanentId}:damage-prevent-remove-counter`, event: 'damage-prevention-cost', instead: {},
          effectId: 'damage-prevent-remove-counter', reason: 'damage_prevent_remove_counter',
          metadata: { counter: '+1/+1', removeMode: p[2] === 'that many' ? 'amount' : 'one', requiresCounter: !!p[1] },
        });
      }
    });
  }
  return specs;
}
