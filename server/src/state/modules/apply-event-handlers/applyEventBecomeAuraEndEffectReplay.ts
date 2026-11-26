// server/src/state/modules/apply-event-handlers/applyEventBecomeAuraEndEffectReplay.ts
// Replay hook for endBecomeAuraEffect. Mana-producing events rebuild the pool on replay, so the cost is paid
// again the same recorded way (pool or sources) before the effect ends; see becomeAuraEndEffectAction.ts.

import type { GameContext } from '../context.js';
import {
  BECOME_AURA_END_EFFECT_EVENT,
  applyBecomeAuraEndEffect,
  type BecomeAuraEndEffectPayment,
} from '../becomeAuraEndEffectAction.js';

export function applyBecomeAuraEndEffectEvents(ctx: GameContext, event: unknown): boolean {
  const record = event && typeof event === 'object' ? (event as { type?: unknown; payload?: unknown }) : undefined;
  if (String(record?.type ?? '') !== BECOME_AURA_END_EFFECT_EVENT) return false;
  const payload = (record?.payload && typeof record.payload === 'object' ? record.payload : record) as {
    playerId?: unknown;
    permanentId?: unknown;
    payment?: Partial<BecomeAuraEndEffectPayment>;
  };
  applyBecomeAuraEndEffect(ctx, {
    playerId: String(payload?.playerId ?? '').trim(),
    permanentId: String(payload?.permanentId ?? '').trim(),
    replay: true,
    recordedPayment: payload?.payment && typeof payload.payment === 'object' ? payload.payment : undefined,
  });
  return true;
}
