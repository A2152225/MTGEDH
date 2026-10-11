import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import { applyExplicitDayNightChangeFromText } from './day-night.js';
import { queueParsedKeywordAction } from './triggerEmissionFamilyUtils.js';
import { hasWouldEnterDiscardLandReplacement, queueWouldEnterDiscardLandChoiceForStackItem } from './land-would-enter-replacement.js';
import { popStackItem } from './stackPushUtils.js';
import { resolveStackItemEffectiveCard } from './stackResolveEffectiveCardUtils.js';
import {
  moveFizzledStackSpellCard,
  shouldFizzleStackSpellForMissingTargets,
} from './stackTargetLegalityUtils.js';
import type { ResolveTopOfStackPrefaceResult } from './stackResolveSharedTypes.js';
import { resolveTriggeredAbilityControllerId } from './triggerSourceUtils.js';

export type { ResolveTopOfStackContinuation, ResolveTopOfStackPrefaceResult } from './stackResolveSharedTypes.js';

export function tryPrepareResolveTopOfStackContext(ctx: GameContext): ResolveTopOfStackPrefaceResult {
  const stack = ctx.state?.stack;
  const pendingTop =
    Array.isArray(stack) && stack.length > 0 ? stack[stack.length - 1] : null;
  if (pendingTop && hasWouldEnterDiscardLandReplacement(pendingTop.card)) {
    // Spell already waiting on discard-land replacement — never pop/resolve again.
    if ((pendingTop as any).wouldEnterDiscardLandDeferred === true) {
      queueWouldEnterDiscardLandChoiceForStackItem(ctx, pendingTop);
      ctx.bumpSeq();
      return { handled: true };
    }
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
  const resolvedController = resolveTriggeredAbilityControllerId(state, item, (item as any).controller);
  if (resolvedController && String((item as any).controller || '').trim() !== resolvedController) {
    (item as any).controller = resolvedController;
  }
  const controller = (resolvedController || (item as any).controller) as PlayerID;
  const targets = (item as any).targets || [];
  const spellXValue = (item as any).xValue;

  const { effectiveCard, effectiveTypeLine } = resolveStackItemEffectiveCard(item, card);

  try {
    const resolvedText = `${String((item as any)?.description || '')}\n${String((effectiveCard as any)?.oracle_text || '')}`;
    if (applyExplicitDayNightChangeFromText(state as any, resolvedText)) {
      queueParsedKeywordAction(ctx, String(controller), 'day_night');
    }
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
