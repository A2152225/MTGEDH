// server/src/state/modules/apply-event-handlers/applyEventUpkeepPaidUntapEvents.ts
// Replay of a paid upkeep untap (Magnetic Mountain: "pay {4} for each ... untap those creatures").
// Event upkeepPaidUntapResolve: { playerId, untapped[], tappedForMana[], sacrificedForMana[], paymentManaDelta }.
// paymentManaDelta is the net change to the payer's pool (floating mana spent is negative), so tapped
// sources are only re-tapped here: their mana was already netted into the delta.
// Public entry: applyUpkeepPaidUntapEvents(ctx, e) -> true when it handled the event.
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { getOrInitManaPool } from "../../../socket/util.js";
import { applyReplaySacrificedPermanent } from "../applyEventReplayCardMoveLibraryHelpers.js";
import { clearReplayQueuedSteps } from "../applyEventReplayZoneCommanderManaHelpers.js";

const POOL_KEYS = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
}

export function applyUpkeepPaidUntapEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
    case 'upkeepPaidUntapResolve': {
      const ev = e as any;
      const replayGameId = String((ctx as any).gameId || '').trim();
      const playerId = String(ev.playerId || '').trim();
      const resolvedStepId = String(ev.resolvedStepId || '').trim();
      // Drop the answered picker so a replayed game does not re-prompt.
      if (replayGameId) {
        clearReplayQueuedSteps(replayGameId, (step: any) => !!step && ((resolvedStepId !== '' && String(step.id || '') === resolvedStepId) || (step.upkeepPaidUntapSelection === true && String(step.playerId || '') === playerId)));
      }
      applyUpkeepPaidUntapResolve(ctx, ev);
      return true;
    }
    default:
      return false;
  }
}

function applyUpkeepPaidUntapResolve(ctx: GameContext, ev: any): void {
  const playerId = String(ev.playerId || '').trim();
  const bf: any[] = Array.isArray(ctx.state?.battlefield) ? (ctx.state as any).battlefield : [];
  const find = (id: string) => bf.find((x) => String(x?.id || '') === id);
  for (const id of ids(ev.tappedForMana)) { const perm = find(id); if (perm) perm.tapped = true; }
  for (const id of ids(ev.sacrificedForMana)) applyReplaySacrificedPermanent(ctx, id);
  const delta = ev.paymentManaDelta;
  if (playerId && delta && typeof delta === 'object' && !Array.isArray(delta)) {
    const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
    for (const key of POOL_KEYS) {
      const amount = Number(delta[key] || 0);
      if (Number.isFinite(amount) && amount !== 0) pool[key] = Math.max(0, Number(pool[key] || 0) + amount);
    }
  }
  for (const id of ids(ev.untapped)) { const perm = find(id); if (perm) perm.tapped = false; }
  if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
}
