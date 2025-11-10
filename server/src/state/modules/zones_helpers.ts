/**
 * Compatibility helper that ensures applyScry/applySurveil are available for the
 * state index wrapper. Some refactor variants put these helpers in different
 * modules (zones, replay, etc.). This module prefers zones, then replay, and
 * throws if neither provides the implementation to avoid silent failures.
 */
import type { PlayerID } from "../types";
import type { GameContext } from "../context";

import * as zones from "./zones";
import * as replay from "./replay";

export function applyScry(ctx: GameContext, playerId: PlayerID, keepTopOrder: string[], bottomOrder: string[]) {
  if (typeof (zones as any).applyScry === "function") return (zones as any).applyScry(ctx, playerId, keepTopOrder, bottomOrder);
  if (typeof (replay as any).applyScry === "function") return (replay as any).applyScry(ctx, playerId, keepTopOrder, bottomOrder);
  throw new Error("applyScry implementation not found in zones or replay modules");
}

export function applySurveil(ctx: GameContext, playerId: PlayerID, toGraveyard: string[], keepTopOrder: string[]) {
  if (typeof (zones as any).applySurveil === "function") return (zones as any).applySurveil(ctx, playerId, toGraveyard, keepTopOrder);
  if (typeof (replay as any).applySurveil === "function") return (replay as any).applySurveil(ctx, playerId, toGraveyard, keepTopOrder);
  throw new Error("applySurveil implementation not found in zones or replay modules");
}