/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: snapshotAIAbilityActivationState (short snapshot helper
 * only — mana/payment helpers live in aiManaActivationHelpers.ts).
 *
 * Public entry symbols: snapshotAIAbilityActivationState.
 */
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { getOrInitManaPool } from "../util.js";
import type { AIAbilityActivationSnapshot } from "./aiAbilityActivationTypes.js";

export function snapshotAIAbilityActivationState(
  game: any,
  gameId: string,
  playerId: PlayerID,
  permanentId: string,
): AIAbilityActivationSnapshot {
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
  const zones = game.state?.zones?.[playerId] || {};
  const manaPool = getOrInitManaPool(game.state, String(playerId));

  return {
    stackLength: Array.isArray(game.state?.stack) ? game.state.stack.length : 0,
    pendingSteps: ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any).length,
    manaPoolKey: JSON.stringify(manaPool || {}),
    lifeTotal: Number((game.state as any)?.life?.[playerId] ?? game.state?.startingLife ?? 40),
    battlefieldCount: battlefield.length,
    graveyardCount: Array.isArray(zones?.graveyard) ? zones.graveyard.length : 0,
    handCount: Array.isArray(zones?.hand) ? zones.hand.length : 0,
    exileCount: Array.isArray(zones?.exile) ? zones.exile.length : 0,
    permanentExists: Boolean(permanent),
    permanentTapped: Boolean(permanent?.tapped),
  };
}
