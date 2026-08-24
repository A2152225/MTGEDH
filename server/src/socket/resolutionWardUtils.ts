/**
 * socket/resolutionWardUtils.ts
 *
 * Ward payment counter helpers shared by discard / payment / target flows.
 * Extracted from resolution.ts so discard-response modules can move cleanly.
 */

import type { Server } from "socket.io";
import type { GameContext } from "../state/context.js";
import { counterStackItem } from "../state/modules/stack-mechanics.js";
import { ResolutionQueueManager } from "../state/resolution/index.js";
import { getPlayerName } from "./util.js";

export function resolveWardCasterForTargetSelection(
  game: any,
  sourceId: string,
  fallbackPlayerId: string,
): { casterId: string; stackItem: any } | null {
  const pendingCast = (game?.state as any)?.pendingSpellCasts?.[sourceId];
  const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
  const stackItem = stack.find((item: any) => item && item.id === sourceId);
  if (!stackItem && !pendingCast) return null;
  const casterId = String(
    stackItem?.controller || pendingCast?.playerId || pendingCast?.controller || fallbackPlayerId || '',
  );
  if (!casterId) return null;
  return { casterId, stackItem };
}

export function getWardTargetName(game: any, triggeredBy: string): string {
  const stackItem = (game.state?.stack || []).find((entry: any) => entry && String(entry.id || '') === String(triggeredBy || ''));
  if (stackItem) {
    return String(stackItem.card?.name || stackItem.sourceName || stackItem.description || 'The spell or ability');
  }

  const pendingCast = (game.state as any)?.pendingSpellCasts?.[triggeredBy];
  if (pendingCast) {
    return String(pendingCast.cardName || pendingCast.card?.name || 'The spell');
  }

  return 'The spell or ability';
}

export function clearResolutionStepsForEffect(gameId: string, effectId: string): void {
  const normalized = String(effectId || '').trim();
  if (!normalized) return;

  const queue = ResolutionQueueManager.getQueue(gameId);
  queue.steps = queue.steps.filter((step: any) => {
    const effectRef = String(step?.effectId || '').trim();
    const sourceRef = String(step?.sourceId || '').trim();
    const wardRef = String(step?.wardTriggeredBy || '').trim();
    return effectRef !== normalized && sourceRef !== normalized && wardRef !== normalized;
  });
}

export function canPendingSpellBeCountered(pendingCast: any): boolean {
  if (!pendingCast) return true;
  if (pendingCast?.canBeCountered === false) return false;
  if (pendingCast?.card?.canBeCountered === false) return false;

  const oracleText = String(pendingCast?.card?.oracle_text || pendingCast?.oracleText || '')
    .replace(/\u2019/g, "'")
    .toLowerCase();
  return !oracleText.includes("can't be countered");
}

export function tryCounterByWard(game: any, gameId: string, triggeredBy: string, wardController: string): { countered: boolean; targetName: string; reason?: string } {
  const normalized = String(triggeredBy || '').trim();
  const targetName = getWardTargetName(game, normalized);

  if (!normalized) {
    return { countered: false, targetName, reason: 'Missing triggered object' };
  }

  const stackItem = (game.state?.stack || []).find((entry: any) => entry && String(entry.id || '') === normalized);
  if (stackItem) {
    const ctx = {
      state: game.state,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      zones: game.state?.zones,
      gameId,
    } as unknown as GameContext;
    const result = counterStackItem(ctx, normalized, wardController);
    return {
      countered: result.success === true,
      targetName,
      reason: result.reason,
    };
  }

  const pendingCast = (game.state as any)?.pendingSpellCasts?.[normalized];
  if (pendingCast) {
    if (!canPendingSpellBeCountered(pendingCast)) {
      return {
        countered: false,
        targetName,
        reason: "This spell or ability can't be countered",
      };
    }

    delete (game.state as any).pendingSpellCasts[normalized];
    if ((game.state as any)?.pendingTargets?.[normalized]) {
      delete (game.state as any).pendingTargets[normalized];
    }
    clearResolutionStepsForEffect(gameId, normalized);
    return { countered: true, targetName };
  }

  return { countered: false, targetName, reason: 'Stack item not found' };
}

export function emitWardCounterOutcome(
  io: Server,
  game: any,
  gameId: string,
  wardName: string,
  playerId: string,
  outcome: { countered: boolean; targetName: string; reason?: string },
  failureText: string
): void {
  const actor = getPlayerName(game, playerId);
  const message = outcome.countered
    ? `${wardName}: ${actor} ${failureText} and ${outcome.targetName} was countered.`
    : outcome.reason === "This spell or ability can't be countered"
      ? `${wardName}: ${actor} ${failureText}, but ${outcome.targetName} can't be countered.`
      : `${wardName}: ${actor} ${failureText}, but ${outcome.targetName} wasn't countered.`;

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message,
    ts: Date.now(),
  });
}
