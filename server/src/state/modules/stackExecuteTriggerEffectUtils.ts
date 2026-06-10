import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { tryApplyTriggerEffectPrefaceHandlers } from './stackExecuteTriggerEffectPrefaceUtils.js';
import { tryApplyTriggerEffectLegacyBodyHandlers } from './stackExecuteTriggerEffectLegacyBodyUtils.js';
import { tryApplyTriggerEffectLegacyTailHandlers } from './stackExecuteTriggerEffectTailUtils.js';
import { tryResolveTriggerViaOracleIR } from './oracleIrTriggerExecution.js';

export function executeTriggerEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any
): void {
  const state = (ctx as any).state;
  if (!state) return;
  const triggerCard = (triggerItem as any)?.card || {};
  const battlefield = state.battlefield || [];

  if (tryApplyTriggerEffectPrefaceHandlers(ctx, controller, sourceName, description, triggerItem, state, battlefield)) {
    return;
  }

  const triggerIrOutcome = tryResolveTriggerViaOracleIR(ctx, {
    controller,
    sourceName,
    effectText: String(description || '').trim(),
    triggerItem,
  });
  if (triggerIrOutcome.handled) {
    return;
  }

  const legacyBodyResult = tryApplyTriggerEffectLegacyBodyHandlers(
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    state,
    triggerCard,
  );
  if (legacyBodyResult.handled) {
    return;
  }

  if (tryApplyTriggerEffectLegacyTailHandlers(
    ctx,
    controller,
    sourceName,
    description,
    triggerItem,
    triggerCard,
    state,
    legacyBodyResult,
  )) {
    return;
  }

  debug(2, `[executeTriggerEffect] Unhandled trigger effect: "${description}" from ${sourceName}`);
}
