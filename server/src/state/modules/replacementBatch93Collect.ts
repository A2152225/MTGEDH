// server/src/state/modules/replacementBatch93Collect.ts
// Barrel so replacementEffectSpec.ts can take a single B93 import.
// Public: collectBatch93ReplacementSpecsFromState.

import { collectBatch93DrawReplacementSpecsFromState } from './replacementBatch93DrawReplacements.js';
import { collectBatch93ScryReplacementSpecsFromState } from './replacementBatch93ScryReplacements.js';
import { collectBatch93DamageReplacementSpecsFromState } from './replacementBatch93DamageReplacements.js';
import { collectBatch93DiesReplacementSpecsFromState } from './replacementBatch93DiesReplacements.js';
import { collectBatch93TokenReplacementSpecsFromState } from './replacementBatch93TokenReplacements.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

export function collectBatch93ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return [
    ...collectBatch93DrawReplacementSpecsFromState(state),
    ...collectBatch93ScryReplacementSpecsFromState(state),
    ...collectBatch93DamageReplacementSpecsFromState(state),
    ...collectBatch93DiesReplacementSpecsFromState(state),
    ...collectBatch93TokenReplacementSpecsFromState(state),
  ];
}
