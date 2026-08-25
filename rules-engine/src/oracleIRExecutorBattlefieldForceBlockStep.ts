// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyForceBlockStep.
// Public entry: applyForceBlockStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { resolveBoundSelectorMatches } from './oracleIRExecutorBattlefieldContextualResolvers';
import { buildAllAbleBlockerRequirementDescription } from './oracleIRExecutorBattlefieldForceBlockHelpers';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { trySpecialForceBlockStep } from './oracleIRExecutorSpecialTargetHandlers';

export function applyForceBlockStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'force_block' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialForceBlockStep(state, step, ctx);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const rawForceBlockMatch = String(step.raw || '').match(
    /^target creature an opponent controls blocks (that .+?) this combat if able$/i
  );
  const resolvedBlocker = rawForceBlockMatch
    ? ({ kind: 'raw', text: 'target creature an opponent controls' } as const)
    : (step.blocker as any);
  const resolvedAttacker = rawForceBlockMatch
    ? ({ kind: 'raw', text: String(rawForceBlockMatch[1] || '').trim() } as const)
    : (step.attacker as any);
  const blockerText = normalizeBattlefieldTargetReferenceText(String((resolvedBlocker as any)?.text || ''));
  const normalizedBlocker = { ...(resolvedBlocker as any), text: blockerText };
  const blockIfAbleOnly =
    /^target creature$/i.test(blockerText) &&
    /blocks this turn if able$/i.test(String(step.raw || ''));
  if (blockIfAbleOnly) {
    const selector = parseSimpleBattlefieldSelector(normalizedBlocker as any);
    const boundMatches = selector ? resolveBoundSelectorMatches(battlefield, selector, ctx) : [];
    const blockers =
      boundMatches.length > 0
        ? boundMatches.slice(0, 1)
        : resolveDirectBattlefieldPermanents(battlefield, normalizedBlocker as any, ctx);
    if (blockers.length === 1) {
      const nextState = applyTemporaryEffectToPermanents(state, blockers, ctx, {
        descriptions: ['blocks this turn if able'],
        expiresAt: 'end_of_turn',
      });
      return {
        applied: true,
        state: nextState,
        log: [`Marked ${String((blockers[0] as any)?.id || '').trim()} to block this turn if able`],
      };
    }
  }

  let attackers = resolveDirectBattlefieldPermanents(battlefield, resolvedAttacker as any, ctx);
  if (attackers.length !== 1 && /^that wolf$/i.test(String((resolvedAttacker as any)?.text || ''))) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (sourcePermanent && typeLineHasSubtype(sourcePermanent, 'wolf')) {
      attackers = [sourcePermanent];
    } else {
      const controllerId = String(ctx.controllerId || '').trim();
      const wolves = battlefield.filter(
        (perm: any) =>
          String((perm as any)?.controller || '').trim() === controllerId &&
          typeLineHasSubtype(perm, 'wolf')
      );
      if (wolves.length === 1) attackers = wolves;
    }
  }
  if (attackers.length !== 1) {
    return {
      applied: false,
      message: `Skipped force block (needs deterministic attacker): ${step.raw}`,
      reason: attackers.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
      options: attackers.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const allAbleBlockerDescription = buildAllAbleBlockerRequirementDescription(step.blocker as any);
  if (allAbleBlockerDescription) {
    const attackerId = String((attackers[0] as any)?.id || '').trim();
    if (!attackerId) {
      return {
        applied: false,
        message: `Skipped force block (invalid attacker): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }

    const nextState = applyTemporaryEffectToPermanents(state, attackers, ctx, {
      descriptions: [allAbleBlockerDescription],
      expiresAt: 'end_of_turn',
    });

    return {
      applied: true,
      state: nextState,
      log: [`Marked ${attackerId} as requiring all able blockers this turn`],
    };
  }

  const opponentBlockerMatch = /^target creature an opponent controls$/i.test(blockerText);
  const blockers = opponentBlockerMatch
    ? (() => {
        const boundIds = collectBoundBattlefieldIds(ctx);
        const matches = battlefield.filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!boundIds.includes(permanentId)) return false;
          if (!permanentMatchesType(perm, 'creature')) return false;
          const controllerId = String(ctx.controllerId || '').trim();
          return String((perm as any)?.controller || '').trim() !== controllerId;
        });
        return matches.length > 0 ? matches.slice(0, 1) : [];
      })()
    : resolveDirectBattlefieldPermanents(battlefield, normalizedBlocker as any, ctx);
  if (blockers.length !== 1) {
    return {
      applied: false,
      message: `Skipped force block (needs deterministic blocker): ${step.raw}`,
      reason: blockers.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
      options: blockers.length > 1 ? { classification: 'player_choice' } : undefined,
    };
  }

  const blockerId = String((blockers[0] as any)?.id || '').trim();
  const attackerId = String((attackers[0] as any)?.id || '').trim();
  if (!blockerId || !attackerId) {
    return {
      applied: false,
      message: `Skipped force block (invalid blocker or attacker): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const nextState = applyTemporaryEffectToPermanents(state, blockers, ctx, {
    descriptions: [`must block ${attackerId} if able`],
    expiresAt: 'end_of_turn',
    mustBlockAttackerId: attackerId,
  } as any);

  return {
    applied: true,
    state: nextState,
    log: [`Marked ${blockerId} to block ${attackerId} if able`],
  };
}

