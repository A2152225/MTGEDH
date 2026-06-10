import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { tryResolveThassasOracleWin } from './game-state-effects.js';
import { applyOracleIRFallbackForTriggeredEffect } from './stackExecuteTriggerEffectIrFallbackUtils.js';
import type { TriggerEffectLegacyBodyContinuation } from './stackResolveSharedTypes.js';
import { maybeApplyPreparedStateChange } from './triggerPreparedStateUtils.js';
import { getTriggerSourcePermanent } from './triggerSourceUtils.js';
import {
  shouldSkipLegacyTriggerRegexHandlers,
  shouldSkipTriggerUncategorizedFallback,
} from './oracleIrTriggerLegacyRouting.js';
import {
  applyRetiredTriggerLegacyCombinedEffectsRegexBatch,
  applyRetiredTriggerLegacyPutLandFromHand,
} from './oracleIrTriggerLegacyCombinedHandlers.js';
import {
  applyRetiredTriggerLegacyLateEffectRegexBatch,
} from './oracleIrTriggerLegacyLateEffectRegexBatch.js';
import {
  applyRetiredTriggerLegacySingleEffectRegexBatch,
} from './oracleIrTriggerLegacySingleEffectRegexBatch.js';

export function tryApplyTriggerEffectLegacyTailHandlers(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any,
  triggerCard: any,
  state: any,
  continuation: TriggerEffectLegacyBodyContinuation,
): boolean {
  const {
    desc,
    descriptionForOracleFallback,
    isKynaiosEffect,
    opponents,
    players,
    battlefield,
  } = continuation;

  const triggeredOracleIRApplied = isKynaiosEffect
    ? 0
    : shouldSkipTriggerUncategorizedFallback(descriptionForOracleFallback, sourceName)
      ? 0
      : applyOracleIRFallbackForTriggeredEffect(
        ctx,
        controller,
        sourceName,
        descriptionForOracleFallback,
        triggerItem,
      );
  if (triggeredOracleIRApplied > 0) {
    tryResolveThassasOracleWin(ctx, controller, sourceName);
    return true;
  }

  if (shouldSkipLegacyTriggerRegexHandlers(descriptionForOracleFallback, sourceName)) {
    debug(
      1,
      `[executeTriggerEffect] ${sourceName}: IR primary owns trigger effect but did not apply: ${String(descriptionForOracleFallback || '').trim()}`,
    );
    return true;
  }

  const combinedEffectsHandled = applyRetiredTriggerLegacyCombinedEffectsRegexBatch({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
    isKynaiosEffect,
    opponents,
    battlefield,
  });

  applyRetiredTriggerLegacyPutLandFromHand({
    ctx,
    controller,
    sourceName,
    desc,
    description,
    triggerItem,
    state,
  });

  if (combinedEffectsHandled) {
    return true;
  }

  if (applyRetiredTriggerLegacySingleEffectRegexBatch({
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
    isKynaiosEffect,
  })) {
    return true;
  }

  if (applyRetiredTriggerLegacyLateEffectRegexBatch({
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
  })) {
    return true;
  }

  if (maybeApplyPreparedStateChange(ctx, controller, description, triggerItem, getTriggerSourcePermanent(state, triggerItem))) {
    return true;
  }

  return false;
}
