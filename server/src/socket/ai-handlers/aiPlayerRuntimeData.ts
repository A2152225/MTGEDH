/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: getPersistedAIPlayerRuntimeData — reads persisted isAI player
 * fields (difficulty/name) so pregame deck load and runtime rehydrate share one helper.
 *
 * Public entry symbols: getPersistedAIPlayerRuntimeData.
 */

import type { PlayerID } from "../../../../shared/src/types.js";
import { ensureGame } from "../util.js";

export function getPersistedAIPlayerRuntimeData(gameId: string, playerId: PlayerID): {
  game: any;
  playerInState: any;
  difficulty: number;
  name: string;
} | null {
  const game = ensureGame(gameId);
  const playerInState = (game?.state?.players || []).find((p: any) => p?.id === playerId) as any;
  if (!playerInState || playerInState.isAI !== true) {
    return null;
  }

  const difficulty = Number.isFinite(Number(playerInState.difficulty))
    ? Number(playerInState.difficulty)
    : Number.isFinite(Number(playerInState.aiDifficulty))
      ? Number(playerInState.aiDifficulty)
      : 0.5;

  return {
    game,
    playerInState,
    difficulty,
    name: String(playerInState.name || playerId),
  };
}
