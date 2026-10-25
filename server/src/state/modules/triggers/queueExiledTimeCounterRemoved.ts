/**
 * Origin: server/src/state/modules/triggers/counters.ts
 * Cluster: exile-source time-counter-removed triggers (suspend payoffs)
 * Public: queueExiledTimeCounterRemovedTriggers
 *
 * `queueCounterRemovedTriggers` only scans battlefield permanents. Suspended
 * cards live in exile, so the upkeep tick must detect and queue from the
 * exile card itself.
 */

import type { GameContext } from '../../context.js';
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { uid } from '../../utils.js';
import { hasUnsupportedTargetRequirement, inferGenericTriggeredAbilityTargetMetadata } from './target-metadata.js';
import { detectCounterRemovedTriggers } from './counters.js';

function cardForOracle(exileCard: any): any {
  if (exileCard?.oracle_text) return exileCard;
  if (exileCard?.card?.oracle_text) return exileCard.card;
  return exileCard;
}

function snapshotExileCardForTrigger(exileCard: any, controllerId: string): any {
  const card = cardForOracle(exileCard);
  return {
    id: String(exileCard?.id || card?.id || ''),
    controller: controllerId,
    owner: String(exileCard?.owner || exileCard?.suspendedBy || controllerId),
    zone: 'exile',
    isSuspended: exileCard?.isSuspended === true,
    card: card && typeof card === 'object' ? { ...card } : undefined,
  };
}

export function queueExiledTimeCounterRemovedTriggers(
  ctx: GameContext,
  exileCard: any,
  controllerId: string,
): any[] {
  if (!exileCard || !controllerId) return [];
  if ((ctx as any)?.isReplaying) return [];

  const card = cardForOracle(exileCard);
  const cardId = String(exileCard?.id || card?.id || '').trim();
  if (!cardId) return [];

  const probe = snapshotExileCardForTrigger(exileCard, controllerId);
  const detected = detectCounterRemovedTriggers(card, probe, (ctx as any)?.state).filter(
    (trigger) => trigger.triggerType === 'time_counter_removed_from_exiled_self',
  );
  if (detected.length === 0) return [];

  const stateAny = ctx.state as any;
  stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
  const gameId = String((ctx as any).gameId || '').trim();
  const queued: any[] = [];
  const sourcePermanentSnapshot = snapshotExileCardForTrigger(exileCard, controllerId);

  for (const trigger of detected) {
    const effect = String(trigger.effect || '').trim();
    const targetMetadata = inferGenericTriggeredAbilityTargetMetadata(effect);
    if (!effect || hasUnsupportedTargetRequirement(targetMetadata)) {
      continue;
    }

    const triggerId = uid('trigger');
    const stackItem = {
      id: triggerId,
      type: 'triggered_ability',
      controller: controllerId,
      source: cardId,
      permanentId: cardId,
      sourceName: trigger.cardName,
      sourceZone: 'exile',
      description: effect,
      effect,
      ...targetMetadata,
      ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
      sourcePermanentSnapshot,
      triggerType: trigger.triggerType,
      mandatory: trigger.mandatory !== false,
      triggeringPermanent: cardId,
      effectData: {
        targetPermanentId: cardId,
        targetPermanentName: String(card?.name || exileCard?.name || 'Card'),
        targetPermanentController: controllerId,
        targetPermanentTypeLine: String(card?.type_line || exileCard?.type_line || ''),
        countersRemoved: 1,
        counterType: 'time',
        sourceZone: 'exile',
      },
    } as any;

    stateAny.stack.push(stackItem);
    queued.push(stackItem);

    if (gameId && gameId !== 'unknown') {
      try {
        appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
          triggerId,
          sourceId: cardId,
          permanentId: cardId,
          sourceName: trigger.cardName,
          controllerId,
          description: effect,
          triggerType: trigger.triggerType,
          effect,
          ...targetMetadata,
          mandatory: trigger.mandatory !== false,
          triggeringPermanent: cardId,
          ...(sourcePermanentSnapshot?.card ? { card: sourcePermanentSnapshot.card } : null),
          sourcePermanentSnapshot,
          effectData: stackItem.effectData,
        });
      } catch (err) {
        debugWarn(1, '[exileTimeCounter] Failed to persist exile time-counter trigger:', err);
      }
    }
  }

  return queued;
}
