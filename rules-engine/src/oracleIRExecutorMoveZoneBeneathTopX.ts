// Origin parent: oracleIRExecutorMoveZoneStepHandlers.ts
// Cluster: move_zone into owner's library "just beneath the top X cards",
// where X is a die result / reference amount (Underdark Rift family).
// Public entry symbol: tryApplyMoveZoneBeneathTopX.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveZoneCardIdFromPermanent } from './oracleIRExecutorBattlefieldOps';
import { getControllerId, getTargetObjectId } from './oracleIRExecutorMoveZoneReferenceResolvers';
import { buildAppliedResult } from './oracleIRExecutorMoveZoneStepResultBuilders';
import type { MoveZoneStepHandlerResult } from './oracleIRExecutorMoveZoneStepTypes';
import { writePlayerZoneCards } from './oracleIRExecutorPlayerZoneAccess.js';

function isBeneathTopXLibraryDestination(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
): boolean {
  if (step.to !== 'library') return false;
  const combined = `${String((step as { toRaw?: string }).toRaw || '')} ${String(step.raw || '')}`.toLowerCase();
  return /(?:just\s+)?beneath the top\b/.test(combined);
}

function resolveBeneathTopCount(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): number | null {
  const combined = `${String((step as { toRaw?: string }).toRaw || '')} ${String(step.raw || '')}`;
  const literal = combined.match(/beneath the top\s+(\d+)\s+cards?\b/i);
  if (literal) {
    const n = Number.parseInt(String(literal[1] || ''), 10);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }
  if (/beneath the top\s+x\s+cards?\b/i.test(combined) || /where x is the result/i.test(combined)) {
    const candidates = [
      (ctx as any).dieRollResult,
      ctx.referenceAmount,
      ctx.xValue,
      (ctx as any).lastReferenceAmount,
      (state as any)?.lastDieRoll?.result,
      (ctx.selectorContext as any)?.dieRollResult,
      ctx.selectorContext?.referenceAmount,
      ctx.selectorContext?.xValue,
    ];
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
    }
  }
  return null;
}

export function tryApplyMoveZoneBeneathTopX(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ctx: OracleIRExecutionContext,
): MoveZoneStepHandlerResult | undefined {
  if (!isBeneathTopXLibraryDestination(step)) return undefined;

  const depth = resolveBeneathTopCount(state, step, ctx);
  if (depth === null) return undefined;

  const targetId = String(getTargetObjectId(ctx) || '').trim();
  if (!targetId) return undefined;

  const battlefield = [...((state.battlefield || []) as any[])];
  const permanentIndex = battlefield.findIndex(
    (perm: any) => String(perm?.id || '').trim() === targetId,
  );
  if (permanentIndex < 0) return undefined;

  const permanent = battlefield[permanentIndex];
  const kept = battlefield.filter((_, index) => index !== permanentIndex);

  if ((permanent as any)?.isToken) {
    return buildAppliedResult({
      state: { ...(state as any), battlefield: kept } as GameState,
      log: [`Token ${String(permanent?.card?.name || permanent?.id || 'permanent')} left the battlefield`],
      movedCards: [],
      toZone: 'library',
    }, ctx);
  }

  const ownerId = String(
    permanent?.owner
    || permanent?.ownerId
    || permanent?.card?.owner
    || permanent?.controller
    || getControllerId(ctx),
  ).trim() as PlayerID;
  if (!ownerId) return undefined;

  const card = {
    ...((permanent as any)?.card || {}),
    id: String((permanent as any)?.id || '').trim() || resolveZoneCardIdFromPermanent(permanent),
    name: String((permanent as any)?.card?.name || (permanent as any)?.name || '').trim(),
    owner: ownerId,
    ownerId,
    zone: 'library',
  };

  const players = (state.players || []).map((entry: any) => ({ ...entry }));
  const ownerPlayer = players.find((entry: any) => String(entry?.id || '').trim() === ownerId) || {
    id: ownerId,
  };
  const priorLibrary = Array.isArray(ownerPlayer.library)
    ? [...ownerPlayer.library]
    : Array.isArray((state as any)?.zones?.[ownerId]?.library)
      ? [...(state as any).zones[ownerId].library]
      : [];
  const insertAt = Math.min(Math.max(0, depth), priorLibrary.length);
  const library = [...priorLibrary];
  library.splice(insertAt, 0, card);

  const nextState = {
    ...(state as any),
    battlefield: kept,
    players,
  } as GameState;
  writePlayerZoneCards(nextState, ownerId, ownerPlayer, 'library', library);

  return buildAppliedResult({
    state: nextState,
    log: [
      `Put ${card.name || card.id || 'permanent'} into ${ownerId}'s library just beneath the top ${depth} card(s)`,
    ],
    movedCards: [card],
    toZone: 'library',
  }, ctx);
}
