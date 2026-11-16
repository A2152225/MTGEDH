// server/src/state/modules/replacementBatch96Collect.ts
// B96 collector entry points for zone, life-pay, damage, and explore replacements.
// Public: collectBatch96ReplacementSpecs, collectBatch96ReplacementSpecsFromState,
// applyBatch96DamageSideEffects (re-export).

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { collectBatch96ZoneReplacementSpecs, collectBatch96ZoneReplacementSpecsFromState } from './replacementBatch96ZoneReplacements.js';
import { collectBatch96LifePayExileSpecs, collectBatch96LifePayExileSpecsFromState } from './batch96LifePayExile.js';
import { collectBatch96DamageReplacementSpecs, collectBatch96DamageReplacementSpecsFromState, applyBatch96DamageSideEffects } from './replacementBatch96DamageReplacements.js';
import { collectBatch96ExploreReplacementSpecs, collectBatch96ExploreReplacementSpecsFromState } from './replacementBatch96ExploreAndMana.js';

export { applyBatch96DamageSideEffects };

export function collectBatch96ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  return [
    ...collectBatch96ZoneReplacementSpecs(oracle, source),
    ...collectBatch96LifePayExileSpecs(oracle, source),
    ...collectBatch96DamageReplacementSpecs(oracle, source),
    ...collectBatch96ExploreReplacementSpecs(oracle, source),
  ];
}

export function collectBatch96ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return [
    ...collectBatch96ZoneReplacementSpecsFromState(state),
    ...collectBatch96LifePayExileSpecsFromState(state),
    ...collectBatch96DamageReplacementSpecsFromState(state),
    ...collectBatch96ExploreReplacementSpecsFromState(state),
  ];
}
