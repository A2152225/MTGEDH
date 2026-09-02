// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyScheduleDelayedBattlefieldActionStep.
// Public entry: applyScheduleDelayedBattlefieldActionStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { registerDelayedBattlefieldAction } from './oracleIRExecutorBattlefieldDelayedActionHelpers';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { resolveRecentlyCreatedTokenPermanents } from './oracleIRExecutorBattlefieldRecentlyCreatedTokens';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { isNamedSelfSacrificeReference } from './oracleIRExecutorBattlefieldStackExileHelpers';
import {
  parseSacrificeWhat,
  resolveAttachmentReferencePermanents,
} from './oracleIRExecutorBattlefieldSacrificeWhat';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { trySpecialScheduleDelayedBattlefieldActionStep } from './oracleIRExecutorSpecialTargetHandlers';
import { DelayedTriggerTiming } from './delayedTriggeredAbilities';

function resolveDelayedDestroyFallbackPermanents(
  battlefield: readonly BattlefieldPermanent[],
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_battlefield_action' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldPermanent[] {
  const objectText = `${String((step.object as any)?.text || '')} ${String(step.raw || '')}`;
  const sourceId = String(ctx.sourceId || '').trim();
  const hostId = String(
    ctx.targetCreatureId ||
      ctx.targetPermanentId ||
      ctx.selectorContext?.targetCreatureId ||
      ctx.selectorContext?.combatOpponentCreatureId ||
      '',
  ).trim();

  if (/all equipment attached to that creature/i.test(objectText)) {
    if (!hostId) return [];
    return battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'artifact') || !typeLineHasSubtype(perm, 'equipment')) return false;
      return String((perm as any)?.attachedTo || '').trim() === hostId;
    });
  }

  if (/that wall/i.test(objectText)) {
    const boundIds = new Set(buildContextualBattlefieldTargetIds(battlefield, ctx, true, 'creature'));
    const walls = battlefield.filter((perm: any) => typeLineHasSubtype(perm, 'wall'));
    const boundWall = walls.find((perm: any) => boundIds.has(String(perm?.id || '').trim()));
    if (boundWall) return [boundWall];
    if (walls.length === 1) return walls;
    return [];
  }

  if (/it and all creatures it blocked/i.test(objectText)) {
    const source = sourceId
      ? battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId)
      : undefined;
    if (!source) return [];
    const sourceIdNorm = String((source as any)?.id || '').trim();
    const blocked = battlefield.filter((perm: any) => {
      const blocking = Array.isArray((perm as any)?.blockedBy) ? (perm as any).blockedBy : [];
      const sourceBlocking = Array.isArray((source as any)?.blocking) ? (source as any).blocking : [];
      const permId = String(perm?.id || '').trim();
      return blocking.includes(sourceIdNorm) || sourceBlocking.includes(permId);
    });
    return [source, ...blocked];
  }

  return [];
}

export function applyScheduleDelayedBattlefieldActionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_battlefield_action' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialScheduleDelayedBattlefieldActionStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const timing =
    step.timing === 'your_next_end_step'
      ? DelayedTriggerTiming.YOUR_NEXT_END_STEP
      : step.timing === 'next_upkeep'
        ? DelayedTriggerTiming.NEXT_UPKEEP
        : step.timing === 'your_next_upkeep'
          ? DelayedTriggerTiming.YOUR_NEXT_UPKEEP
        : step.timing === 'when_control_lost'
          ? DelayedTriggerTiming.WHEN_CONTROL_LOST
        : step.timing === 'next_cleanup_step'
          ? DelayedTriggerTiming.NEXT_CLEANUP
          : step.timing === 'when_leaves_battlefield'
          ? DelayedTriggerTiming.WHEN_LEAVES
      : step.timing === 'end_of_combat'
        ? DelayedTriggerTiming.END_OF_COMBAT
        : DelayedTriggerTiming.NEXT_END_STEP;

  if (step.action === 'exile') {
    const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(battlefield, step.object as any, runtime);
    const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.object as any, runtime);
    const permanents =
      recentTokenTargets.length > 0
        ? recentTokenTargets
        : recentTargets.length > 0
          ? recentTargets
          : resolveDirectBattlefieldPermanents(battlefield, step.object as any, ctx);
    if (permanents.length === 0) {
      const objectText = `${String((step.object as any)?.text || '')} ${String(step.raw || '')}`;
      if (/\b(?:the|those)\s+tokens\b/i.test(objectText) || /exile the tokens\b/i.test(objectText)) {
        return { applied: true, state, log: ['No created tokens to exile later'] };
      }
      return {
        applied: false,
        message: `Skipped delayed exile scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    let watchingPermanentId: string | undefined;
    if (timing === DelayedTriggerTiming.WHEN_LEAVES || timing === DelayedTriggerTiming.WHEN_CONTROL_LOST) {
      const recentWatched = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.watch as any, runtime);
      const watched =
        recentWatched.length > 0
          ? recentWatched
          : resolveDirectBattlefieldPermanents(battlefield, step.watch as any, ctx);
      if (watched.length !== 1) {
        return {
          applied: false,
          message: `Skipped delayed exile scheduling (no deterministic watched object): ${step.raw}`,
          reason: watched.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
          ...(watched.length > 1 ? { options: { classification: 'player_choice' as const } } : {}),
        };
      }
      watchingPermanentId = String((watched[0] as any)?.id || '').trim() || undefined;
      if (!watchingPermanentId) {
        return {
          applied: false,
          message: `Skipped delayed exile scheduling (no deterministic watched object): ${step.raw}`,
          reason: 'no_deterministic_target',
        };
      }
    }

    const scheduled = registerDelayedBattlefieldAction(
      state,
      ctx,
      (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
      timing,
      'exile',
      permanents,
      undefined,
      undefined,
      watchingPermanentId
    );
    return { applied: true, state: scheduled.state, log: scheduled.log };
  }

  if (step.action === 'destroy') {
    const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.object as any, runtime);
    let permanents =
      recentTargets.length > 0
        ? recentTargets
        : resolveDirectBattlefieldPermanents(battlefield, step.object as any, ctx);
    if (permanents.length === 0) {
      permanents = resolveDelayedDestroyFallbackPermanents(battlefield, step, ctx);
    }
    if (permanents.length === 0) {
      const objectText = `${String((step.object as any)?.text || '')} ${String(step.raw || '')}`;
      if (/all equipment attached to that creature/i.test(objectText) || /that wall/i.test(objectText)) {
        return { applied: true, state, log: ['No matching permanents to destroy later'] };
      }
      return {
        applied: false,
        message: `Skipped delayed destroy scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const scheduled = registerDelayedBattlefieldAction(
      state,
      ctx,
      (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
      timing,
      'destroy',
      permanents,
    );
    return { applied: true, state: scheduled.state, log: scheduled.log };
  }

  const recentTokenTargets = resolveRecentlyCreatedTokenPermanents(battlefield, step.object as any, runtime);
  const recentMovedTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.object as any, runtime);
  if (recentTokenTargets.length > 0 || recentMovedTargets.length > 0) {
    const players = resolvePlayers(state, step.who || ({ kind: 'you' } as any), ctx);
    const toSchedule = recentTokenTargets.length > 0 ? recentTokenTargets : recentMovedTargets;
    const scheduled = registerDelayedBattlefieldAction(
      state,
      ctx,
      (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
      timing,
      'sacrifice',
      toSchedule,
      step.condition,
      players.length > 0 ? 'You' : undefined
    );
    return { applied: true, state: scheduled.state, log: scheduled.log };
  }

  const players = resolvePlayers(state, step.who || ({ kind: 'you' } as any), ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const parsed = parseSacrificeWhat(step.object as any);
  const namedSelfReference = isNamedSelfSacrificeReference(step.object as any, ctx);
  if (!parsed && !namedSelfReference) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported object selector): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const toSchedule: BattlefieldPermanent[] = [];
  let needsChoice = false;
  let watchingPermanentId: string | undefined;
  const sourceId = String(ctx.sourceId || '').trim();
  const chosenObjectIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const contextualTargetIds = (() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [
      ...chosenObjectIds,
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.targetCreatureId || '').trim(),
    ]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      ids.push(candidate);
    }
    return ids;
  })();

  const resolveContextualPermanents = (
    contextual: Extract<NonNullable<typeof parsed>, { readonly mode: 'contextual' }>
  ): BattlefieldPermanent[] => {
    const ids = buildContextualBattlefieldTargetIds(battlefield, ctx, contextual.plural, contextual.type);
    if (ids.length === 0) return [];

    const matches = ids
      .map(id => battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id))
      .filter((perm): perm is BattlefieldPermanent => Boolean(perm))
      .filter(perm => players.includes(perm.controller))
      .filter(perm => permanentMatchesType(perm, contextual.type))
      .filter(perm => !contextual.tokenOnly || Boolean((perm as any)?.isToken));

    return contextual.plural ? matches : matches.slice(0, 1);
  };

  if (namedSelfReference || parsed?.mode === 'self') {
    const selfPermanent = sourceId
      ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    if (!selfPermanent || !players.includes(selfPermanent.controller)) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(selfPermanent);
  }

  if (parsed?.mode === 'choice_required') {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (parsed?.mode === 'contextual' && toSchedule.length === 0) {
    const contextualPermanents = resolveContextualPermanents(parsed);
    if (contextualPermanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(...contextualPermanents);
  }

  if (parsed?.mode === 'attached_to_source' || parsed?.mode === 'attached_to_named') {
    const attachmentResolution = resolveAttachmentReferencePermanents(battlefield, parsed, players, ctx);
    if (attachmentResolution.requiresChoice) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    if (attachmentResolution.permanents.length === 0) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    toSchedule.push(...attachmentResolution.permanents);
  }

  if (parsed?.mode === 'created_with_source') {
    if (!sourceId) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }

    const createdTokens = battlefield.filter((perm: any) => {
      if (!(perm as any)?.isToken) return false;
      if (!players.includes(perm.controller)) return false;
      return String((perm as any)?.createdBySourceId || '').trim() === sourceId;
    });
    toSchedule.push(...createdTokens);
  }

  if (
    !namedSelfReference &&
    parsed &&
    parsed.mode !== 'self' &&
    parsed.mode !== 'contextual' &&
    parsed.mode !== 'attached_to_source' &&
    parsed.mode !== 'attached_to_named' &&
    parsed.mode !== 'created_with_source'
  ) {
    for (const playerId of players) {
      const excludeSource = Boolean((parsed as any).excludeSource);
      const allowedTypes = Array.isArray((parsed as any).types) && (parsed as any).types.length > 0
        ? (parsed as any).types
        : [parsed.type];
      const subtype = String((parsed as any).subtype || '').trim().toLowerCase();
      const tokenOnly = Boolean((parsed as any).tokenOnly);
      const candidates = battlefield.filter(p => {
        if (p.controller !== playerId) return false;
        if (!allowedTypes.some(type => permanentMatchesType(p, type))) return false;
        if (tokenOnly && !(p as any)?.isToken) return false;
        if (subtype) {
          const typeLineLower = getExecutorTypeLineLower(p);
          if (!new RegExp(`(^|[^a-z])${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s)?($|[^a-z])`, 'i').test(typeLineLower)) {
            return false;
          }
        }
        if (excludeSource && sourceId && String((p as any)?.id || '').trim() === sourceId) return false;
        return true;
      });

      if (parsed.mode === 'all') {
        toSchedule.push(...candidates);
        continue;
      }

      if (candidates.length > parsed.count) {
        needsChoice = true;
        break;
      }
      toSchedule.push(...candidates);
    }
  }

  if (needsChoice) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (toSchedule.length === 0) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (step.condition && toSchedule.length !== 1) {
    return {
      applied: false,
      message: `Skipped delayed sacrifice scheduling (unsupported condition target shape): ${step.raw}`,
      reason: 'unsupported_condition',
    };
  }

  if (timing === DelayedTriggerTiming.WHEN_LEAVES || timing === DelayedTriggerTiming.WHEN_CONTROL_LOST) {
    const watched = resolveDirectBattlefieldPermanents(battlefield, step.watch as any, ctx);
    if (watched.length !== 1) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic watched object): ${step.raw}`,
        reason: watched.length > 1 ? 'player_choice_required' : 'no_deterministic_target',
        ...(watched.length > 1 ? { options: { classification: 'player_choice' as const } } : {}),
      };
    }
    watchingPermanentId = String((watched[0] as any)?.id || '').trim() || undefined;
    if (!watchingPermanentId) {
      return {
        applied: false,
        message: `Skipped delayed sacrifice scheduling (no deterministic watched object): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
  }

  const whoText = (() => {
    const whoKind = String((step.who as any)?.kind || 'you').trim();
    switch (whoKind) {
      case 'you':
        return 'You';
      case 'each_player':
        return 'Each player';
      case 'each_opponent':
        return 'Each opponent';
      case 'each_of_those_opponents':
        return 'Each of those opponents';
      case 'target_player':
        return 'That player';
      case 'target_opponent':
        return 'That opponent';
      default:
        return undefined;
    }
  })();

  const scheduled = registerDelayedBattlefieldAction(
    state,
    ctx,
    (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID,
    timing,
    'sacrifice',
    toSchedule,
    step.condition,
    whoText,
    watchingPermanentId
  );
  return { applied: true, state: scheduled.state, log: scheduled.log };
}
