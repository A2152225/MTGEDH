import type { GameContext } from "../context.js";
import type { PlayerID } from "../../../../shared/src/index.js";

/**
 * Grant Telepathy-style hand visibility for a player controlling a hand-reveal effect.
 * 
 * When a player controls Telepathy (or similar effect), their opponents play with
 * their hands revealed. This means ALL opponents' hands are visible to EVERYONE
 * (not just the controller), since "playing with hands revealed" is a public state.
 * 
 * @param ctx - The game context
 * @param telepath - The player ID who controls the hand-reveal effect
 */
export function grantTelepathyForPlayer(ctx: GameContext, telepath: PlayerID) {
  const players = ctx.state.players as any[];
  const allPlayerIds = players.map(p => p.id as PlayerID);
  
  // For each opponent of the telepath, grant visibility to ALL players
  // (opponents "play with their hands revealed" = public information)
  for (const owner of allPlayerIds) {
    if (owner === telepath) continue; // Skip the telepath's own hand
    
    if (!ctx.handVisibilityGrants.has(owner)) {
      ctx.handVisibilityGrants.set(owner, new Set());
    }
    
    // Grant visibility of this opponent's hand to ALL players (including the telepath)
    for (const viewer of allPlayerIds) {
      ctx.handVisibilityGrants.get(owner)!.add(viewer);
    }
  }
}

export function revokeTelepathyForPlayer(ctx: GameContext, telepath: PlayerID) {
  for (const [owner, viewers] of ctx.handVisibilityGrants.entries()) {
    viewers.delete(telepath);
    if (!viewers.size) ctx.handVisibilityGrants.delete(owner);
  }
}