import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { getNextEndStepFireTurnNumber } from './triggerDelayedEffectUtils.js';

export function spellWasCastWithDashPaid(stackItem?: any, card?: any): boolean {
  const alt = String(stackItem?.alternateCostId || card?.alternateCostId || '').toLowerCase().trim();
  if (alt === 'dash') return true;
  return stackItem?.dashCostWasPaid === true || card?.dashCostWasPaid === true;
}

export function spellWasCastWithBlitzPaid(stackItem?: any, card?: any): boolean {
  const alt = String(stackItem?.alternateCostId || card?.alternateCostId || '').toLowerCase().trim();
  if (alt === 'blitz') return true;
  return stackItem?.blitzCostWasPaid === true || card?.blitzCostWasPaid === true;
}

function applyKeywordHasteToPermanent(permanent: any): void {
  if (!permanent) return;
  permanent.summoningSickness = false;
  permanent.temporaryAbilities = Array.isArray(permanent.temporaryAbilities)
    ? permanent.temporaryAbilities
    : [];
  const alreadyHasTemporaryHaste = permanent.temporaryAbilities.some((entry: any) =>
    String(entry?.ability || entry?.keyword || entry?.name || '').toLowerCase() === 'haste',
  );
  if (!alreadyHasTemporaryHaste) {
    permanent.temporaryAbilities.push({ ability: 'haste', expiresAt: 'end_of_turn' });
  }
  permanent.grantedAbilities = Array.isArray(permanent.grantedAbilities)
    ? permanent.grantedAbilities
    : [];
  if (!permanent.grantedAbilities.some((ability: any) => String(ability || '').toLowerCase() === 'haste')) {
    permanent.grantedAbilities.push('haste');
  }
  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card.dashCostWasPaid = permanent.dashCostWasPaid === true || permanent.card.dashCostWasPaid === true;
    permanent.card.blitzCostWasPaid = permanent.blitzCostWasPaid === true || permanent.card.blitzCostWasPaid === true;
  }
}

export function scheduleDashDelayedReturnOnPermanentEntry(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  sourceName: string,
  stackItem?: any,
): void {
  if (!permanent?.id) return;

  const card = permanent?.card || {};
  const oracleText = String(card?.oracle_text || '');
  if (!/\bdash\b/i.test(oracleText)) return;
  if (!spellWasCastWithDashPaid(stackItem, card)) return;

  const stateAny = (ctx as any).state as any;
  stateAny.pendingReturnToHandAtNextEndStep = Array.isArray(stateAny.pendingReturnToHandAtNextEndStep)
    ? stateAny.pendingReturnToHandAtNextEndStep
    : [];

  const permanentId = String(permanent.id || '').trim();
  const fireAtTurnNumber = getNextEndStepFireTurnNumber(stateAny);
  const pendingReturnToHandAtNextEndStep = stateAny.pendingReturnToHandAtNextEndStep as any[];
  if (!pendingReturnToHandAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === permanentId)) {
    pendingReturnToHandAtNextEndStep.push({
      permanentId,
      fireAtTurnNumber,
      sourceName: String(sourceName || card?.name || 'Dash'),
      createdBy: String(controller || permanent?.controller || permanent?.owner || ''),
      delayedDashReturn: true,
    });
  }

  permanent.dashCostWasPaid = true;
  permanent.wasDashCast = true;
  permanent.card = {
    ...(permanent.card || {}),
    dashCostWasPaid: true,
    wasDashCast: true,
  };
  applyKeywordHasteToPermanent(permanent);
}

export function scheduleBlitzDelayedSacrificeOnPermanentEntry(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  sourceName: string,
  stackItem?: any,
): void {
  if (!permanent?.id) return;

  const card = permanent?.card || {};
  const oracleText = String(card?.oracle_text || '');
  if (!/\bblitz\b/i.test(oracleText)) return;
  if (!spellWasCastWithBlitzPaid(stackItem, card)) return;

  const stateAny = (ctx as any).state as any;
  stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
    ? stateAny.pendingSacrificeAtNextEndStep
    : [];

  const permanentId = String(permanent.id || '').trim();
  const fireAtTurnNumber = getNextEndStepFireTurnNumber(stateAny);
  const pendingSacrificeAtNextEndStep = stateAny.pendingSacrificeAtNextEndStep as any[];
  if (!pendingSacrificeAtNextEndStep.some((entry: any) => String(entry?.permanentId || '') === permanentId)) {
    pendingSacrificeAtNextEndStep.push({
      permanentId,
      fireAtTurnNumber,
      sourceName: String(sourceName || card?.name || 'Blitz'),
      createdBy: String(controller || permanent?.controller || permanent?.owner || ''),
      delayedBlitzSacrifice: true,
    });
  }

  permanent.blitzCostWasPaid = true;
  permanent.wasBlitzCast = true;
  permanent.drawsCardOnBlitzDeath = true;
  permanent.card = {
    ...(permanent.card || {}),
    blitzCostWasPaid: true,
    wasBlitzCast: true,
    drawsCardOnBlitzDeath: true,
  };
  applyKeywordHasteToPermanent(permanent);
}

export function scheduleKeywordCastDelayedEffectsOnPermanentEntry(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  sourceName: string,
  stackItem?: any,
): void {
  scheduleDashDelayedReturnOnPermanentEntry(ctx, permanent, controller, sourceName, stackItem);
  scheduleBlitzDelayedSacrificeOnPermanentEntry(ctx, permanent, controller, sourceName, stackItem);
}
