// server/src/state/modules/zones-handlers/zonesDrawReplacementDredgeQueue.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: queueDredgeDrawReplacementStep.
// Public entry symbols: queueDredgeDrawReplacementStep.

import type { PlayerID } from "../../../../../shared/src/types.js";
import type { GameContext } from "../../context.js";
import { uid } from "../../utils.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";

export function queueDredgeDrawReplacementStep(
  ctx: GameContext,
  playerId: string,
  metadata: any,
  drawIndex: number,
  remainingDrawCountAfterChoice: number,
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;

  const dredgeOptions = Array.isArray(metadata?.dredgeOptions) ? metadata.dredgeOptions : [];
  if (dredgeOptions.length === 0) return false;

  const firstOption = dredgeOptions[0] || {};
  ResolutionQueueManager.addStep(gameId, {
    id: uid('dredge_choice'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    sourceId: String(firstOption.cardId || 'dredge'),
    sourceName: String(firstOption.cardName || 'Dredge'),
    description: 'Replace this draw with dredge?',
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    dredgeDrawReplacementChoice: true,
    drawIndex,
    remainingDrawCountAfterChoice,
    dredgeOptions: dredgeOptions.map((option: any) => ({
      cardId: String(option?.cardId || '').trim(),
      cardName: String(option?.cardName || 'Dredge card').trim() || 'Dredge card',
      dredge: Math.max(0, Math.floor(Number(option?.dredge || 0))),
    })).filter((option: any) => option.cardId && option.dredge > 0),
    options: [
      { id: 'draw', label: 'Draw a card' },
      ...dredgeOptions
        .map((option: any) => {
          const cardId = String(option?.cardId || '').trim();
          const cardName = String(option?.cardName || 'Dredge card').trim() || 'Dredge card';
          const dredge = Math.max(0, Math.floor(Number(option?.dredge || 0)));
          if (!cardId || dredge <= 0) return null;
          return {
            id: `dredge:${cardId}`,
            label: `${cardName} - Dredge ${dredge}`,
            description: `Mill ${dredge} cards, then return ${cardName} from your graveyard to your hand.`,
          };
        })
        .filter(Boolean),
    ],
  } as any);
  return true;
}

