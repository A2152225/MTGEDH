import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import {
  applyRetiredTriggerLegacyInterveningSubjectCopyToken,
  applyRetiredTriggerLegacyTappedAttackingCopyToken,
} from './oracleIrTriggerLegacyTokenHandlers.js';
import {
  applyRetiredTriggerLegacyLoseGameReplacement,
} from './oracleIrTriggerLegacyLifeAndGameHandlers.js';
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
  const {
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    triggerCard,
    state,
    opponents,
    players,
    battlefield,
  } = params;

  if (skipRetiredTriggerLegacyHandler(desc, sourceName)) {
    return false;
  }

  if (applyRetiredTriggerLegacyInterveningSubjectCopyToken({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyInterveningSubjectCopyToken');
  }

  if (applyRetiredTriggerLegacyTappedAttackingCopyToken({
    ctx,
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyTappedAttackingCopyToken');
  }

  if (applyRetiredTriggerLegacyLoseGameReplacement({
    controller,
    sourceName,
    desc,
    triggerItem,
    state,
  })) {
    return retiredLegacyHandlerHit('applyRetiredTriggerLegacyLoseGameReplacement');
  }

  return false;
}
