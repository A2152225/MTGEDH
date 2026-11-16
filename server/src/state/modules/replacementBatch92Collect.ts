// server/src/state/modules/replacementBatch92Collect.ts
// Barrel so replacementEffectSpec.ts can take a single B92 import.
// Public: collectBatch92ReplacementSpecsFromState.

import { collectBatch92DrawReplacementSpecsFromState } from './replacementBatch92DrawReplacements.js';
import { collectBatch92DamageReplacementSpecsFromState } from './replacementBatch92DamageReplacements.js';
import { collectBatch92DiesReplacementSpecsFromState } from './replacementBatch92DiesReplacements.js';
import { collectBatch92CounterReplacementSpecsFromState } from './replacementBatch92CounterReplacements.js';
import { collectBatch92AssembleReplacementSpecsFromState } from './replacementBatch92AssembleReplacements.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

export function collectBatch92ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return [
    ...collectBatch92DrawReplacementSpecsFromState(state),
    ...collectBatch92DamageReplacementSpecsFromState(state),
    ...collectBatch92DiesReplacementSpecsFromState(state),
    ...collectBatch92CounterReplacementSpecsFromState(state),
    ...collectBatch92AssembleReplacementSpecsFromState(state),
  ];
}
