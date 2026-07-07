import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { getNextEndStepFireTurnNumber } from './triggerDelayedEffectUtils.js';

export function spellWasCastWithWarpPaid(stackItem?: any, card?: any): boolean {
  const alt = String(stackItem?.alternateCostId || card?.alternateCostId || '').toLowerCase().trim();
  if (alt === 'warp') return true;
  return stackItem?.warpCostWasPaid === true || card?.warpCostWasPaid === true;
}

export function scheduleWarpDelayedExileOnPermanentEntry(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  sourceName: string,
  stackItem?: any,
): void {
  if (!permanent?.id) return;

  const card = permanent?.card || {};
  const oracleText = String(card?.oracle_text || '');
  if (!/\bwarp\b/i.test(oracleText)) return;
  if (!spellWasCastWithWarpPaid(stackItem, card)) return;

  const stateAny = (ctx as any).state as any;
  stateAny.pendingExileAtNextEndStep = Array.isArray(stateAny.pendingExileAtNextEndStep)
    ? stateAny.pendingExileAtNextEndStep
    : [];

  const permanentId = String(permanent.id || '').trim();
  const fireAtTurnNumber = getNextEndStepFireTurnNumber(stateAny);
  const pendingExileAtNextEndStep = stateAny.pendingExileAtNextEndStep as any[];
  if (!pendingExileAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === permanentId)) {
    pendingExileAtNextEndStep.push({
      permanentId,
      fireAtTurnNumber,
      sourceName: String(sourceName || card?.name || 'Warp'),
      createdBy: String(controller || permanent?.controller || permanent?.owner || ''),
      delayedWarpExile: true,
    });
  }

  permanent.warpCostWasPaid = true;
  permanent.wasWarpCast = true;
  permanent.card = {
    ...(permanent.card || {}),
    warpCostWasPaid: true,
    wasWarpCast: true,
  };
}

export function buildWarpedExileCardMarkers(
  ownerId: string,
  exiledOnTurn: number,
): Record<string, unknown> {
  return {
    isWarped: true,
    exiledBecauseWarped: true,
    warpedExiledOnTurn: exiledOnTurn,
    exiledOnTurn,
    ownerId,
    owner: ownerId,
    canBePlayedBy: ownerId,
    playableUntilTurn: Number.MAX_SAFE_INTEGER,
  };
}

export function canCastWarpedCardFromExile(card: any, playerId: PlayerID, currentTurn: number): boolean {
  if (!card || typeof card !== 'object') return false;

  const isWarped = (card as any).isWarped === true || (card as any).exiledBecauseWarped === true;
  if (!isWarped) return false;

  const ownerId = String((card as any).ownerId || (card as any).owner || '').trim();
  if (ownerId && ownerId !== String(playerId || '')) return false;

  const exiledOnTurn = Number((card as any).warpedExiledOnTurn ?? (card as any).exiledOnTurn ?? NaN);
  if (Number.isFinite(exiledOnTurn)) {
    return currentTurn > exiledOnTurn;
  }

  return true;
}

export function permanentShouldExileAsWarped(permanent: any): boolean {
  if (!permanent) return false;
  if (permanent.warpCostWasPaid === true || permanent.wasWarpCast === true) return true;
  const card = permanent.card || {};
  return card.warpCostWasPaid === true || card.wasWarpCast === true;
}
