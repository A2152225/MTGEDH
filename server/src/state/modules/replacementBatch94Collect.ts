// server/src/state/modules/replacementBatch94Collect.ts
// Barrel so replacementEffectSpec.ts can take a single B94 import.
// Public: collectBatch94ReplacementSpecsFromState.

import { collectBatch94ZoneChangeReplacementSpecsFromState } from './batch94ZoneChangeApply.js';
import { collectBatch94DamageReplacementSpecsFromState } from './replacementBatch94DamageReplacements.js';
import { collectBatch94EnergyReplacementSpecsFromState } from './replacementBatch94EnergyReplacements.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

export function collectBatch94ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return [
    ...collectBatch94ZoneChangeReplacementSpecsFromState(state),
    ...collectBatch94DamageReplacementSpecsFromState(state),
    ...collectBatch94EnergyReplacementSpecsFromState(state),
  ];
}
