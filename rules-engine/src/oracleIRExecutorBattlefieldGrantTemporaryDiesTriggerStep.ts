// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyGrantTemporaryDiesTriggerStep.
// Public entry: applyGrantTemporaryDiesTriggerStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import {
  inferGrantTemporaryAbilityTargetFromRaw,
  normalizeGrantTemporaryAbilityTargetText,
} from './oracleIRExecutorBattlefieldGrantTemporaryTargetText';
import {
  resolveDirectBattlefieldPermanents,
  resolveGrantTemporaryMassTargets,
} from './oracleIRExecutorBattlefieldPermanentSelectors';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import {
  DelayedTriggerTiming,
  createDelayedTrigger,
  createDelayedTriggerRegistry,
  registerDelayedTrigger,
} from './delayedTriggeredAbilities';

export function applyGrantTemporaryDiesTriggerStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_temporary_dies_trigger' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const normalizedTargetText = normalizeGrantTemporaryAbilityTargetText(
    String((step.target as any)?.text || inferGrantTemporaryAbilityTargetFromRaw(String(step.raw || '')) || ''),
    String(step.raw || '')
  );
  const targetText = normalizedTargetText.toLowerCase();
  const explicitTargetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  const massTargets = resolveGrantTemporaryMassTargets(
    battlefield,
    normalizedTargetText,
    String(step.raw || ''),
    ctx
  );
  let targets =
    explicitTargetId && /^target\b/.test(targetText)
      ? battlefield.filter((perm: any) => String(perm?.id || '').trim() === explicitTargetId)
      : massTargets && massTargets.length > 0
        ? massTargets
        : resolveDirectBattlefieldPermanents(
            battlefield,
            { kind: 'raw', text: normalizedTargetText },
            ctx
          );

  if (/^face-up nontoken creatures you control$/i.test(normalizedTargetText)) {
    targets = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== String(ctx.controllerId || '').trim()) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      if ((perm as any)?.isToken) return false;
      return Boolean((perm as any)?.faceUpCard) || !(perm as any)?.faceDown;
    });
  }

  if (/any number of target creatures you control/i.test(String(step.raw || '')) && targets.length === 0) {
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    targets = battlefield.filter((perm: any) => {
      const id = String(perm?.id || '').trim();
      if (!boundIds.has(id)) return false;
      if (String(perm?.controller || '').trim() !== String(ctx.controllerId || '').trim()) return false;
      return permanentMatchesType(perm, 'creature');
    });
  }

  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped temporary dies trigger grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targets.length > 1 && /^target\b/.test(targetText)) {
    return {
      applied: false,
      message: `Skipped temporary dies trigger grant (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  let registry = (state as any).delayedTriggerRegistry || createDelayedTriggerRegistry();
  const log: string[] = [];

  for (const target of targets) {
    const watchedPermanentId = String((target as any)?.id || '').trim();
    if (!watchedPermanentId) continue;
    const delayedTrigger = createDelayedTrigger(
      String(ctx.sourceId || ctx.sourceName || 'oracle-ir'),
      String(ctx.sourceName || 'Temporary granted dies trigger'),
      controllerId,
      DelayedTriggerTiming.WHEN_DIES,
      step.effect,
      currentTurn,
      {
        watchingPermanentId: watchedPermanentId,
        targets: [watchedPermanentId],
        effectData: {
          expireAtEndOfTurn: step.duration === 'until_end_of_turn',
          expireWhenPermanentLeavesBattlefield: true,
        },
        eventDataSnapshot: {
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceControllerId: String(controllerId || '').trim() || undefined,
          targetPermanentId: watchedPermanentId,
          chosenObjectIds: [watchedPermanentId],
        },
      }
    );
    registry = registerDelayedTrigger(registry, delayedTrigger);
    log.push(
      `Granted delayed dies trigger to ${watchedPermanentId}${
        step.duration === 'until_end_of_turn' ? ' until end of turn' : ''
      }`
    );
  }

  const effectText = String(step.effect || '').trim();
  const abilityText = effectText
    ? (/^when this creature dies\b/i.test(effectText)
      ? effectText
      : `when this creature dies, ${effectText}`)
    : '';
  const nextState = abilityText
    ? applyTemporaryEffectToPermanents(
        {
          ...(state as any),
          delayedTriggerRegistry: registry,
        } as GameState,
        targets,
        ctx,
        {
          descriptions: [abilityText],
          expiresAt: step.duration === 'until_end_of_turn' ? 'end_of_turn' : 'leaves_battlefield',
        }
      )
    : ({
        ...(state as any),
        delayedTriggerRegistry: registry,
      } as GameState);

  return {
    applied: true,
    state: nextState,
    log,
  };
}

