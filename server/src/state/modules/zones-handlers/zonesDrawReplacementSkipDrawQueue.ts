// server/src/state/modules/zones-handlers/zonesDrawReplacementSkipDrawQueue.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: queueSkipDrawReplacementStep.
// Public entry symbols: queueSkipDrawReplacementStep.

import type { PlayerID } from "../../../../../shared/src/types.js";
import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";

export function queueSkipDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const keywords = Array.isArray(metadata?.exceptKeywords)
    ? metadata.exceptKeywords.map((keyword: unknown) => String(keyword || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (keywords.length === 0) return false;

  const sourceName = String(metadata?.sourceName || 'Skip this draw').trim() || 'Skip this draw';
  const sourcePermanentId = String(metadata?.sourcePermanentId || 'skip-draw').trim() || 'skip-draw';
  const keywordLabel = keywords.join(' and/or ');

  ResolutionQueueManager.addStep(gameId, {
    id: uid('skip_draw_choice'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    sourceId: sourcePermanentId,
    sourceName,
    description: `Skip this draw? If you do, until your next turn you can't be attacked except by creatures with ${keywordLabel}.`,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    skipDrawReplacementChoice: true,
    remainingDrawCountAfterChoice,
    exceptKeywords: keywords,
    skipDrawSourcePermanentId: sourcePermanentId,
    skipDrawSourceName: sourceName,
    options: [
      { id: 'draw', label: 'Draw a card' },
      {
        id: 'skip_draw',
        label: 'Skip this draw',
        description: `Until your next turn, you can't be attacked except by creatures with ${keywordLabel}.`,
      },
    ],
  } as any);
  return true;
}
