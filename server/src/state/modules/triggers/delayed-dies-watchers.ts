/**
 * Origin parent: server/src/state/modules/triggers/death-emission.ts
 * Cluster: delayed WHEN_DIES watchers created by resolving spells
 *   (Reckless Blaze / Skeletonize "dealt damage this way dies this turn").
 * Public: collectDelayedDiesWatcherTriggers
 * These live on state.delayedTriggerRegistry, not battlefield oracle.
 */

import type { GameContext } from '../../context.js';
import {
  DelayedTriggerTiming,
  checkDelayedTriggers,
  createDelayedTriggerRegistry,
} from '../../../../../rules-engine/src/delayedTriggeredAbilities.js';
import type { DeathTriggerResult } from './death-emission-helpers.js';

export function collectDelayedDiesWatcherTriggers(
  ctx: GameContext,
  dyingCreature: any,
): DeathTriggerResult[] {
  if ((ctx as any)?.isReplaying) return [];
  const state = (ctx as any).state;
  if (!state) return [];

  const permanentId = String(dyingCreature?.id || '').trim();
  if (!permanentId) return [];

  const registry = (state.delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<
    typeof createDelayedTriggerRegistry
  >;
  const watched = registry.triggers.filter(
    (trigger) =>
      trigger.timing === DelayedTriggerTiming.WHEN_DIES
      && String(trigger.watchingPermanentId || '').trim() === permanentId,
  );
  if (watched.length === 0) return [];

  const delayedCheck = checkDelayedTriggers(registry, {
    type: 'dies',
    permanentId,
    playerId: String(dyingCreature?.controller || '') || undefined,
  });
  if (delayedCheck.triggersToFire.length === 0) return [];

  state.delayedTriggerRegistry = {
    ...registry,
    triggers: delayedCheck.remainingTriggers,
    firedTriggerIds: [
      ...registry.firedTriggerIds,
      ...delayedCheck.triggersToFire.map((trigger) => trigger.id),
    ],
  };

  return delayedCheck.triggersToFire.map((delayed) => {
    const effect = String(delayed.effect || '').trim();
    return {
      source: {
        permanentId: String(delayed.sourceId || delayed.watchingPermanentId || permanentId),
        cardName: String(delayed.sourceName || 'Delayed dies trigger'),
        controllerId: String(delayed.controllerId || ''),
      },
      effect,
      dyingCreatureCard: dyingCreature?.card,
      triggerType: 'dealt_damage_this_way_dies',
    };
  }).filter((result) => Boolean(result.effect));
}
