/**
 * Player bindings for trigger conditions: "attacks you" (the player, not a planeswalker),
 * "attacks enchanted player", "deals combat damage to enchanted player" and
 * "a land enchanted player controls enters". All fail closed when the context lacks the ids.
 * Origin parent: match.ts triggerConditionMatches.
 * Public: playerBindingsMatch.
 */

import type { TriggerConditionIR, TriggerMatchContext, TriggerMatchPermanent, TriggerMatchSource } from './types.js';

const id = (value: unknown): string => String(value || '').trim();

export function playerBindingsMatch(
  condition: TriggerConditionIR,
  subject: TriggerMatchPermanent,
  source: TriggerMatchSource,
  context?: TriggerMatchContext,
): boolean {
  const enchanted = id(context?.enchantedPlayerId);
  if (condition.attackedTargetType === 'player' && context?.attackedTargetIsPlayer !== true) return false;
  if (condition.attackedPlayer === 'opponent') {
    const attacked = id(context?.attackedPlayerId);
    if (!attacked || attacked === id(source.controllerId)) return false;
  }
  if (condition.attackedPlayer === 'enchanted' && (!enchanted || id(context?.attackedPlayerId) !== enchanted)) return false;
  if (condition.damagedPlayer === 'enchanted' && (!enchanted || id(context?.damagedPlayerId) !== enchanted)) return false;
  if (condition.subjectControlledBy === 'enchanted_player' && (!enchanted || id(subject.controllerId) !== enchanted)) return false;
  return true;
}
