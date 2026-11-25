// server/src/state/modules/apply-event-handlers/applyEventGraveyardExileStackAbilityReplay.ts
// Replay for activateGraveyardAbility { abilityId: 'graveyard-exile-stack-ability' }:
// pay the recorded mana, move the card graveyard -> exile, and restore the stack item.
// Public entry symbols: replayGraveyardExileStackAbility.
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { recordCardLeftGraveyardThisTurn } from "../turn-tracking.js";
import { consumeRecordedManaCostFromPool } from "../applyEventReplayCardMoveLibraryHelpers.js";

export function replayGraveyardExileStackAbility(ctx: GameContext, e: GameEvent, cardId: any, pid: any): void {
  const zones: any = (ctx.state as any).zones || {};
  const z = zones[pid];
  if (z && Array.isArray(z.graveyard)) {
    const idx = (z.graveyard as any[]).findIndex((c: any) => c && String(c.id) === String(cardId));
    if (idx !== -1) {
      const [card] = (z.graveyard as any[]).splice(idx, 1);
      z.graveyardCount = z.graveyard.length;
      recordCardLeftGraveyardThisTurn(ctx as any, String(pid), card);
      z.exile = Array.isArray(z.exile) ? z.exile : [];
      z.exile.push({ ...card, zone: 'exile' });
      z.exileCount = z.exile.length;
    }
  }
  const manaCost = String((e as any).manaCost || '').trim();
  const manaPool = (ctx.state as any).manaPool?.[pid];
  if (manaPool && manaCost) consumeRecordedManaCostFromPool(manaPool, manaCost);
  const stackItem = (e as any).stackItem;
  if (stackItem && typeof stackItem === 'object') {
    const stack: any[] = Array.isArray((ctx.state as any).stack) ? (ctx.state as any).stack : ((ctx.state as any).stack = []);
    if (!stack.some((item: any) => item && String(item.id) === String(stackItem.id))) stack.push({ ...stackItem });
  }
}
