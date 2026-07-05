import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { type RetiredTriggerLegacyHandlerHit } from './oracleIrTriggerLegacyHandlerTelemetry.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacySingleEffectBatchParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly triggerCard: any;
  readonly state: any;
  readonly opponents: readonly any[];
  readonly players: readonly any[];
  readonly battlefield: readonly any[];
}

export function applyRetiredTriggerLegacySingleEffectRegexBatch(
  params: TriggerLegacySingleEffectBatchParams,
): RetiredTriggerLegacyHandlerHit {
  const { desc, sourceName } = params;

  if (skipRetiredTriggerLegacyHandler(desc, sourceName)) {
    return false;
  }

  return false;
}
