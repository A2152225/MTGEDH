// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyTapOrUntapStep, applySkipNextUntapStep, applyOptionalUntapChoiceStep.
// Public entries: those three apply* functions.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { buildNameReferenceAliases } from './oracleIRExecutorBattlefieldNameAliases';
import { buildContextualBattlefieldTargetIds } from './oracleIRExecutorBattlefieldContextualTargets';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import {
  applyTapOrUntapToBattlefield,
  permanentMatchesType,
  resolveTapOrUntapTargetIds,
} from './oracleIRExecutorBattlefieldOps';
import { parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { normalizeSelfReferenceText } from './oracleIRExecutorBattlefieldSelfReference';
import { isMassTapOrUntapSelectorText } from './oracleIRExecutorCreatureStepUtils';
import { trySpecialTapOrUntapStep } from './oracleIRExecutorSpecialTargetHandlers';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function applyTapOrUntapStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'tap_or_untap' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const special = trySpecialTapOrUntapStep(state, step, ctx);
  if (special) return special;

  const effectiveTarget = effectiveStepTarget(step) || step.target;
  const targetText = String((effectiveTarget as any)?.text || '').trim().toLowerCase();
  if (/^(?:each of )?those permanents$/i.test(targetText)) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const battlefieldIds = new Set(
      battlefield.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean),
    );
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds)
        ? ctx.lastMovedBattlefieldPermanentIds
        : []),
    ]
      .map((id) => String(id || '').trim())
      .filter((id) => id && battlefieldIds.has(id));
    const targetIds = Array.from(new Set(antecedentIds));
    if (targetIds.length === 0) {
      return {
        applied: true,
        state,
        log: ['No permanents to tap/untap'],
        lastTappedMatchingPermanentCount: 0,
        lastTappedMatchingPermanentIds: [],
      };
    }
    const choice: 'tap' | 'untap' = step.mode ?? 'untap';
    return {
      applied: true,
      state: applyTapOrUntapToBattlefield(state, targetIds, choice),
      log: [`${choice === 'tap' ? 'Tapped' : 'Untapped'} ${targetIds.length} permanent(s)`],
      ...(choice === 'tap'
        ? {
            lastTappedMatchingPermanentCount: targetIds.length,
            lastTappedMatchingPermanentIds: targetIds,
          }
        : {}),
    };
  }

  let targetIds = resolveTapOrUntapTargetIds(state, effectiveTarget as any, ctx);
  if (targetIds.length === 0) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const directTargets = resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
    targetIds = directTargets
      .map((perm: any) => String((perm as any)?.id || '').trim())
      .filter(Boolean)
      .slice(0, /\btarget\b/.test(targetText) ? 1 : directTargets.length);
  }
  if (targetIds.length === 0 && /^(?:another|other)\s+target\b/.test(targetText)) {
    const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
    const sourceId = String(ctx.sourceId || '').trim();
    const requiredType = parseSimplePermanentTypeFromText(targetText) || 'creature';
    const controllerId = String(ctx.controllerId || '').trim();
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    const excludeIds = new Set(
      [sourceId, String(ctx.targetCreatureId || '').trim(), String(ctx.targetPermanentId || '').trim()].filter(Boolean)
    );
    const orderedCandidates = [
      ...chosenIds
        .map(id => battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === id))
        .filter((perm): perm is BattlefieldPermanent => Boolean(perm)),
      ...battlefield.filter(
        (perm: any) =>
          String((perm as any)?.controller || '').trim() === controllerId &&
          permanentMatchesType(perm, requiredType as any)
      ),
    ];
    const seen = new Set<string>();
    for (const perm of orderedCandidates) {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || seen.has(permanentId) || excludeIds.has(permanentId)) continue;
      seen.add(permanentId);
      targetIds = [permanentId];
      break;
    }
  }
  if (targetIds.length === 0) {
    const isUpTo = /\bup to\b/i.test(`${targetText} ${String(step.raw || '')}`);
    if (isUpTo) {
      const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
      const typePhrase = targetText.replace(/^up to (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+/i, '').trim();
      const requiredType = parseSimplePermanentTypeFromText(typePhrase) || 'creature';
      const hasLegalCandidate = battlefield.some((perm: any) => permanentMatchesType(perm, requiredType as any));
      if (!hasLegalCandidate) {
        return {
          applied: true,
          state,
          log: ['Chose no permanents to tap/untap (up to N)'],
          lastTappedMatchingPermanentCount: 0,
          lastTappedMatchingPermanentIds: [],
        };
      }
    }
    if (isMassTapOrUntapSelectorText(`${targetText} ${String(step.raw || '')}`)) {
      return {
        applied: true,
        state,
        log: ['No permanents to tap/untap'],
        lastTappedMatchingPermanentCount: 0,
        lastTappedMatchingPermanentIds: [],
      };
    }
    return {
      applied: false,
      message: `Skipped tap/untap (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const currentTargets = ((state.battlefield || []) as any[]).filter((perm: any) =>
    targetIds.includes(String(perm?.id || '').trim())
  );
  const choice: 'tap' | 'untap' =
    step.mode ?? ctx.tapOrUntapChoice ?? (currentTargets.some((perm: any) => Boolean(perm?.tapped)) ? 'untap' : 'tap');

  return {
    applied: true,
    state: applyTapOrUntapToBattlefield(state, targetIds, choice),
    log: [`${choice === 'tap' ? 'Tapped' : 'Untapped'} ${targetIds.length} permanent(s)`],
    ...(choice === 'tap'
      ? {
          lastTappedMatchingPermanentCount: targetIds.length,
          lastTappedMatchingPermanentIds: targetIds,
        }
      : {}),
  };
}

export function applySkipNextUntapStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'skip_next_untap' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetTextRaw = String((step.target as any)?.text || step.raw || '').trim();
  const targetTextLower = targetTextRaw.toLowerCase();

  if (
    /^(?:that|target)\s+player$/i.test(targetTextLower) ||
    /^(?:target player|that player)\s+skips\s+their\s+next\s+untap\s+step\.?$/i.test(targetTextLower)
  ) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId ||
      ctx.selectorContext?.thatPlayerId ||
      (step.target as any)?.playerId ||
      ''
    ).trim();
    if (!playerId) {
      return {
        applied: false,
        message: `Skipped next untap step (no target player): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const stateAny = state as any;
    stateAny.skipNextUntapStepByPlayer = stateAny.skipNextUntapStepByPlayer || {};
    stateAny.skipNextUntapStepByPlayer[playerId] = true;
    return {
      applied: true,
      state: stateAny as GameState,
      log: [`${playerId} skips their next untap step`],
    };
  }

  if (/^those creatures(?: don't untap|$)/i.test(targetTextLower)) {
    const contextualIds = buildContextualBattlefieldTargetIds(battlefield, ctx, true);
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const targetIds = Array.from(new Set([...contextualIds, ...antecedentIds])).filter((id) =>
      battlefield.some((perm: any) => String((perm as any)?.id || '').trim() === id)
    );
    if (targetIds.length > 0) {
      const targetIdSet = new Set(targetIds);
      const nextBattlefield = battlefield.map((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!targetIdSet.has(permanentId)) return perm;
        const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
          ? [...(perm as any).temporaryEffects]
          : [];
        existingEffects.push({
          id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
          description: "doesn't untap during their controllers' next untap steps",
          expiresAt: 'leaves_battlefield',
          expiresOnControllerTurn: String((perm as any)?.controller || '').trim() || undefined,
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceName: String(ctx.sourceName || '').trim() || undefined,
        } as any);
        return { ...perm, temporaryEffects: existingEffects } as any;
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Marked ${targetIds.length} creature(s) to skip their next untap step`],
      };
    }
  }

  if (/^creatures and lands target opponent controls(?: don't untap during their next untap step)?$/i.test(targetTextLower)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
    const targetIds = battlefield
      .filter((perm: any) => {
        if (String((perm as any)?.controller || '').trim() !== opponentId) return false;
        return permanentMatchesType(perm, 'creature') || permanentMatchesType(perm, 'land');
      })
      .map((perm: any) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    if (targetIds.length > 0) {
      const targetIdSet = new Set(targetIds);
      const nextBattlefield = battlefield.map((perm: any) => {
        const permanentId = String((perm as any)?.id || '').trim();
        if (!targetIdSet.has(permanentId)) return perm;
        const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
          ? [...(perm as any).temporaryEffects]
          : [];
        existingEffects.push({
          id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
          description: "doesn't untap during their next untap step",
          expiresAt: 'leaves_battlefield',
          expiresOnControllerTurn: opponentId || undefined,
          sourceId: String(ctx.sourceId || '').trim() || undefined,
          sourceName: String(ctx.sourceName || '').trim() || undefined,
        } as any);
        return { ...perm, temporaryEffects: existingEffects } as any;
      });
      return {
        applied: true,
        state: { ...(state as any), battlefield: nextBattlefield } as GameState,
        log: [`Marked ${targetIds.length} permanent(s) to skip their next untap step`],
      };
    }
  }

  if (/^lands target player controls(?: don't untap during their next untap step)?$/i.test(targetTextLower)) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim();
    const targetIds = battlefield
      .filter(
        (perm: any) =>
          String((perm as any)?.controller || '').trim() === playerId && permanentMatchesType(perm, 'land')
      )
      .map((perm: any) => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    if (targetIds.length === 0) {
      return { applied: true, state, log: ['No lands for target player to skip untap'] };
    }
    const targetIdSet = new Set(targetIds);
    const nextBattlefield = battlefield.map((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!targetIdSet.has(permanentId)) return perm;
      const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
        ? [...(perm as any).temporaryEffects]
        : [];
      existingEffects.push({
        id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
        description: "doesn't untap during their controller's next untap step",
        expiresAt: 'leaves_battlefield',
        expiresOnControllerTurn: playerId || undefined,
        sourceId: String(ctx.sourceId || '').trim() || undefined,
        sourceName: String(ctx.sourceName || '').trim() || undefined,
      } as any);
      return { ...perm, temporaryEffects: existingEffects } as any;
    });
    return {
      applied: true,
      state: { ...(state as any), battlefield: nextBattlefield } as GameState,
      log: [`Marked ${targetIds.length} land(s) to skip their next untap step`],
    };
  }

  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets =
    recentTargets.length > 0
      ? []
      : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped next untap prevention (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped next untap prevention (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetIdSet = new Set(targetIds);
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIdSet.has(permanentId)) return perm;

    const existingEffects = Array.isArray((perm as any)?.temporaryEffects)
      ? [...(perm as any).temporaryEffects]
      : [];
    existingEffects.push({
      id: `${permanentId}:temp:${existingEffects.length + 1}:doesnt-untap-next-untap-step`,
      description: "doesn't untap during your next untap step",
      expiresAt: 'leaves_battlefield',
      expiresOnControllerTurn: String((perm as any)?.controller || '').trim() || undefined,
      sourceId: String(ctx.sourceId || '').trim() || undefined,
      sourceName: String(ctx.sourceName || '').trim() || undefined,
    } as any);

    return {
      ...perm,
      temporaryEffects: existingEffects,
    } as any;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Marked ${targetIds.length} permanent(s) to skip their next untap step`],
  };
}

export function applyOptionalUntapChoiceStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'optional_untap_choice' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
  const sourceId = String(ctx.sourceId || '').trim();
  const sourcePermanent = sourceId
    ? battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId)
    : undefined;
  const normalizedTarget = normalizeSelfReferenceText(targetText);
  const sourceNames = new Set(
    [String(ctx.sourceName || ''), String((ctx as any).cardName || '')]
      .flatMap(value => buildNameReferenceAliases(value))
      .filter(Boolean)
  );
  const nameMatchedTarget =
    normalizedTarget.length > 0 &&
    (sourceNames.has(normalizedTarget) ||
      [...sourceNames].some((alias) => normalizedTarget.includes(alias) || alias.includes(normalizedTarget)));
  const selfReference =
    /^(?:this\s+(?:creature|artifact|land|permanent|vehicle)|it)$/i.test(targetText) ||
    (normalizedTarget.length > 0 && sourceNames.has(normalizedTarget)) ||
    nameMatchedTarget;

  const targets = selfReference && sourcePermanent
    ? [sourcePermanent]
    : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(new Set(
    targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean)
  ));

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped optional untap choice registration (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1) {
    return {
      applied: false,
      message: `Skipped optional untap choice registration (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetIdSet = new Set(targetIds);
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIdSet.has(permanentId)) return perm;
    return {
      ...perm,
      optionalUntapChoice: true,
      optionalUntapChoiceSourceId: String(ctx.sourceId || '').trim() || undefined,
      optionalUntapChoiceSourceName: String(ctx.sourceName || '').trim() || undefined,
    } as any;
  });

  return {
    applied: true,
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Registered optional untap choice for ${targetIds.length} permanent(s)`],
  };
}

