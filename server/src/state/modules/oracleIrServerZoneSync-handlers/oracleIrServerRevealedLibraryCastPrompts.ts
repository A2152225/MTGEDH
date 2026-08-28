// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerRevealedLibraryCastPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster: during-resolution "you may cast it without paying its mana cost" after
//   reveal_top (Descendants' Path / Unexpected Results family). The card is still
//   on top of the library, not in exile.
// Public entry symbol: queueRevealedLibraryCastPromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';

function isDuringResolutionLibraryMayCast(step: any): boolean {
  if (String(step?.kind || '') !== 'grant_exile_permission') return false;
  if (String(step?.duration || '') !== 'during_resolution') return false;
  if (String(step?.permission || 'cast').toLowerCase() !== 'cast') return false;
  const what = String(step?.what?.text || step?.what?.raw || '').trim().toLowerCase();
  return /^(?:it|that card)$/i.test(what);
}

function playerLibrary(state: any, playerId: string): any[] {
  const fromPlayer = (state?.players || []).find((player: any) => String(player?.id || '').trim() === playerId);
  if (Array.isArray(fromPlayer?.library) && fromPlayer.library.length > 0) return fromPlayer.library;
  const fromZones = state?.zones?.[playerId]?.library;
  return Array.isArray(fromZones) ? fromZones : [];
}

export function queueRevealedLibraryCastPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const pendingMayCast = (result.pendingOptionalSteps || []).some((step) => isDuringResolutionLibraryMayCast(step));
  const revealedTop = (result.appliedSteps || []).some((step) => step.kind === 'reveal_top');
  if (!pendingMayCast || !revealedTop) return;

  const controllerId = String(params.controller || '').trim();
  if (!controllerId) return;

  const library = playerLibrary(state, controllerId);
  const hitCard = library.length > 0 ? library[0] : null;
  const hitId = String(hitCard?.id || '').trim();
  if (!hitCard || !hitId) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const cardName = String(hitCard?.name || 'that card').trim() || 'that card';
  const queue = ResolutionQueueManager.getQueue(gameId);
  const alreadyQueued = queue.steps.some(
    (step: any) =>
      (step as any)?.castRevealedFromLibraryChoice === true &&
      String((step as any)?.castRevealedFromLibraryCard?.id || '').trim() === hitId,
  );
  if (alreadyQueued) return;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controllerId as any,
    description: `${sourceName}: You may cast ${cardName} without paying its mana cost.`,
    mandatory: false,
    sourceId,
    sourceName,
    options: [
      { id: 'cast', label: `Cast ${cardName}` },
      { id: 'decline', label: `Put ${cardName} on the bottom of your library` },
    ],
    minSelections: 1,
    maxSelections: 1,
    castRevealedFromLibraryChoice: true,
    castRevealedFromLibraryCard: hitCard,
    castRevealedFromLibraryOtherCards: [],
    castRevealedFromLibraryPlayerId: controllerId,
  } as any);
}
