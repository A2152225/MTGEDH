import type { AbilityType } from './oracleTextParser';
import type { OracleEffectStep } from './oracleIR-handlers/oracleIREffectStep.js';

export type {
  OracleQuantity,
  OraclePlayerSelector,
  OracleObjectSelector,
  OracleScaler,
  OracleClauseCondition,
  OracleGraveyardAdditionalCost,
  OracleBattlefieldObjectCondition,
  OracleZone,
} from './oracleIR-handlers/oracleIRSharedTypes.js';
export type { OracleEffectStep };

export interface OracleIRAbility {
  readonly type: AbilityType;
  readonly text: string;
  /** True when the ability text includes "Any player may activate this ability." */
  readonly anyPlayerMayActivate?: boolean;
  readonly cost?: string;
  /** Station / Spacecraft charge-counter gate (N in `N+ | {cost}: effect`). */
  readonly stationChargeThreshold?: number;
  readonly triggerCondition?: string;
  readonly interveningIf?: string;
  readonly effectText: string;
  readonly steps: readonly OracleEffectStep[];
}

export interface OracleIRResult {
  readonly normalizedOracleText: string;
  readonly abilities: readonly OracleIRAbility[];
  readonly keywords: readonly string[];
}
