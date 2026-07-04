import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { retiredLegacyHandlerHit, type RetiredTriggerLegacyHandlerHit } from './oracleIrTriggerLegacyHandlerTelemetry.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';

export interface TriggerLegacyLateEffectBatchParams {
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

export function applyRetiredTriggerLegacyLateEffectRegexBatch(
  params: TriggerLegacyLateEffectBatchParams,
): RetiredTriggerLegacyHandlerHit {
  const { sourceName, desc } = params;

  if (skipRetiredTriggerLegacyHandler(desc, sourceName)) {
    return false;
  }

  return false;
}
