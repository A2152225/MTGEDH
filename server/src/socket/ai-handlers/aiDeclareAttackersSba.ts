/**
 * Origin: aiPriorityHandlers.ts — DECLARE_ATTACKERS SBA preamble.
 * Cluster: run SBA before attack decisions; bail when seat/game is already over
 * after life-map desync fixes (704.5a).
 * Public: runDeclareAttackersSba, shouldBailDeclareAttackersAfterSba.
 */

import { runSBA } from "../../state/modules/counters_tokens.js";
import { hydrateGameStateOracleText } from "../../state/modules/cardOracleHydration.js";

export function runDeclareAttackersSba(game: any, gameId: string): void {
  const state = game?.state as any;
  // Keep state.life and player.life aligned before 704.5a so SBA sees the true total.
  if (state && typeof state === "object") {
    state.life = state.life || {};
    for (const player of Array.isArray(state.players) ? state.players : []) {
      if (!player?.id) continue;
      const id = String(player.id);
      const fromMap = state.life[id];
      const fromPlayer = player.life;
      const values = [fromMap, fromPlayer].filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      );
      if (!values.length) continue;
      const life = Math.min(...values);
      state.life[id] = life;
      player.life = life;
    }
  }
  const sbaCtx = {
    state: game.state,
    bumpSeq: () => {
      if (typeof (game as any).bumpSeq === "function") (game as any).bumpSeq();
    },
    gameId,
  } as any;
  runSBA(sbaCtx);
  hydrateGameStateOracleText(game.state, (game as any).libraries);
}

export function shouldBailDeclareAttackersAfterSba(
  game: any,
  playerId: string,
): boolean {
  const seat = (game.state as any)?.players?.find((p: any) => p && p.id === playerId);
  return Boolean(
    (game.state as any)?.gameOver || seat?.hasLost || seat?.eliminated,
  );
}
