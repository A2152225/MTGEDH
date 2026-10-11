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
  if (!reflexive?.effect) return;
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
    ...(item.card ? { card: item.card } : {}),
  });
}
