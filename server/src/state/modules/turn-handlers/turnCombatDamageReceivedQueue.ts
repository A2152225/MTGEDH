// server/src/state/modules/turn-handlers/turnCombatDamageReceivedQueue.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: queueDamageReceivedTrigger.
// Public entry symbols: queueDamageReceivedTrigger.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from "../triggers/damage-received.js";
import { debug } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

/**
 * Dispatch a damage-received trigger after a permanent is dealt damage.
 * This prefers direct Resolution Queue creation or immediate no-choice resolution,
 * and only falls back to pendingDamageTriggers when direct dispatch is unavailable.
 *
 * @param ctx Game context
 * @param permanent The permanent that was dealt damage
 * @param damageAmount Amount of damage dealt
 */
export function queueDamageReceivedTrigger(ctx: GameContext, permanent: any, damageAmount: number): void {
  if (!permanent || damageAmount <= 0) return;
  
  // Use the centralized damage trigger system
  processDamageReceivedTriggers(ctx, permanent, damageAmount, (triggerInfo) => {
    if (dispatchDamageReceivedTrigger(ctx, triggerInfo)) {
      return;
    }

    // Initialize pendingDamageTriggers if needed
    if (!(ctx as any).state.pendingDamageTriggers) {
      (ctx as any).state.pendingDamageTriggers = {};
    }
    
    // Add the trigger to the pending list
    (ctx as any).state.pendingDamageTriggers[triggerInfo.triggerId] = {
      sourceId: triggerInfo.sourceId,
      sourceName: triggerInfo.sourceName,
      controller: triggerInfo.controller,
      damageAmount: triggerInfo.damageAmount,
      triggerType: 'dealt_damage',
      targetType: triggerInfo.targetType,
      targetRestriction: triggerInfo.targetRestriction,
      effect: triggerInfo.effect,
      ...(triggerInfo.effectMode ? { effectMode: triggerInfo.effectMode } : {}),
      ...(triggerInfo.attackingPlayerId ? { attackingPlayerId: triggerInfo.attackingPlayerId } : {}),
    };
    
    debug(2, `${ts()} [queueDamageReceivedTrigger] Queued damage trigger: ${triggerInfo.sourceName} was dealt ${damageAmount} damage`);
  });
}
