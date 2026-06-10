import type { GameContext } from '../context.js';
import { tryDeferCopyTriggeredAbilityPrompts } from './triggerAbilityCopyUtils.js';
import { tryDeferOptionalTriggerPaymentPrompts } from './triggerOptionalPaymentQueueUtils.js';
import { tryDeferReflexiveWhenYouDoTriggers } from './triggerReflexiveWhenYouDoQueueUtils.js';
import { trySkipTriggeredAbilityForUnmetInterveningIf } from './stackResolveTriggeredAbilityInterveningIfUtils.js';
import { tryDeferOptionalTriggeredAbilityMayDecision } from './stackResolveTriggeredAbilityOptionalUtils.js';
import { tryDeferTriggeredAbilitySpecialPrompts } from './stackResolveTriggeredAbilitySpecialPromptUtils.js';
import { tryDeferTriggeredAbilityTargetSelection } from './stackResolveTriggeredAbilityTargetPromptUtils.js';
import { tryResolveTriggeredAbilityChosenTypeEffects } from './stackResolveTriggeredAbilityChosenTypeUtils.js';
import type { TriggeredAbilityDeferralOptions } from './stackResolveSharedTypes.js';

export type { TriggeredAbilityDeferralOptions } from './stackResolveSharedTypes.js';

export function tryDeferTriggeredAbilityBeforeExecution(
  ctx: GameContext,
  item: any,
  options: TriggeredAbilityDeferralOptions,
): boolean {  const {
    triggerController,
    sourceName,
    description,
    effectText,
    triggerType,
    sourceId,
    optionalTriggeredAbilityDecisionApplied,
    state,
    bumpSeq,
    executeTriggerEffect,
  } = options;

  if (trySkipTriggeredAbilityForUnmetInterveningIf(ctx, item, {
    triggerController,
    description,
    triggerType,
    sourceName,
    bumpSeq,
  })) {
    return true;
  }

  const trimmedDescription = String(description || '').trim();
  if (tryDeferCopyTriggeredAbilityPrompts(
    ctx,
    item,
    triggerController,
    sourceName,
    sourceId,
    trimmedDescription,
    triggerType,
    state,
  )) {
    return true;
  }

  if (tryDeferOptionalTriggerPaymentPrompts(
    ctx,
    item,
    triggerController,
    sourceName,
    sourceId,
    trimmedDescription,
    executeTriggerEffect,
  )) {
    return true;
  }

  if (tryDeferReflexiveWhenYouDoTriggers(
    ctx,
    item,
    triggerController,
    sourceName,
    sourceId,
    trimmedDescription,
    effectText || trimmedDescription,
    executeTriggerEffect,
  )) {
    return true;
  }

  if (tryDeferOptionalTriggeredAbilityMayDecision(ctx, item, state, {
    triggerController,
    sourceName,
    sourceId,
    effectText,
    description,
    optionalTriggeredAbilityDecisionApplied,
    bumpSeq,
  })) {
    return true;
  }

  if (tryDeferTriggeredAbilitySpecialPrompts(ctx, item, state, {
    triggerController,
    sourceName,
    sourceId,
    description,
    triggerType,
  })) {
    return true;
  }

  if (tryDeferTriggeredAbilityTargetSelection(ctx, item, state, {
    triggerController,
    sourceName,
    sourceId,
    description,
    triggerType,
  })) {
    return true;
  }

  if (tryResolveTriggeredAbilityChosenTypeEffects(ctx, item, state, {
    triggerController,
    sourceName,
    sourceId,
    effectText,
    description,
    bumpSeq,
  })) {
    return true;
  }

  return false;
}
