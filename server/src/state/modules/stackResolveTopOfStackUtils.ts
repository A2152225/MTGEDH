import type { GameContext } from '../context.js';
import { tryPrepareResolveTopOfStackContext } from './stackResolveTopOfStackPrefaceUtils.js';
import { tryDispatchResolvedStackItem } from './stackResolveTopOfStackDispatchUtils.js';
import { finalizeResolveTopOfStackAfterEffects } from './stackResolveTopOfStackPostResolutionUtils.js';

export function resolveTopOfStack(ctx: GameContext) {
  const preface = tryPrepareResolveTopOfStackContext(ctx);
  if (preface.handled) {
    return;
  }

  if (tryDispatchResolvedStackItem(ctx, preface)) {
    return;
  }

  finalizeResolveTopOfStackAfterEffects(ctx);
}
