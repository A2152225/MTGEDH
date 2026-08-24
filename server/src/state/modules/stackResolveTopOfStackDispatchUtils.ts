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
