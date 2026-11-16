// server/src/state/modules/zones-handlers/zonesDrawReplacementPursuitQueue.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster: queuePursuitDrawReplacementStep — optional "put a study counter
//   instead of drawing" (Pursuit of Knowledge). Reuses OPTION_CHOICE the same
//   way skip-draw does.
// Public entry symbols: queuePursuitDrawReplacementStep.
// Leaf must not import zones.ts or zones-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/types.js";
import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";

export function queuePursuitDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  metadata: Record<string, unknown> | undefined,
  remainingDrawCountAfterChoice: number,
): boolean {
  if ((ctx as any)._suppressPursuitDrawReplacement === true) return false;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const sourceName = String(metadata?.sourceName || 'Pursuit of Knowledge').trim() || 'Pursuit of Knowledge';
  const sourcePermanentId = String(metadata?.sourcePermanentId || metadata?.sourceId || 'pursuit-of-knowledge').trim() || 'pursuit-of-knowledge';
  const counterType = String(metadata?.putCounter || metadata?.counterType || 'study').trim() || 'study';

  ResolutionQueueManager.addStep(gameId, {
    id: uid('pursuit_draw_choice'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    sourceId: sourcePermanentId,
    sourceName,
    description: `${sourceName}: You may put a ${counterType} counter on it instead of drawing a card.`,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    pursuitDrawReplacementChoice: true,
    remainingDrawCountAfterChoice,
    pursuitCounterType: counterType,
    pursuitSourcePermanentId: sourcePermanentId,
    pursuitSourceName: sourceName,
    options: [
      { id: 'draw', label: 'Draw a card' },
      { id: 'put_counter', label: `Put a ${counterType} counter on ${sourceName} instead` },
    ],
  } as any);
  return true;
}
