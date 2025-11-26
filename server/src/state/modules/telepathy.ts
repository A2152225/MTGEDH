import type { GameContext } from "../context.js";
import type { PlayerID } from "../../../../shared/src/index.js";

export function grantTelepathyForPlayer(ctx: GameContext, telepath: PlayerID) {
  for (const p of ctx.state.players as any[]) {
    const owner = p.id as PlayerID;
    if (owner === telepath) continue;
    if (!ctx.handVisibilityGrants.has(owner)) {
      ctx.handVisibilityGrants.set(owner, new Set());
    }
    ctx.handVisibilityGrants.get(owner)!.add(telepath);
  }
}

export function revokeTelepathyForPlayer(ctx: GameContext, telepath: PlayerID) {
  for (const [owner, viewers] of ctx.handVisibilityGrants.entries()) {
    viewers.delete(telepath);
    if (!viewers.size) ctx.handVisibilityGrants.delete(owner);
  }
}