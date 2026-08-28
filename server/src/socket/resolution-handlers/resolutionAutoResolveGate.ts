/**
 * socket/resolution-handlers/resolutionAutoResolveGate.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep).
 * Cluster moved: the isAI gate that decides whether STEP_ADDED auto-answers
 * a resolution prompt.
 * Public entry symbols: shouldAutoResolveResolutionStep.
 *
 * Must not import resolution.ts.
 */

import type { PlayerID } from "../../../../shared/src/types.js";

/**
 * True when this seat should auto-answer a resolution prompt immediately
 * (STEP_ADDED): AI players only.
 *
 * Humans keep a fresh choice clock when Kynaios / Join Forces / Tempting Offer
 * are queued, even if they have Smart Pass on and have been idle since their
 * last priority. AFK seats are auto-answered when that per-step timeout fires.
 */
export function shouldAutoResolveResolutionStep(game: any, playerId: PlayerID | string | undefined): boolean {
  const pid = String(playerId || '').trim();
  if (!pid) return false;

  const players = Array.isArray(game?.state?.players) ? game.state.players : [];
  const player = players.find((entry: any) => String(entry?.id || '') === pid);
  return player?.isAI === true;
}
