// Origin parent: server/src/state/modules/zones.ts
// Cluster: apply opponent-library draw-replacement choice, then continue remaining draws.
// Public entry symbols: applyOpponentLibraryDrawReplacementChoice.
// Leaf must not import zones.ts or zones-handlers/index.ts.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { drawCards } from './zonesDrawCards.js';
import { exileTopOfOpponentLibraryFaceDown } from './zonesDrawReplacementOpponentLibraryExile.js';

export function applyOpponentLibraryDrawReplacementChoice(ctx: GameContext, event: {
  playerId: PlayerID | string;
  opponentId?: string;
  remainingDrawCountAfterChoice?: number;
  sourcePermanentId?: string;
  sourceName?: string;
}): { applied: boolean; exiledCard?: any } {
  const playerId = String(event?.playerId || '').trim();
  const opponentId = String(event?.opponentId || '').trim();
  if (!playerId || !opponentId) return { applied: false };

  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  const exiledCard = exileTopOfOpponentLibraryFaceDown(ctx, playerId, opponentId, {
    sourcePermanentId: event?.sourcePermanentId,
    sourceName: event?.sourceName,
  });

  if (remainingDrawCountAfterChoice > 0) {
    drawCards(ctx, playerId as PlayerID, remainingDrawCountAfterChoice, { skipEventPersistence: true });
  }

  return { applied: true, exiledCard };
}
