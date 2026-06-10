import type { GameContext } from '../context.js';
import { isPermanentTypeLine } from './stackResolvePermanentSpellTypeUtils.js';
import { applyPermanentSpellPostEntrySteps } from './stackResolvePermanentSpellPostEntryUtils.js';
import { resolvePermanentSpellBattlefieldEntry } from './stackResolvePermanentEntryUtils.js';
import type { PermanentSpellStackResolveOptions } from './stackResolveSharedTypes.js';

export function resolvePermanentSpellStackItem(
  ctx: GameContext,
  options: PermanentSpellStackResolveOptions,
): 'mutate' | 'permanent' | false {
  if (!options.effectiveCard || !isPermanentTypeLine(options.effectiveTypeLine)) {
    return false;
  }

  const { bumpSeq, ...entryOptions } = options;
  const entryOutcome = resolvePermanentSpellBattlefieldEntry(ctx, entryOptions);
  if (entryOutcome.mutateResolved) {
    bumpSeq();
    return 'mutate';
  }

  applyPermanentSpellPostEntrySteps(ctx, {
    controller: options.controller,
    card: options.card,
    effectiveCard: options.effectiveCard,
    newPermanent: entryOutcome.newPermanent,
    newPermId: entryOutcome.newPermId,
    isCreature: entryOutcome.isCreature,
  });

  return 'permanent';
}
