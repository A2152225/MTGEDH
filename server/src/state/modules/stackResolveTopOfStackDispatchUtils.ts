import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import type { ResolveTopOfStackContinuation } from './stackResolveSharedTypes.js';
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
    if (tryResolveStackActivatedAbilityEarlyHandlers(ctx, item, controller)) {
      return true;
    }
    if (tryResolveStackActivatedAbilityMidHandlers(ctx, item, controller)) {
      return true;
    }
    if (tryResolveStackActivatedAbilityLateHandlers(ctx, item, controller, targets, { executeTriggerEffect })) {
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
      return true;
    }
  }

  return false;
}
