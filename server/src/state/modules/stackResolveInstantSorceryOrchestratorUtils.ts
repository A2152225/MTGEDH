import type { GameContext } from '../context.js';
import { tryResolveInstantSorceryPreface } from './stackResolveInstantSorceryPrefaceUtils.js';
import { tryResolveInstantSorceryLegacyResolution } from './stackResolveInstantSorceryLegacyResolutionUtils.js';
import type { InstantSorceryStackResolveOptions } from './stackResolveSharedTypes.js';
import { registerTurnScopedSpellTriggers, stripTurnScopedTriggerSentences } from './triggers/turnScopedSpellTriggers.js';
/**
 * Resolves a non-permanent stack item (instant/sorcery). Returns true when
 * resolveTopOfStack should return immediately (prompt queued or resolution finalized).
 */
export function resolveInstantOrSorceryStackItem(
  ctx: GameContext,
  options: InstantSorceryStackResolveOptions,
): boolean {
  // "This turn, whenever ..." clauses become turn-scoped trigger sources (Pure Intentions).
  registerTurnScopedSpellTriggers(ctx.state, options.effectiveCard || options.card, String(options.controller || ''), String(options.item?.id || ''), options.item?.selectedModes, { wasKicked: (options.item as any)?.wasKicked === true || (options.item as any)?.card?.wasKicked === true, targets: (options.item as any)?.targets });
  // The delayed-trigger sentences registered above must not also run at resolution.
  const sourceCard: any = options.effectiveCard || options.card;
  const fullText = String(sourceCard?.oracle_text || '');
  const resolutionText = stripTurnScopedTriggerSentences(fullText);
  if (resolutionText && resolutionText !== fullText.trim()) {
    options = { ...options, effectiveCard: { ...sourceCard, oracle_text: resolutionText } } as InstantSorceryStackResolveOptions;
  }
  const prefaceResult = tryResolveInstantSorceryPreface(ctx, options);
  if (prefaceResult.handled === true) {
    return true;
  }

  return tryResolveInstantSorceryLegacyResolution(ctx, options, prefaceResult);
}
