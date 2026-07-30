import type { GameContext } from '../context.js';
import { tryPrepareResolveTopOfStackContext } from './stackResolveTopOfStackPrefaceUtils.js';
import { tryDispatchResolvedStackItem } from './stackResolveTopOfStackDispatchUtils.js';
import { finalizeResolveTopOfStackAfterEffects } from './stackResolveTopOfStackPostResolutionUtils.js';
import {
  consumeOptionalMayAutoDeclined,
  wouldAutoDeclineOptionalTriggeredAbility,
} from './stackResolveTriggeredAbilityOptionalUtils.js';

/**
 * Resolve the top of the stack. When Always No / no-until-targets auto-declines
 * an optional trigger, continue draining consecutive auto-declinable tops so the
 * player does not need Resolve All / pass priority for each skipped Aura Shards.
 */
export function resolveTopOfStack(ctx: GameContext) {
  let guard = 0;
  while (guard++ < 64) {
    const preface = tryPrepareResolveTopOfStackContext(ctx);
    if (preface.handled === true) {
      return;
    }

    if (tryDispatchResolvedStackItem(ctx, preface)) {
      if (consumeOptionalMayAutoDeclined(ctx)) {
        const stack = (ctx as any).state?.stack;
        const top = Array.isArray(stack) && stack.length > 0 ? stack[stack.length - 1] : null;
        if (top && wouldAutoDeclineOptionalTriggeredAbility((ctx as any).state, top)) {
          continue;
        }
      }
      return;
    }

    finalizeResolveTopOfStackAfterEffects(ctx);
    return;
  }
}
