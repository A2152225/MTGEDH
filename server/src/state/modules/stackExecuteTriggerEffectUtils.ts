import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { recordLegacyTriggerHandlerTelemetry } from './oracleIrTriggerLegacyHandlerTelemetry.js';
import { tryApplyRoomDoorStateFromResolvedEffect } from './triggers/room.js';
import { tryApplyTriggerEffectPrefaceHandlers } from './stackExecuteTriggerEffectPrefaceUtils.js';
import { normalizeTriggerEffectDescriptionForExecution } from './trigger-runtime-wiring.js';
import { tryApplyTriggerEffectLegacyBodyHandlers } from './stackExecuteTriggerEffectLegacyBodyUtils.js';
import { tryApplyTriggerEffectLegacyTailHandlers } from './stackExecuteTriggerEffectTailUtils.js';
import { isOracleIrTriggerPrimaryEnabled, tryResolveTriggerViaOracleIR } from './oracleIrTriggerExecution.js';
import { tryResolvePlaneswalkerLoyaltyTemplate } from '../planeswalker/templates/resolve.js';
import { isTriggerEffectOwnedByOracleIrPrimary, isTriggerEffectFullyIrWired } from './oracleIrTriggerLegacyRouting.js';
import { getPlaneswalkerTemplateMatch } from '../planeswalker/templates/registry.js';
import { maybeApplyPreparedStateChange } from './triggerPreparedStateUtils.js';
import { getTriggerSourcePermanent } from './triggerSourceUtils.js';
import { resolveTriggerStackItemEffectText } from './triggerStackItemEffectText.js';
import { applyKeywordTriggerFallbackFromOracle } from './triggerKeywordFallbackUtils.js';
import { tryApplyPresetTriggerChosenTypeEffects } from './stackExecuteTriggerChosenTypeUtils.js';
import { applyStackParadigmTrigger, applyStackReboundTrigger } from './stackSpecialTriggerHandlers.js';

/** Retirement triage (D2): tag legacy trigger executions while IR primary is enabled. */
function recordLegacyTriggerHandled(
  ctx: GameContext,
  sourceName: string,
  effectText: string,
  handlerFamily: string,
  legacyHandler?: string,
): void {
  recordLegacyTriggerHandlerTelemetry(ctx, sourceName, effectText, handlerFamily, legacyHandler);
}

export function executeTriggerEffect(
  ctx: GameContext,
  controller: PlayerID,
  sourceName: string,
  description: string,
  triggerItem: any
): void {
  const resolvedFromItem = resolveTriggerStackItemEffectText(triggerItem, {
    state: (ctx as any).state,
  });
  const normalizedDescription = normalizeTriggerEffectDescriptionForExecution(
    String(resolvedFromItem || description || '').trim(),
  );
  const state = (ctx as any).state;
  if (!state) return;
  const triggerCard = (triggerItem as any)?.card || {};
  const battlefield = state.battlefield || [];

  const prefaceResult = tryApplyTriggerEffectPrefaceHandlers(
    ctx,
    controller,
    sourceName,
    normalizedDescription,
    triggerItem,
    state,
    battlefield,
  );
  if (prefaceResult.handled) {
    recordLegacyTriggerHandled(
      ctx,
      sourceName,
      normalizedDescription,
      'legacy_preface',
      prefaceResult.legacyHandler,
    );
    return;
  }

  if (tryApplyPresetTriggerChosenTypeEffects(ctx, controller, sourceName, normalizedDescription, triggerItem)) {
    return;
  }

  if (applyStackReboundTrigger({
    ctx,
    controller,
    sourceName,
    desc: normalizedDescription,
    triggerItem,
    state,
  })) {
    return;
  }

  if (applyStackParadigmTrigger({
    ctx,
    controller,
    sourceName,
    desc: normalizedDescription,
    triggerItem,
    state,
  })) {
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

  if (!isOracleIrTriggerPrimaryEnabled()) {
    const templateMatch = getPlaneswalkerTemplateMatch(normalizedDescription);
    const skipIrWiredPlaneswalkerTemplate =
      Boolean(templateMatch)
      && isTriggerEffectFullyIrWired(normalizedDescription, sourceName)
      && templateMatch!.id !== 'YOU_MAY_DISCARD_A_CARD_IF_YOU_DO_DRAW_A_CARD';

    if (
      !skipIrWiredPlaneswalkerTemplate
      && tryResolvePlaneswalkerLoyaltyTemplate(ctx, controller, sourceName, normalizedDescription, triggerItem)
    ) {
      recordLegacyTriggerHandled(
        ctx,
        sourceName,
        normalizedDescription,
        'planeswalker_template',
        'tryResolvePlaneswalkerLoyaltyTemplate',
      );
      tryApplyRoomDoorStateFromResolvedEffect(ctx, controller, normalizedDescription, triggerItem);
      return;
    }
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

  if (applyKeywordTriggerFallbackFromOracle({
    ctx,
    controller,
    sourceName,
    description: normalizedDescription,
    triggerItem,
    state,
    triggerCard,
    battlefield,
  })) {
    recordLegacyTriggerHandled(
      ctx,
      sourceName,
      normalizedDescription,
      'keyword_trigger_fallback',
      'applyKeywordTriggerFallbackFromOracle',
    );
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
    recordLegacyTriggerHandled(
      ctx,
      sourceName,
      normalizedDescription,
      'legacy_body',
      legacyBodyResult.legacyHandler,
    );
    tryApplyRoomDoorStateFromResolvedEffect(ctx, controller, normalizedDescription, triggerItem);
    return;
  }

  const legacyTailResult = tryApplyTriggerEffectLegacyTailHandlers(
    ctx,
    controller,
    sourceName,
    normalizedDescription,
    triggerItem,
    triggerCard,
    state,
    legacyBodyResult,
  );
  if (legacyTailResult.handled) {
    if (legacyTailResult.legacyHandler) {
      recordLegacyTriggerHandled(
        ctx,
        sourceName,
        normalizedDescription,
        'legacy_tail',
        legacyTailResult.legacyHandler,
      );
    }
    tryApplyRoomDoorStateFromResolvedEffect(ctx, controller, normalizedDescription, triggerItem);
    return;
  }

  debug(2, `[executeTriggerEffect] Unhandled trigger effect: "${normalizedDescription}" from ${sourceName}`);
}
