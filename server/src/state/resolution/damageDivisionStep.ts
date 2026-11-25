/**
 * server/src/state/resolution/damageDivisionStep.ts
 *
 * Resolution-queue step for CR 601.2d divided-as-you-choose damage. Kept in its own
 * module so resolution/types.ts stays under the 40KB cap.
 */

import type { ChoiceOption } from '../../../../rules-engine/src/choiceEvents.js';
import type { BaseResolutionStep } from './types.js';
import { ResolutionStepType } from './types.js';

/**
 * Damage division resolution step.
 * Used after targets are chosen for a "divided as you choose" spell or ability.
 */
export interface DamageDivisionStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.DAMAGE_DIVISION;
  readonly totalAmount: number;
  readonly minPerTarget?: number;
  readonly validTargets: readonly ChoiceOption[];
  readonly message?: string;
  readonly title?: string;
  readonly effectId?: string;
  readonly spellCastContext?: any;
}
