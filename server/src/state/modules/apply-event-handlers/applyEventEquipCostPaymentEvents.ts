// server/src/state/modules/apply-event-handlers/applyEventEquipCostPaymentEvents.ts
// Replay of Equip non-mana cost payments (sacrifice / discard), persisted before the activateBattlefieldAbility event.
// Events: equipSacrificeCostPaid { playerId, permanentId, sacrificedId } and equipDiscardCostPaid { playerId, permanentId, cardId }.
// Public entry: applyEquipCostPaymentEvents(ctx, e) -> true when it handled the event. Triggers are not re-queued here
// (replayed trigger events are persisted separately), so this only moves the paid object.
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { sacrificePermanent } from "../upkeep-triggers.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../graveyardEntryUtils.js";

export function applyEquipCostPaymentEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
    case 'equipSacrificeCostPaid': {
      const ev = e as any;
      const playerId = String(ev.playerId || '').trim();
      const sacrificedId = String(ev.sacrificedId || '').trim();
      const bf: any[] = Array.isArray(ctx.state?.battlefield) ? (ctx.state as any).battlefield : [];
      if (playerId && sacrificedId && bf.some((p) => String(p?.id || '') === sacrificedId)) {
        sacrificePermanent(ctx, sacrificedId, playerId);
      }
      if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
      return true;
    }
    case 'equipDiscardCostPaid': {
      const ev = e as any;
      const playerId = String(ev.playerId || '').trim();
      const cardId = String(ev.cardId || '').trim();
      const zones = (ctx.state as any)?.zones?.[playerId];
      const hand: any[] = Array.isArray(zones?.hand) ? zones.hand : [];
      const idx = hand.findIndex((c: any) => String(c?.id || '') === cardId);
      if (zones && idx >= 0) {
        const [card] = hand.splice(idx, 1);
        zones.graveyard = Array.isArray(zones.graveyard) ? zones.graveyard : [];
        pushCardToPlayerGraveyardWithReplacements(ctx as any, playerId, card, zones.graveyard);
        zones.handCount = hand.length;
        zones.graveyardCount = zones.graveyard.length;
      }
      if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
      return true;
    }
    default:
      return false;
  }
}
