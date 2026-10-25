// server/src/rules-engine/staticEffects.ts
// The legacy regex continuous-effect scan is retired: every oracle static is a StaticEffectSpec
// (state/modules/staticEffectSpec*.ts). This entry point stays as a thin alias so callers and
// tests that ask for "the continuous effects of this state" get the spec-derived result.
// Public entry symbols: computeContinuousEffects, ContinuousEffectResult.

import type { GameState } from '../../../shared/src';
import { recomputeContinuousEffects } from '../state/modules/staticEffectSpec.js';
import type { ContinuousEffectResult } from './staticEffects-handlers/staticEffectsScanHelpers.js';

export type { ContinuousEffectResult } from './staticEffects-handlers/staticEffectsScanHelpers.js';

export function computeContinuousEffects(state: GameState): ContinuousEffectResult {
  return recomputeContinuousEffects(state as any);
}
