import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import { applyExplicitDayNightChangeFromText } from './day-night.js';
import { hasWouldEnterDiscardLandReplacement, queueWouldEnterDiscardLandChoiceForStackItem } from './land-would-enter-replacement.js';
import { popStackItem } from './stackPushUtils.js';
import { resolveStackItemEffectiveCard } from './stackResolveEffectiveCardUtils.js';
import {
  moveFizzledStackSpellCard,
  shouldFizzleStackSpellForMissingTargets,
} from './stackTargetLegalityUtils.js';
import type { ResolveTopOfStackPrefaceResult } from './stackResolveSharedTypes.js';

export type { ResolveTopOfStackContinuation, ResolveTopOfStackPrefaceResult } from './stackResolveSharedTypes.js';

export function tryPrepareResolveTopOfStackContext(ctx: GameContext): ResolveTopOfStackPrefaceResult {
  const stack = ctx.state?.stack;
  const pendingTop =
    Array.isArray(stack) && stack.length > 0 ? stack[stack.length - 1] : null;
  if (pendingTop && hasWouldEnterDiscardLandReplacement(pendingTop.card)) {
    if (queueWouldEnterDiscardLandChoiceForStackItem(ctx, pendingTop)) {
      ctx.bumpSeq();
      return { handled: true };
    }
  }

  const item = popStackItem(ctx);
  if (!item) {
    return { handled: true };
  }

  const { state, bumpSeq } = ctx;
  const card = item.card;
  const controller = item.controller as PlayerID;
  const targets = (item as any).targets || [];
  const spellXValue = (item as any).xValue;

  const { effectiveCard, effectiveTypeLine } = resolveStackItemEffectiveCard(item, card);

  try {
    const resolvedText = `${String((item as any)?.description || '')}\n${String((effectiveCard as any)?.oracle_text || '')}`;
    applyExplicitDayNightChangeFromText(state as any, resolvedText);
  } catch {}

  const fallbackOracleText = `${String((item as any)?.activatedAbilityText || '')}\n${String((item as any)?.description || '')}`.trim();

  if (shouldFizzleStackSpellForMissingTargets(state, item, effectiveCard, controller)) {
    moveFizzledStackSpellCard(ctx, item, controller);
    bumpSeq();
    return { handled: true };
  }

  return {
    handled: false,
    item,
    card,
    controller,
    targets,
    spellXValue,
    effectiveCard,
    effectiveTypeLine,
    fallbackOracleText,
    bumpSeq,
  };
}
