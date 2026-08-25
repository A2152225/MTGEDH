// server/src/state/modules/turn-handlers/turnCombatDamageTriggerPersist.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: persistCombatDamageTriggeredAbility, APNAP order, and
// pushCombatDamageTriggerQueueEntries.
// Public entry symbols: CombatDamageTriggerQueueEntry,
// pushCombatDamageTriggerQueueEntries.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { appendEvent } from '../../../db/index.js';
import { orderTriggersByAPNAP } from "../triggers/ordering.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

function persistCombatDamageTriggeredAbility(ctx: GameContext, stackItem: any, reason: string): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  try {
    appendEvent(gameId, Number((ctx as any).seq?.value ?? (ctx as any).seq ?? 0), 'pushTriggeredAbility', {
      triggerId: stackItem.id,
      sourceId: stackItem.source,
      permanentId: stackItem.permanentId || stackItem.source,
      sourceName: stackItem.sourceName,
      controllerId: stackItem.controller,
      description: stackItem.description,
      triggerType: stackItem.triggerType,
      effect: stackItem.effect,
      mandatory: stackItem.mandatory !== false,
      ...(Array.isArray(stackItem.targets) ? { targets: stackItem.targets } : null),
      ...(stackItem.targetPlayer ? { targetPlayer: stackItem.targetPlayer } : null),
      ...(stackItem.defendingPlayer ? { defendingPlayer: stackItem.defendingPlayer } : null),
      ...(stackItem.damagedPlayerId ? { damagedPlayerId: stackItem.damagedPlayerId } : null),
      ...(stackItem.attackingPlayerId ? { attackingPlayerId: stackItem.attackingPlayerId } : null),
      ...(typeof stackItem.damageAmount === 'number' ? { damageAmount: stackItem.damageAmount } : null),
      ...(Array.isArray(stackItem.damageSourcePermanentIds) ? { damageSourcePermanentIds: stackItem.damageSourcePermanentIds } : null),
      ...(typeof stackItem.damageIncludedWarriorSource === 'boolean' ? { damageIncludedWarriorSource: stackItem.damageIncludedWarriorSource } : null),
      ...(stackItem.effectData && typeof stackItem.effectData === 'object' ? { effectData: stackItem.effectData } : null),
      ...(stackItem.card && typeof stackItem.card === 'object' ? { card: stackItem.card } : null),
    });
  } catch (err) {
    debugWarn(1, `${ts()} [dealCombatDamage] Failed to persist ${reason} trigger:`, err);
  }
}

export interface CombatDamageTriggerQueueEntry {
  stackItem: any;
  reason: string;
}

function orderCombatDamageTriggerQueueEntries(
  ctx: GameContext,
  entries: CombatDamageTriggerQueueEntry[]
): CombatDamageTriggerQueueEntry[] {
  const sortableEntries = entries.map((entry) => ({
    controllerId: String(entry.stackItem?.controller || '').trim(),
    entry,
  }));

  return orderTriggersByAPNAP(ctx, sortableEntries).map((orderedEntry) => orderedEntry.entry);
}

export function pushCombatDamageTriggerQueueEntries(
  ctx: GameContext,
  entries: CombatDamageTriggerQueueEntry[]
): void {
  if (entries.length === 0) return;

  const state = (ctx as any).state;
  state.stack = Array.isArray(state.stack) ? state.stack : [];

  for (const entry of orderCombatDamageTriggerQueueEntries(ctx, entries)) {
    state.stack.push(entry.stackItem);
    persistCombatDamageTriggeredAbility(ctx, entry.stackItem, entry.reason);
    debug(2, `${ts()} [dealCombatDamage] Pushed ${entry.reason} trigger onto stack: ${entry.stackItem?.sourceName || 'Unknown'} - ${entry.stackItem?.description || ''}`);
  }
}
