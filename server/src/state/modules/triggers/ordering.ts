import type { GameContext } from '../../context.js';

export function orderTriggersByAPNAP<T extends { controllerId?: string }>(ctx: GameContext, triggers: T[]): T[] {
  const players = Array.isArray((ctx.state as any)?.players) ? (ctx.state as any).players : [];
  const turnOrder = players
    .map((player: any) => String(player?.id || '').trim())
    .filter(Boolean);
  if (turnOrder.length <= 1 || triggers.length <= 1) return triggers;

  const activePlayerId = String((ctx.state as any)?.activePlayer || (ctx.state as any)?.turnPlayer || turnOrder[0] || '').trim();
  const activeIndex = Math.max(0, turnOrder.indexOf(activePlayerId));
  const apnapOrder = [...turnOrder.slice(activeIndex), ...turnOrder.slice(0, activeIndex)];

  return triggers
    .map((trigger, originalIndex) => ({ trigger, originalIndex }))
    .sort((left, right) => {
      const leftIndex = apnapOrder.indexOf(String(left.trigger.controllerId || '').trim());
      const rightIndex = apnapOrder.indexOf(String(right.trigger.controllerId || '').trim());
      const leftOrder = leftIndex >= 0 ? leftIndex : apnapOrder.length;
      const rightOrder = rightIndex >= 0 ? rightIndex : apnapOrder.length;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.originalIndex - right.originalIndex;
    })
    .map((entry) => entry.trigger);
}
