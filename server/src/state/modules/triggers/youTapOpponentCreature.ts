/**
 * "Whenever you tap an untapped creature an opponent controls, <effect>" (Hylda of the Icy Crown,
 * Icewrought Sentry, Solitary Sanctuary). The tapper is the player whose spell/ability tapped it,
 * so this is queued from tap paths that know the actor (IR post-apply with its controller, and
 * tap/untap target responses), not from the controller-scoped becomes-tapped queue.
 * Public: queueYouTapOpponentCreatureTriggers, YOU_TAP_OPPONENT_CREATURE.
 */
import type { GameContext } from '../../context.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';

export const YOU_TAP_OPPONENT_CREATURE = /whenever you tap an untapped creature an opponent controls,?\s*([^\n]+)/i;

export function queueYouTapOpponentCreatureTriggers(ctx: GameContext, tappedIds: readonly string[], tapperId: string): any[] {
  try {
    if (!ctx || (ctx as any).isReplaying) return [];
    const tapper = String(tapperId || '').trim();
    if (!tapper) return [];
    const battlefield: any[] = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
    const detected: any[] = [];
    for (const id of new Set(tappedIds.map((x) => String(x || '').trim()).filter(Boolean))) {
      const tapped = battlefield.find((p: any) => p && String(p.id || '') === id);
      if (!tapped || String(tapped.controller || '') === tapper) continue;
      if (!/\bcreature\b/i.test(String(tapped.card?.type_line || ''))) continue;
      for (const watcher of battlefield) {
        if (!watcher?.card || String(watcher.controller || '') !== tapper) continue;
        const match = YOU_TAP_OPPONENT_CREATURE.exec(String(watcher.card.oracle_text || ''));
        if (!match) continue;
        const effect = match[1].trim();
        detected.push({
          permanentId: String(watcher.id || ''),
          cardName: String(watcher.card?.name || ''),
          controllerId: tapper,
          description: effect,
          effect,
          mandatory: !/^you may\b/i.test(effect),
          _tappedId: id,
        });
      }
    }
    const queued: any[] = [];
    for (const trigger of orderTriggersByAPNAP(ctx, detected)) {
      const item = queueGenericTriggeredAbility(ctx, trigger, 'you_tap_opponent_creature', {
        tappedPermanentId: (trigger as any)._tappedId,
        tapperId: tapper,
      });
      if (item) queued.push(item);
    }
    return queued;
  } catch {
    return [];
  }
}
