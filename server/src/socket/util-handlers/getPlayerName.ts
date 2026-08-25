// server/src/socket/util-handlers/getPlayerName.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: getPlayerName.
// Public entry symbols: getPlayerName.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import type { PlayerID } from "../../../../shared/src/index.js";

/**
 * Get player name from player ID.
 * Falls back to the ID if name is not found.
 */
export function getPlayerName(game: any, playerId: PlayerID): string {
  if (!game || !playerId) return playerId || 'Unknown';
  try {
    const players = game.state?.players || [];
    const player = players.find((p: any) => p?.id === playerId);
    return player?.name || playerId;
  } catch (e) {
    return playerId || 'Unknown';
  }
}
