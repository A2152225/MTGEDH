// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyCantActivateAbilitiesStep.
// Public entry: applyCantActivateAbilitiesStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { resolveAttachedStaticAbilityGrantTargets } from './oracleIRExecutorBattlefieldAttachedGrantTargets';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function applyCantActivateAbilitiesStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'cant_activate_abilities' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const duration = step.duration as 'end_of_turn' | 'static' | 'until_next_turn';
  if (duration && duration !== 'end_of_turn' && duration !== 'static' && duration !== 'until_next_turn') {
    return {
      applied: false,
      message: `Skipped cant_activate_abilities static restriction (continuous text handled elsewhere): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const targetTextLower = String((effectiveTarget as any)?.text || step.raw || '').trim().toLowerCase();
  if (/until your next turn, target creature can't attack or block and its activated abilities can't be activated/i.test(String(step.raw || ''))) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const target = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (!target) {
      return { applied: true, state, log: ['No target creature for Edifice compound restriction'] };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [target], ctx, {
      descriptions: ["can't attack", "can't block", "activated abilities can't be activated"],
      expiresAt: 'leaves_battlefield',
      ...(ctx.controllerId ? { expiresOnControllerTurn: ctx.controllerId } : {}),
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied attack/block/activate restriction to ${String((target as any)?.id || '').trim()}`],
    };
  }
  if (/until your next turn, up to one target creature gets -3\/-0 and its activated abilities can't be activated/i.test(String(step.raw || ''))) {
    const boundIds = collectBoundBattlefieldIds(ctx);
    const target = battlefield.find((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
    if (!target) {
      return {
        applied: false,
        message: `Skipped cant_activate_abilities (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const nextState = applyTemporaryEffectToPermanents(state, [target], ctx, {
      descriptions: ["activated abilities can't be activated"],
      expiresAt: 'leaves_battlefield',
      ...(ctx.controllerId ? { expiresOnControllerTurn: ctx.controllerId } : {}),
    });
    return {
      applied: true,
      state: nextState,
      log: [`Applied can't-activate to ${String((target as any)?.id || '').trim()}`],
    };
  }

  if (/^those permanents$/i.test(targetTextLower) || /^until your next turn,\s*those permanents/i.test(String(step.raw || ''))) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const wantedIds = new Set([...contextualIds, ...antecedentIds]);
    const thoseTargets = battlefield.filter((perm: any) => wantedIds.has(String((perm as any)?.id || '').trim()));
    if (thoseTargets.length > 0) {
      const nextState = applyTemporaryEffectToPermanents(state, thoseTargets, ctx, {
        descriptions: ["activated abilities can't be activated"],
        expiresAt: duration === 'until_next_turn' ? 'leaves_battlefield' : 'end_of_turn',
        ...(duration === 'until_next_turn' && ctx.controllerId
          ? { expiresOnControllerTurn: ctx.controllerId }
          : {}),
      });
      return {
        applied: true,
        state: nextState,
        log: [`Applied activated-ability lock to ${thoseTargets.length} permanent(s)`],
      };
    }
  }

  const attachedTargets = resolveAttachedStaticAbilityGrantTargets(battlefield, effectiveTarget as any, ctx);
  const targets =
    attachedTargets.length > 0
      ? attachedTargets
      : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped cant_activate_abilities (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped cant_activate_abilities (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["activated abilities can't be activated"],
    expiresAt:
      duration === 'end_of_turn'
        ? 'end_of_turn'
        : duration === 'until_next_turn'
          ? 'leaves_battlefield'
          : 'leaves_battlefield',
    ...(duration === 'until_next_turn' && ctx.controllerId
      ? { expiresOnControllerTurn: ctx.controllerId }
      : {}),
  });

  return {
    applied: true,
    state: nextState,
    log: [`Applied activated-ability lock to ${targets.length} permanent(s)`],
  };
}

