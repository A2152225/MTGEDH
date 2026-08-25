// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerApplyDeps.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Runtime seam so applyOracleIRStepsOnServer can live in a leaf while
// queueSacrificeChoicePromptsFromOracleIRResult stays next to
// resumeOracleIRRemainingStepsFromResolution (sacrifice calls resume).
// Parent binds the implementation at module load.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';

export type QueueSacrificeChoicePromptsFromOracleIRResult = (
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    targetPlayerId?: PlayerID;
    triggerItem?: any;
  },
) => void;

let boundQueueSacrificeChoicePromptsFromOracleIRResult: QueueSacrificeChoicePromptsFromOracleIRResult | null = null;

export function bindQueueSacrificeChoicePromptsFromOracleIRResult(
  fn: QueueSacrificeChoicePromptsFromOracleIRResult,
): void {
  boundQueueSacrificeChoicePromptsFromOracleIRResult = fn;
}

export function queueSacrificeChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    targetPlayerId?: PlayerID;
    triggerItem?: any;
  },
): void {
  boundQueueSacrificeChoicePromptsFromOracleIRResult?.(ctx, state, result, params);
}
