// server/src/state/modules/replacementBatch95Collect.ts
// B95 collect barrel: typed land-would-enter, counters, damage, Library of Leng.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { collectBatch95LandWouldEnterReplacementSpecsFromState } from './batch95LandWouldEnter.js';
import { collectBatch95CounterReplacementSpecsFromState } from './replacementBatch95CounterReplacements.js';
import { collectBatch95DamageReplacementSpecsFromState } from './replacementBatch95DamageReplacements.js';
import { collectBatch95DiscardReplacementSpecsFromState } from './batch95DiscardAndNotes.js';

export function collectBatch95ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return [
    ...collectBatch95LandWouldEnterReplacementSpecsFromState(state),
    ...collectBatch95CounterReplacementSpecsFromState(state),
    ...collectBatch95DamageReplacementSpecsFromState(state),
    ...collectBatch95DiscardReplacementSpecsFromState(state),
  ];
}
