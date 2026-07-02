import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { recordOracleIrGapTelemetry } from './oracleIrGapTelemetry.js';
import { tryApplyRoomDoorStateFromResolvedEffect } from './triggers/room.js';
import { tryApplyTriggerEffectPrefaceHandlers } from './stackExecuteTriggerEffectPrefaceUtils.js';
import { normalizeTriggerEffectDescriptionForExecution } from './trigger-runtime-wiring.js';
import { tryApplyTriggerEffectLegacyBodyHandlers } from './stackExecuteTriggerEffectLegacyBodyUtils.js';
import { tryApplyTriggerEffectLegacyTailHandlers } from './stackExecuteTriggerEffectTailUtils.js';
import { isOracleIrTriggerPrimaryEnabled, tryResolveTriggerViaOracleIR } from './oracleIrTriggerExecution.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from './oracleIrTriggerLegacyRouting.js';
import { maybeApplyPreparedStateChange } from './triggerPreparedStateUtils.js';
import { getTriggerSourcePermanent } from './triggerSourceUtils.js';
import { resolveTriggerStackItemEffectText } from './triggerStackItemEffectText.js';
import { applyRetiredTriggerLegacyKeywordTriggerFallback } from './oracleIrTriggerLegacyKeywordHandlers.js';
import { applyRetiredTriggerLegacyCreateCreatureToken } from './oracleIrTriggerLegacyTokenHandlers.js';
import { tryApplyPresetTriggerChosenTypeEffects } from './stackExecuteTriggerChosenTypeUtils.js';

function isCreateCreatureTokenTriggerText(text: string): boolean {
  return /create (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+).*?\s+tokens?/i.test(String(text || ''));
}

/** Retirement triage (D2): tag legacy trigger executions while IR primary is enabled. */
function recordLegacyTriggerHandled(
  ctx: GameContext,
  sourceName: string,
  effectText: string,
  handlerFamily: string,
): void {
  if (!isOracleIrTriggerPrimaryEnabled()) return;
  recordOracleIrGapTelemetry({
    kind: 'legacy_handled',
    scope: 'trigger',
    label: sourceName,
    reasons: [`legacy_family:${handlerFamily}`],
    effectText,
    gameId: String((ctx as any)?.gameId || '') || undefined,
  });
}

export function executeTriggerEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any
): void {
  const resolvedFromItem = resolveTriggerStackItemEffectText(triggerItem);
  const normalizedDescription = normalizeTriggerEffectDescriptionForExecution(
    String(resolvedFromItem || description || '').trim(),
  );
  const state = (ctx as any).state;
  if (!state) return;
  const triggerCard = (triggerItem as any)?.card || {};
  const battlefield = state.battlefield || [];

  if (tryApplyTriggerEffectPrefaceHandlers(ctx, controller, sourceName, normalizedDescription, triggerItem, state, battlefield)) {
    return;
  }

  if (tryApplyPresetTriggerChosenTypeEffects(ctx, controller, sourceName, normalizedDescription, triggerItem)) {
    return;
  }

  const triggerIrOutcome = tryResolveTriggerViaOracleIR(ctx, {
    controller,
    sourceName,
    effectText: String(normalizedDescription || '').trim(),
    triggerItem,
  });
  if (triggerIrOutcome.handled) {
    tryApplyRoomDoorStateFromResolvedEffect(ctx, controller, normalizedDescription, triggerItem);
    return;
  }

  if (
    isTriggerEffectOwnedByOracleIrPrimary(normalizedDescription, sourceName)
    && maybeApplyPreparedStateChange(
      ctx,
      controller,
      normalizedDescription,
      triggerItem,
      getTriggerSourcePermanent(state, triggerItem),
    )
  ) {
    tryApplyRoomDoorStateFromResolvedEffect(ctx, controller, normalizedDescription, triggerItem);
    return;
  }

  const normalizedDesc = String(normalizedDescription || '').replace(/[\u2019]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();
  if (isCreateCreatureTokenTriggerText(normalizedDesc)) {
    if (applyRetiredTriggerLegacyCreateCreatureToken({
      ctx,
      controller,
      sourceName,
      desc: normalizedDesc,
      description: normalizedDescription,
      triggerItem,
      state,
    })) {
      recordLegacyTriggerHandled(ctx, sourceName, normalizedDescription, 'create_creature_token');
      return;
    }
  }

  if (applyRetiredTriggerLegacyKeywordTriggerFallback({
    ctx,
    controller,
    sourceName,
    description: normalizedDescription,
    triggerItem,
    state,
    triggerCard,
    battlefield,
  })) {
    recordLegacyTriggerHandled(ctx, sourceName, normalizedDescription, 'keyword_trigger_fallback');
    return;
  }

  const legacyBodyResult = tryApplyTriggerEffectLegacyBodyHandlers(
    ctx,
    controller,
    sourceName,
    normalizedDescription,
    triggerItem,
    state,
    triggerCard,
  );
  if (legacyBodyResult.handled) {
    recordLegacyTriggerHandled(ctx, sourceName, normalizedDescription, 'legacy_body');
    tryApplyRoomDoorStateFromResolvedEffect(ctx, controller, normalizedDescription, triggerItem);
    return;
  }

  if (tryApplyTriggerEffectLegacyTailHandlers(
    ctx,
    controller,
    sourceName,
    normalizedDescription,
    triggerItem,
    triggerCard,
    state,
    legacyBodyResult,
  )) {
    recordLegacyTriggerHandled(ctx, sourceName, normalizedDescription, 'legacy_tail');
    tryApplyRoomDoorStateFromResolvedEffect(ctx, controller, normalizedDescription, triggerItem);
    return;
  }

  debug(2, `[executeTriggerEffect] Unhandled trigger effect: "${normalizedDescription}" from ${sourceName}`);
}
