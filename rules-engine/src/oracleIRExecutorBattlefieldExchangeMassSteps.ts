/**
 * Origin parent: oracleIRExecutorBattlefieldExchangeAndCopySteps.ts
 * Cluster: mass set-swap for exchange_control ("you and that opponent each gain
 *   control of all creatures the other controls").
 * Public: tryApplyMassExchangeControlStep
 * Leaf must not import oracleIRExecutorBattlefieldExchangeAndCopySteps.ts.
 */

import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep, OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { allocateTimestamp } from './permanentTimestamps';

function isMassExchangeSelector(selector: OracleObjectSelector | undefined): boolean {
  if (!selector || selector.kind !== 'raw') return false;
  return /^(?:all|each)\s+/i.test(String(selector.text || '').trim());
}

function resolveMassOpponentId(
  ctx: OracleIRExecutionContext,
  youId: string,
  state?: GameState,
): string {
  const bound = String(
    ctx.selectorContext?.targetOpponentId
      || ctx.targetOpponentId
      || ctx.selectorContext?.targetPlayerId
      || ctx.targetPlayerId
      || '',
  ).trim();
  if (bound && bound !== youId) return bound;

  const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds
    : [];
  const playerIds = new Set(
    (Array.isArray(state?.players) ? state.players : [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean),
  );
  for (const chosenId of chosenIds) {
    const id = String(chosenId || '').trim();
    if (id && id !== youId && playerIds.has(id)) return id;
  }

  const others = [...playerIds].filter((id) => id !== youId);
  return others.length === 1 ? others[0] : '';
}

function stampUntilEndOfTurnControl(
  existingEffects: any[],
  permanentId: string,
  originalController: string,
  newController: string,
  ceTimestamp?: number,
): any[] {
  const remaining = existingEffects.filter(
    (effect) =>
      !(
        String(effect?.permanentId || '').trim() === permanentId
        && String(effect?.duration || '').trim() === 'until_end_of_turn'
      ),
  );
  const prior = existingEffects.find(
    (effect) =>
      String(effect?.permanentId || '').trim() === permanentId
      && String(effect?.duration || '').trim() === 'until_end_of_turn',
  );
  const stampedOriginal = String(prior?.originalController || originalController || '').trim() || originalController;
  remaining.push({
    permanentId,
    originalController: stampedOriginal as PlayerID,
    newController: newController as PlayerID,
    duration: 'until_end_of_turn',
    appliedAt: Date.now(),
    ...(ceTimestamp !== undefined ? { ceTimestamp } : {}),
  });
  return remaining;
}

export function tryApplyMassExchangeControlStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exchange_control' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  if (!isMassExchangeSelector(step.first) && !isMassExchangeSelector(step.second)) {
    return null;
  }

  const youId = String(ctx.controllerId || '').trim();
  const opponentId = resolveMassOpponentId(ctx, youId, state);
  if (!youId || !opponentId) {
    return {
      applied: false,
      message: `Skipped exchange-control (needs target opponent): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefieldView = (state.battlefield || []) as BattlefieldPermanent[];
  const firstMatches = resolveDirectBattlefieldPermanents(battlefieldView, step.first as any, ctx);
  const secondMatches = resolveDirectBattlefieldPermanents(battlefieldView, step.second as any, ctx);
  const firstIds = firstMatches
    .map((permanent) => String((permanent as any)?.id || '').trim())
    .filter(Boolean);
  const secondIds = secondMatches
    .map((permanent) => String((permanent as any)?.id || '').trim())
    .filter(Boolean);

  const firstSet = new Set(firstIds);
  const secondSet = new Set(secondIds);
  const swappedIds: string[] = [];
  const stampUntilEot = /until end of turn/i.test(String(step.raw || ''));
  let nextControlChangeEffects = Array.isArray((state as any).controlChangeEffects)
    ? [...((state as any).controlChangeEffects as any[])]
    : [];

  const battlefield = battlefieldView.map((permanent) => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!permanentId) return permanent;
    const inFirst = firstSet.has(permanentId);
    const inSecond = secondSet.has(permanentId);
    if (inFirst === inSecond) return permanent;

    const currentController = String((permanent as any)?.controller || '').trim();
    const newController = inFirst ? opponentId : youId;
    if (!currentController || currentController === newController) return permanent;

    swappedIds.push(permanentId);
    if (stampUntilEot) {
      nextControlChangeEffects = stampUntilEndOfTurnControl(
        nextControlChangeEffects,
        permanentId,
        currentController,
        newController,
        allocateTimestamp(state as any),
      );
    }

    return {
      ...permanent,
      controller: newController,
      summoningSickness: true,
      ...(stampUntilEot && !(permanent as any).controlBase ? { controlBase: currentController } : {}),
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield,
      ...(stampUntilEot ? { controlChangeEffects: nextControlChangeEffects } : {}),
    } as GameState,
    log: [`${swappedIds.length} creature(s) exchange control`],
    lastAntecedentBattlefieldPermanentIds: swappedIds,
  };
}
