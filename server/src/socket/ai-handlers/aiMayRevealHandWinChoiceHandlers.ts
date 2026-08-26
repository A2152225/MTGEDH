/**
 * Origin parent: server/src/socket/ai.ts
 * Cluster: OPTION_CHOICE Reveal/Decline for may-reveal-hand then win if the
 *   chooser owns a card with the source's current name in exile, hand,
 *   graveyard, and battlefield (Hedron Alignment family). Generic — uses
 *   source current name, not a card-name route.
 * Public: chooseAIMayRevealHandWinIfOwnNamedSelection
 * Leaf must not import ai.ts or ai-handlers/index.ts.
 */

import type { PlayerID } from "../../../../shared/src/types.js";
import { playerOwnsNamedCardInFourWinZones } from "../../../../rules-engine/src/oracleIRExecutorMayRevealHandWinIfOwnNamed.js";

export function chooseAIMayRevealHandWinIfOwnNamedSelection(
  game: any,
  playerId: PlayerID,
  step: any,
  options: any[],
  resolveOptionId: (option: any) => string,
): { selections: string[]; cancelled: boolean } {
  const offeredIds = options.map((option: any) => resolveOptionId(option));
  const revealId = offeredIds.includes('reveal') ? 'reveal' : offeredIds[0];
  const declineId = offeredIds.includes('decline')
    ? 'decline'
    : (offeredIds.includes('dont') ? 'dont' : (offeredIds[1] || offeredIds[0]));
  const sourceName = String(step?.oracleIrSourceName || step?.sourceName || '').trim();
  const shouldReveal = playerOwnsNamedCardInFourWinZones(game?.state, String(playerId || ''), sourceName);
  return { selections: [shouldReveal ? revealId : declineId], cancelled: false };
}
