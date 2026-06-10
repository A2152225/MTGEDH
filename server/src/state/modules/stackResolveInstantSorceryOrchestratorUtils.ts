import type { GameContext } from '../context.js';
import { tryResolveInstantSorceryPreface } from './stackResolveInstantSorceryPrefaceUtils.js';
import { tryResolveInstantSorceryLegacyResolution } from './stackResolveInstantSorceryLegacyResolutionUtils.js';
import type { InstantSorceryStackResolveOptions } from './stackResolveSharedTypes.js';
/**
 * Resolves a non-permanent stack item (instant/sorcery). Returns true when
 * resolveTopOfStack should return immediately (prompt queued or resolution finalized).
 */
export function resolveInstantOrSorceryStackItem(
  ctx: GameContext,
  options: InstantSorceryStackResolveOptions,
): boolean {
  const prefaceResult = tryResolveInstantSorceryPreface(ctx, options);
  if (prefaceResult.handled) {
    return true;
  }

  return tryResolveInstantSorceryLegacyResolution(ctx, options, prefaceResult);
}
