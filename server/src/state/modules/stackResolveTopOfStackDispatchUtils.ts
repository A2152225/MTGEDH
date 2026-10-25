import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type {
  ResolveTopOfStackContinuation,
  StackActivatedAbilityHandlerContext,
} from './stackResolveSharedTypes.js';
import {
  tryResolveStackActivatedAbilityEarlyHandlers,
  tryResolveStackActivatedAbilityMidHandlers,
  tryResolveStackActivatedAbilityLateHandlers,
} from './stackResolveAbilityHandlersUtils.js';
import { resolveTriggeredAbilityStackItem } from './stackResolveTriggeredAbilityOrchestratorUtils.js';
import { resolvePermanentSpellStackItem } from './stackResolvePermanentSpellOrchestratorUtils.js';
import { resolveInstantOrSorceryStackItem } from './stackResolveInstantSorceryOrchestratorUtils.js';
import { executeTriggerEffect } from './stackExecuteTriggerEffectUtils.js';
import { finalizeResolveTopOfStackAfterEffects } from './stackResolveTopOfStackPostResolutionUtils.js';
import { applyNextCastRiders } from './nextCastDelayedRiders.js';
import { isCostGatedNextCastRiderText } from './oracleIrTriggerLegacyRouting.js';

/**
 * Sword of Wealth and Power: the trigger's description may carry only the first sentence
 * ("create a Treasure token"); recover the rest of that ability's line from the source oracle text.
 */
export function findSourceNextCastRiderText(oracleText: unknown, description: string): string {
  const desc = String(description || '').trim().replace(/\.$/, '').toLowerCase();
  if (!desc) return '';
  for (const line of String(oracleText || '').split(/\n+/)) {
    const lower = line.toLowerCase();
    if (!/^(?:whenever|when|at)\b/.test(lower) || !lower.includes('when you next cast')) continue;
    const firstComma = lower.indexOf(',');
    const body = lower.slice(firstComma + 1).trim();
    if (firstComma > 0 && body.startsWith(desc)) return line.slice(firstComma + 1).trim();
  }
  return '';
}

/** Registers "when you next cast ... this turn" riders from a resolving activated/loyalty/triggered ability. */
export function registerAbilityNextCastRiders(ctx: GameContext, item: any, controller: string, spellXValue: unknown): void {
  let text = String(item?.description || item?.effect || item?.abilityText || '');
  const sourceId = String(item?.source || item?.sourceId || item?.permanentId || '').trim();
  const sourcePerm = sourceId
    ? ((ctx as any).state?.battlefield || []).find((p: any) => p && String(p.id || '') === sourceId)
    : undefined;
  if (!/when you next cast/i.test(text) && item?.type === 'triggered_ability') {
    text = findSourceNextCastRiderText(sourcePerm?.card?.oracle_text ?? item?.card?.oracle_text, text);
  }
  if (!/when you next cast/i.test(text)) return;
  // Cost-gated riders (Najal) register from the payment prompt's onPay, not on resolution.
  if (isCostGatedNextCastRiderText(text)) return;
  const power = Number(sourcePerm?.effectivePower ?? sourcePerm?.power ?? sourcePerm?.basePower ?? sourcePerm?.card?.power);
  applyNextCastRiders(ctx, text, {
    controllerId: String(controller || ''),
    sourceName: String(item?.sourceName || sourcePerm?.card?.name || 'Ability'),
    sourceId: sourceId || undefined,
    originId: String(item?.id || '') || undefined,
    xValue: Number(spellXValue ?? item?.xValue) || 0,
    sourcePower: Number.isFinite(power) ? power : 0,
  });
}

/**
 * Routes a popped stack item through ability, trigger, permanent, and instant/sorcery
 * resolution. Returns true when resolveTopOfStack should return immediately.
 */
export function tryDispatchResolvedStackItem(
  ctx: GameContext,
  continuation: ResolveTopOfStackContinuation,
): boolean {
  const {
    item,
    card,
    controller,
    targets,
    spellXValue,
    effectiveCard,
    effectiveTypeLine,
    fallbackOracleText,
    bumpSeq,
  } = continuation;

  if ((item as any).type === 'ability' || (item as any).type === 'triggered_ability') {
    registerAbilityNextCastRiders(ctx, item, String(controller || ''), spellXValue);
  }

  if ((item as any).type === 'ability') {
    const abilityHandlerContext: StackActivatedAbilityHandlerContext = {
      item,
      controller: controller as PlayerID,
    };
    if (tryResolveStackActivatedAbilityEarlyHandlers(ctx, abilityHandlerContext)) {
      return true;
    }
    if (tryResolveStackActivatedAbilityMidHandlers(ctx, abilityHandlerContext)) {
      return true;
    }
    if (tryResolveStackActivatedAbilityLateHandlers(ctx, {
      ...abilityHandlerContext,
      targets,
      executeTriggerEffect,
    })) {
      return true;
    }
  }

  if ((item as any).type === 'triggered_ability') {
    if (resolveTriggeredAbilityStackItem(ctx, {
      item,
      controller: controller as PlayerID,
      executeTriggerEffect,
    })) {
      return true;
    }
  }

  const permanentOutcome = resolvePermanentSpellStackItem(ctx, {
    controller: controller as PlayerID,
    card,
    effectiveCard,
    effectiveTypeLine,
    item,
    targets,
    fallbackOracleText,
    bumpSeq,
  });
  if (permanentOutcome === 'mutate') {
    return true;
  }
  if (permanentOutcome === 'permanent') {
    finalizeResolveTopOfStackAfterEffects(ctx);
    return true;
  }

  if (effectiveCard) {
    if (resolveInstantOrSorceryStackItem(ctx, {
      controller: controller as PlayerID,
      card,
      effectiveCard,
      item,
      targets,
      spellXValue,
      executeTriggerEffect,
    })) {
      // Permanents already finalize here. Instants/sorceries must as well so
      // lethal damage (Blasphemous Act) and similar SBAs fire after IR apply.
      finalizeResolveTopOfStackAfterEffects(ctx);
      return true;
    }
  }

  return false;
}
