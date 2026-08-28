// server/src/state/modules/priorityEligibility.ts
// Origin parent: server/src/state/modules/priority.ts
// Cluster moved: who may receive priority (skip lost / eliminated / conceded /
//   spectators / inactive) plus reassignment when the current holder is out.
// Public entry symbols: playerCannotReceivePriority, getActivePriorityPlayers,
//   nextEligiblePriorityHolder, reassignPriorityIfHolderCannotReceive,
//   markPlayerOutOfPriority.
// Leaf must not import priority.ts or turn.ts.

import { debug } from "../../utils/debug.js";

export type PriorityEligibilityContext = {
  state?: any;
  inactive?: Set<string>;
};

/**
 * Players who have left the game do not receive priority (CR 104.5 / 800.4).
 * Also treat 0 life / 10 poison as out even if hasLost was not persisted on the
 * player object (common after event-log replay).
 */
export function playerCannotReceivePriority(player: any, ctx?: PriorityEligibilityContext): boolean {
  if (!player) return true;
  if (
    player.hasLost
    || player.eliminated
    || player.conceded
    || player.leftGame
    || player.spectator
    || player.isSpectator
  ) {
    return true;
  }
  const pid = String(player.id || '').trim();
  if (!pid) return true;
  const lifeRaw = ctx?.state?.life?.[pid] ?? player.life;
  const life = Number(lifeRaw);
  if (Number.isFinite(life) && life <= 0) return true;
  const poisonRaw =
    ctx?.state?.poisonCounters?.[pid]
    ?? ctx?.state?.poison?.[pid]
    ?? player.poisonCounters;
  const poison = Number(poisonRaw);
  if (Number.isFinite(poison) && poison >= 10) return true;
  return false;
}

function inactiveIds(ctx: PriorityEligibilityContext): Set<string> {
  return ctx.inactive instanceof Set ? ctx.inactive : new Set<string>();
}

export function getActivePriorityPlayers(ctx: PriorityEligibilityContext): Array<{ id: string; seat?: number }> {
  const players = Array.isArray(ctx.state?.players) ? ctx.state.players : [];
  const inactive = inactiveIds(ctx);
  return players
    .filter((p: any) => p?.id && !inactive.has(p.id) && !playerCannotReceivePriority(p, ctx))
    .sort((a: any, b: any) => (Number(a.seat) || 0) - (Number(b.seat) || 0));
}

/**
 * Next living player in APNAP / seat order after `from`.
 * If `from` is already out of the game, walk the full seat order after them.
 */
export function nextEligiblePriorityHolder(ctx: PriorityEligibilityContext, from: string): string {
  const active = getActivePriorityPlayers(ctx);
  const n = active.length;
  if (n === 0) return from;
  const step = ctx.state?.turnDirection === -1 ? -1 : 1;
  const idx = active.findIndex((p) => p.id === from);
  if (idx >= 0) {
    return active[(idx + step + n) % n].id;
  }
  const seated = (Array.isArray(ctx.state?.players) ? ctx.state.players : [])
    .filter((p: any) => p?.id)
    .sort((a: any, b: any) => (Number(a.seat) || 0) - (Number(b.seat) || 0));
  if (seated.length === 0) return active[0].id;
  const fromIdx = seated.findIndex((p: any) => p.id === from);
  const start = fromIdx >= 0 ? fromIdx : 0;
  const len = seated.length;
  for (let i = 1; i <= len; i++) {
    const candidate = seated[(start + i * step + len * 8) % len];
    if (active.some((p) => p.id === candidate.id)) return candidate.id;
  }
  return active[0].id;
}

/**
 * If the current priority holder cannot receive priority, move it to the next
 * living player. Returns true when priority changed.
 */
export function reassignPriorityIfHolderCannotReceive(ctx: PriorityEligibilityContext): boolean {
  const state = ctx.state as any;
  const holder = state?.priority;
  if (!holder) return false;
  const active = getActivePriorityPlayers(ctx);
  if (active.some((p) => p.id === holder)) return false;
  const next = nextEligiblePriorityHolder(ctx, holder);
  if (!next || next === holder) return false;
  if (!(state.priorityPassedBy instanceof Set)) {
    state.priorityPassedBy = new Set<string>();
  }
  state.priorityPassedBy.add(holder);
  state.priority = next;
  debug(1, `[priority] Skipping eliminated/inactive holder ${holder}; priority to ${next}`);
  return true;
}

/**
 * Mark a player as out of the priority circle and move priority if they hold it.
 */
export function markPlayerOutOfPriority(ctx: PriorityEligibilityContext, playerId: string): void {
  const id = String(playerId || '').trim();
  if (!id) return;
  if (!(ctx.inactive instanceof Set)) {
    (ctx as any).inactive = new Set<string>();
  }
  ctx.inactive!.add(id);
  reassignPriorityIfHolderCannotReceive(ctx);
}
