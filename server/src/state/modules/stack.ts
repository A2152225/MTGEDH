import type { PlayerID } from "../types";
import type { GameContext } from "../context";
import { uid, parsePT } from "../utils";

/**
 * Stack / resolution helpers (extracted).
 */

export function pushStack(
  ctx: GameContext,
  item: {
    id: string;
    controller: PlayerID;
    card: any;
    targets?: string[];
  }
) {
  const { state } = ctx;
  state.stack = state.stack || [];
  state.stack.push(item as any);
  ctx.bumpSeq();
}

export function resolveTopOfStack(ctx: GameContext) {
  const s = ctx.state;
  if (!s.stack || s.stack.length === 0) return;
  const item = s.stack.pop()!;
  // Simplified resolution placeholder: real engine will inspect item.card.spec
  ctx.bumpSeq();
}

export function playLand(ctx: GameContext, playerId: PlayerID, card: any) {
  const { state, bumpSeq } = ctx;
  const tl = (card.type_line || "").toLowerCase();
  const isCreature = /\bcreature\b/.test(tl);
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  state.battlefield = state.battlefield || [];
  state.battlefield.push({
    id: uid("perm"),
    controller: playerId,
    owner: playerId,
    tapped: false,
    counters: {},
    basePower: baseP,
    baseToughness: baseT,
    card: { ...card, zone: "battlefield" },
  } as any);
  state.landsPlayedThisTurn = state.landsPlayedThisTurn || {};
  state.landsPlayedThisTurn[playerId] = (state.landsPlayedThisTurn[playerId] ?? 0) + 1;
  bumpSeq();
}