import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import {
  addLoreCounter,
  detectSagaLoreCounterTrigger,
  sacrificePermanent,
} from './upkeep-triggers.js';
import { maybeProcessPendingAttractionVisitRoll } from './triggers/attraction-visit.js';

export type SagaChapterStackTrigger = {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  mandatory: boolean;
  sagaChapter: number;
  sagaSacrificeAfterResolve: boolean;
};

export type SagaLorePrecombatMainResult = {
  loreCountersAdded: number;
  chapterTriggers: SagaChapterStackTrigger[];
};

function buildSagaChapterStackItem(params: {
  controller: PlayerID;
  permanentId: string;
  sagaName: string;
  chapter: number;
  effect: string;
  shouldSacrifice: boolean;
}): Record<string, unknown> {
  return {
    id: `saga_chapter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'triggered_ability',
    controller: params.controller,
    source: params.permanentId,
    permanentId: params.permanentId,
    sourceName: params.sagaName,
    description: params.effect,
    effect: params.effect,
    triggerType: 'saga_chapter',
    mandatory: true,
    sagaChapter: params.chapter,
    sagaSacrificeAfterResolve: params.shouldSacrifice,
  };
}

/**
 * Rule 714.3b: add lore counters synchronously at precombat main (turn-based action).
 * Rule 714.3c: queue chapter triggered abilities that result from the new counters.
 */
export function processSagaLoreCountersAtPrecombatMain(
  ctx: GameContext,
  playerId: PlayerID,
): SagaLorePrecombatMainResult {
  const result: SagaLorePrecombatMainResult = { loreCountersAdded: 0, chapterTriggers: [] };
  const battlefield = ctx.state?.battlefield || [];

  for (const permanent of battlefield) {
    if (!permanent?.card || permanent.controller !== playerId) continue;
    if (!detectSagaLoreCounterTrigger(permanent.card, permanent, (ctx as any)?.state)) continue;

    const permanentId = String(permanent.id || '').trim();
    if (!permanentId) continue;

    const { newChapter, triggeredAbility, shouldSacrifice } = addLoreCounter(ctx, permanentId);
    if (newChapter <= 0) continue;

    result.loreCountersAdded += 1;
    debug(
      2,
      `[saga] ${permanent.card?.name || permanentId}: lore counter added synchronously at precombat main (${newChapter})`,
    );

    if (!triggeredAbility?.effect) continue;

    const sagaName = String(permanent.card?.name || 'Saga');
    result.chapterTriggers.push({
      permanentId,
      cardName: sagaName,
      controllerId: playerId,
      description: triggeredAbility.effect,
      effect: triggeredAbility.effect,
      mandatory: true,
      sagaChapter: newChapter,
      sagaSacrificeAfterResolve: shouldSacrifice,
    });
  }

  return result;
}

/** Push saga chapter triggers onto the stack for resolution / trigger ordering. */
export function pushSagaChapterTriggersToStack(
  ctx: GameContext,
  playerId: PlayerID,
  chapterTriggers: SagaChapterStackTrigger[],
): number {
  if (!chapterTriggers.length) return 0;

  const state = (ctx as any).state;
  state.stack = Array.isArray(state.stack) ? state.stack : [];

  for (const trigger of chapterTriggers) {
    const stackItem = buildSagaChapterStackItem({
      controller: playerId,
      permanentId: trigger.permanentId,
      sagaName: trigger.cardName,
      chapter: trigger.sagaChapter,
      effect: trigger.effect,
      shouldSacrifice: trigger.sagaSacrificeAfterResolve,
    });
    stackItem.triggeringPlayer = playerId;
    state.stack.push(stackItem);
    debug(
      2,
      `[saga] ${trigger.cardName} chapter ${trigger.sagaChapter} queued: ${trigger.effect}`,
    );
  }

  return chapterTriggers.length;
}

export function applySagaLoreCounterFromTrigger(params: {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly triggerItem: any;
}): boolean {
  const triggerType = String(params.triggerItem?.triggerType || '').trim();
  const effect = String(params.triggerItem?.effect || params.triggerItem?.description || '').trim();
  if (triggerType !== 'saga_lore_counter' && effect !== 'add_lore_counter') {
    return false;
  }

  const permanentId = String(
    params.triggerItem?.source
    || params.triggerItem?.permanentId
    || params.triggerItem?.sourceId
    || '',
  ).trim();
  if (!permanentId) {
    return false;
  }

  const { newChapter, triggeredAbility, shouldSacrifice } = addLoreCounter(params.ctx, permanentId);
  if (newChapter <= 0) {
    maybeProcessPendingAttractionVisitRoll(params.ctx);
    return true;
  }

  const state = (params.ctx as any).state;
  if (!triggeredAbility?.effect) {
    maybeProcessPendingAttractionVisitRoll(params.ctx);
    return true;
  }

  const sagaName = params.sourceName || 'Saga';
  const chapterStackItem = buildSagaChapterStackItem({
    controller: params.controller,
    permanentId,
    sagaName,
    chapter: newChapter,
    effect: triggeredAbility.effect,
    shouldSacrifice,
  });

  state.stack = Array.isArray(state.stack) ? state.stack : [];
  state.stack.push(chapterStackItem);
  debug(
    2,
    `[saga] ${sagaName} chapter ${newChapter} queued after lore counter: ${triggeredAbility.effect}`,
  );

  maybeProcessPendingAttractionVisitRoll(params.ctx);
  return true;
}

export function maybeSacrificeSagaAfterChapterResolve(
  ctx: GameContext,
  controller: PlayerID,
  triggerItem: any,
): void {
  if (triggerItem?.sagaSacrificeAfterResolve !== true) {
    return;
  }

  const permanentId = String(
    triggerItem?.source
    || triggerItem?.permanentId
    || triggerItem?.sourceId
    || '',
  ).trim();
  if (!permanentId) {
    return;
  }

  const sacrificed = sacrificePermanent(ctx, permanentId, controller);
  if (sacrificed) {
    debug(2, `[saga] Sacrificed ${triggerItem?.sourceName || 'Saga'} after final chapter resolved`);
  }
}
