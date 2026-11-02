/**
 * Schedules riders that were split off a parsed trigger effect.
 * Delayed end-step abilities are created when the instruction resolves.
 * "When you do" is queued only after an optional "you may" was accepted,
 * or immediately when the main effect is not optional.
 */

import type { GameContext } from '../context.js';
import { uid } from '../utils.js';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from '../../../../rules-engine/src/delayedTriggeredAbilities.js';

export function scheduleParsedTriggerRiders(ctx: GameContext, item: any, controllerId: string): void {
  if (!item || (ctx as any).isReplaying) return;
  const effect = String(item.effect || item.description || '');
  const optionalPending = /\byou may\b/i.test(effect) && item.optionalTriggeredAbilityDecisionApplied !== true;
  if (optionalPending) return;

  const state = (ctx as any).state;
  if (!state) return;
  const controller = String(controllerId || item.controller || '').trim();
  const sourceId = String(item.permanentId || item.source || '').trim();
  const sourceName = String(item.sourceName || 'Triggered ability');
  const turn = Number(state.turnNumber ?? state.turn ?? 0) || 0;

  const delayed = item.delayedEndStep;
  if (delayed?.effect) {
    const timing = delayed.timing === 'your_next_end_step'
      ? DelayedTriggerTiming.YOUR_NEXT_END_STEP
      : DelayedTriggerTiming.NEXT_END_STEP;
    const registry = state.delayedTriggerRegistry || createDelayedTriggerRegistry();
    state.delayedTriggerRegistry = registerDelayedTrigger(
      registry,
      createDelayedTrigger(sourceId || sourceName, sourceName, controller as any, timing, String(delayed.effect), turn),
    );
  }

  const reflexive = item.reflexiveWhenYouDo;
  if (!reflexive?.effect || item.reflexiveFoldedIntoEffect === true) return;
  let riderController = controller;
  if (reflexive.actor === 'they') {
    riderController = String(item.thatPlayerId || item.triggeringPlayer || '').trim();
    if (!riderController || riderController === controller) return;
  }
  state.stack = state.stack || [];
  state.stack.push({
    id: uid('trigger'),
    type: 'triggered_ability',
    controller: riderController,
    source: sourceId || null,
    ...(sourceId ? { permanentId: sourceId } : {}),
    sourceName,
    description: reflexive.effect,
    effect: reflexive.effect,
    triggerType: 'reflexive_when_you_do',
    mandatory: !/\byou may\b/i.test(reflexive.effect),
    ...(reflexive.delayed ? { delayedEndStep: reflexive.delayed } : {}),
    // Keep the trigger's "it" binding (Gaze of Pain: "If you do, it assigns no combat damage").
    ...(item.interveningIfSubjectPermanentId ? { interveningIfSubjectPermanentId: item.interveningIfSubjectPermanentId } : {}),
    ...(item.card ? { card: item.card } : {}),
  });
}

/**
 * An optional ("you may") trigger whose may-choice is asked inside the Effect Program never
 * reaches scheduleParsedTriggerRiders with the decision applied, so its "If you do / When you do"
 * rider would be lost. Fold the rider back into the executed text so the program runs it only
 * when the player accepts (Gaze of Pain: "If you do, it assigns no combat damage this turn").
 */
export function foldPendingOptionalReflexiveRider(item: any, effectText: string): string {
  const reflexive = item?.reflexiveWhenYouDo;
  if (!reflexive?.effect || reflexive.actor !== 'you' || reflexive.delayed || item.reflexiveFoldedIntoEffect === true) return effectText;
  const effect = String(item.effect || item.description || '');
  if (!/\byou may\b/i.test(effect) || item.optionalTriggeredAbilityDecisionApplied === true) return effectText;
  const text = String(effectText || '').trim();
  if (!text || /\b(?:if|when) you do\b/i.test(text)) return effectText;
  item.reflexiveFoldedIntoEffect = true;
  return `${text.replace(/[.\s]+$/, '')}. If you do, ${String(reflexive.effect).replace(/[.\s]+$/, '')}.`;
}
