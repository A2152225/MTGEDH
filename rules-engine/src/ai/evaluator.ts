/**
 * Weighted seat values from evaluator features.
 *
 * Origin: AI_Upgrade Phase 1 (P1-1).
 * Public entry symbols: DEFAULT_WEIGHTS, getEvalWeights, seatValues, EvalWeights.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import {
  FEATURE_NAMES,
  type EvalWeights,
  type SeatFeatures,
} from './evaluatorFeatures.js';
import { FITTED_WEIGHTS } from './evaluatorWeights.v1.js';

export type { EvalWeights };

/** Hand-set starting guess; signs matter more than magnitudes. Replaced by P1-3 fit. */
export const DEFAULT_WEIGHTS: EvalWeights = {
  life: 2.0,
  commanderDamageTaken: -3.0,
  boardValue: 2.5,
  otherPermanents: 0.8,
  manaSources: 1.2,
  handSize: 0.6,
  commanderInPlay: 0.3,
  loyalty: 0.4,
  attackPower: 0.8,
};

export function getEvalWeights(): EvalWeights {
  return FITTED_WEIGHTS ?? DEFAULT_WEIGHTS;
}

export function seatValues(
  features: Record<PlayerID, SeatFeatures>,
  weights: EvalWeights,
): Record<PlayerID, number> {
  const values: Record<PlayerID, number> = {};
  for (const id of Object.keys(features) as PlayerID[]) {
    let sum = 0;
    const f = features[id];
    for (const name of FEATURE_NAMES) {
      sum += weights[name] * f[name];
    }
    values[id] = sum;
  }
  return values;
}
